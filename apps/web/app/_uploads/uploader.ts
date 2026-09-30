// Resumable multipart upload of one file, straight from the browser to R2.
//
// Each part R2 has stored is a checkpoint: on a network drop, pause, error or page refresh,
// only the parts R2 doesn't have yet are uploaded again. The server, not this class, decides
// when the file is complete (it checks R2's own list of parts), so this class only has to
// get every part there.

import { api, ApiError, isRetryable, isSameFile, NetworkError, type Recording } from "@/app/_uploads/api";

const CONCURRENCY = 4;
const URL_BATCH = 20;
const MAX_RETRIES = 6;
// A part upload with no progress for this long is treated as a dropped connection.
const STALL_TIMEOUT_MS = 30_000;
// Refresh presigned URLs this long before they actually expire.
const URL_EXPIRY_MARGIN_MS = 5 * 60_000;
const MAX_COMPLETE_ROUNDS = 3;
const SPEED_WINDOW_MS = 5_000;

export type UploadState =
    "preparing" | "uploading" | "retrying" | "offline" | "paused" | "completing" | "done" | "error" | "cancelled";

export const ACTIVE_STATES: UploadState[] = ["preparing", "uploading", "retrying", "offline", "completing"];

export interface UploadSnapshot {
    state: UploadState;
    message: string | null;
    fileName: string;
    totalBytes: number;
    uploadedBytes: number;
    partsDone: number;
    partCount: number;
    bytesPerSecond: number;
    /** True when this upload continued from parts stored earlier. */
    resumed: boolean;
    recording: Recording | null;
}

type PartResult = "ok" | "aborted" | "expired" | "retryable";

class FatalUploadError extends Error {}

export class Uploader {
    private rec: Recording | null = null;
    private done = new Set<number>();
    private doneBytes = 0;
    private inflight = new Map<number, { xhr: XMLHttpRequest; loaded: number }>();
    private urls = new Map<number, { url: string; expiresAt: number }>();
    private queue: number[] = [];
    // Bumped on pause/cancel/error; async work started under an older id stops itself.
    private runId = 0;
    // Resolves pending sleeps and "wait until online" promises when runId changes.
    private wakers = new Set<() => void>();
    private state: UploadState = "preparing";
    private message: string | null = null;
    private resumed = false;
    private samples: { t: number; bytes: number }[] = [];
    private emitTimer: ReturnType<typeof setTimeout> | null = null;
    private lastEmit = 0;

    constructor(
        private readonly file: File,
        private readonly onChange: (snapshot: UploadSnapshot) => void,
    ) {}

    // ---- public controls ----

    async start() {
        const id = this.bump();
        this.set("preparing", "Preparing upload…");
        try {
            await this.attachRecording();
        } catch (err) {
            if (id === this.runId) this.fail(err);
            return;
        }
        if (id !== this.runId) return;
        if (this.rec!.status === "uploaded") {
            this.set("done", "This file is already uploaded.");
            return;
        }
        void this.run();
    }

    pause() {
        if (!ACTIVE_STATES.includes(this.state)) return;
        this.bump();
        this.set("paused", "Paused. Finished parts are kept.");
    }

    /** Continue after pause or error, from the last checkpoint. */
    resume() {
        if (this.state !== "paused" && this.state !== "error") return;
        if (!this.rec) void this.start();
        else void this.run();
    }

    async cancel() {
        this.bump();
        this.set("cancelled", "Upload cancelled.");
        if (this.rec) {
            // If this fails, the server's sweeper cleans the upload up later.
            await api.deleteRecording(this.rec.id).catch(() => {});
        }
    }

    snapshot(): UploadSnapshot {
        return {
            state: this.state,
            message: this.message,
            fileName: this.file.name,
            totalBytes: this.file.size,
            uploadedBytes: this.uploadedBytes(),
            partsDone: this.done.size,
            partCount: this.rec?.part_count ?? 0,
            bytesPerSecond: this.speed(),
            resumed: this.resumed,
            recording: this.rec,
        };
    }

    // ---- setup ----

    /** Continue an unfinished upload of this same file if there is one, otherwise start a new one. */
    private async attachRecording() {
        const existing = (await api.listRecordings()).find(
            (r) => r.status === "pending_upload" && isSameFile(this.file, r),
        );
        if (existing) {
            const progress = await api.getUploadedParts(existing.id);
            // Asking for parts can discover that R2 already dropped the upload.
            const rec = await api.getRecording(existing.id);
            if (rec.status === "pending_upload") {
                this.rec = rec;
                const stored = new Map(progress.parts.map((p) => [p.part_number, p.size]));
                for (let n = 1; n <= rec.part_count; n++) {
                    if (stored.get(n) === this.partSize(n)) {
                        this.done.add(n);
                        this.doneBytes += this.partSize(n);
                    } else {
                        this.queue.push(n);
                    }
                }
                this.resumed = this.done.size > 0;
                return;
            }
        }
        this.rec = await api.createRecording(this.file);
        for (let n = 1; n <= this.rec.part_count; n++) this.queue.push(n);
    }

    // ---- main loop ----

    private async run() {
        const id = this.bump();
        this.samples = [];
        this.set("uploading", this.resumed ? "Resuming from the last checkpoint…" : null);
        try {
            for (let round = 0; ; round++) {
                await Promise.all(Array.from({ length: CONCURRENCY }, () => this.worker(id)));
                if (id !== this.runId) return;

                this.set("completing", "Finishing upload…");
                const missing = await this.complete(id);
                if (id !== this.runId) return;
                if (missing.length === 0) {
                    this.set("done", "Upload complete.");
                    return;
                }
                if (round + 1 >= MAX_COMPLETE_ROUNDS) {
                    throw new FatalUploadError("The server keeps reporting missing parts. Please try again.");
                }
                // The server checks R2's own list of parts; re-send whatever it says is missing.
                for (const n of missing) {
                    if (this.done.delete(n)) this.doneBytes -= this.partSize(n);
                    this.urls.delete(n);
                    this.queue.push(n);
                }
                this.set("uploading", `Re-sending ${missing.length} part(s)…`);
            }
        } catch (err) {
            if (id === this.runId) this.fail(err);
        }
    }

    private async worker(id: number) {
        while (id === this.runId) {
            const n = this.queue.shift();
            if (n === undefined) return;
            await this.uploadPart(n, id);
        }
    }

    private async uploadPart(n: number, id: number) {
        let failures = 0;
        while (true) {
            if (id !== this.runId) {
                this.queue.unshift(n);
                return;
            }
            let url: string;
            try {
                url = await this.urlFor(n);
            } catch (err) {
                if (!isRetryable(err)) throw err;
                failures = await this.backoff(failures, id);
                continue;
            }
            if (id !== this.runId) continue;

            const result = await this.putPart(n, url);
            if (result === "ok") {
                this.done.add(n);
                this.doneBytes += this.partSize(n);
                this.urls.delete(n);
                if (this.state === "retrying") this.set("uploading", null);
                this.emit();
                return;
            }
            if (result === "aborted") continue; // loop top puts it back in the queue
            if (result === "expired") this.urls.delete(n);
            failures = await this.backoff(failures, id);
        }
    }

    /** Asks the server to finalize. Returns the part numbers it says are missing (empty = done). */
    private async complete(id: number): Promise<number[]> {
        let failures = 0;
        while (id === this.runId) {
            try {
                this.rec = await api.completeUpload(this.rec!.id);
                return [];
            } catch (err) {
                if (err instanceof ApiError && err.status === 409 && err.missingParts?.length) {
                    return err.missingParts;
                }
                if (!isRetryable(err)) throw err;
                failures = await this.backoff(failures, id);
                if (id === this.runId) this.set("completing", "Finishing upload…");
            }
        }
        return [];
    }

    // ---- network helpers ----

    private async urlFor(n: number): Promise<string> {
        const cached = this.urls.get(n);
        if (cached && cached.expiresAt > Date.now()) return cached.url;

        // Fetch URLs for the next few queued parts too, to save round trips.
        const wanted = [n, ...this.queue.filter((p) => !this.hasFreshUrl(p))].slice(0, URL_BATCH);
        const res = await api.presignParts(this.rec!.id, wanted);
        const expiresAt = Date.now() + res.expires_in * 1000 - URL_EXPIRY_MARGIN_MS;
        for (const p of res.parts) this.urls.set(p.part_number, { url: p.url, expiresAt });
        return this.urls.get(n)!.url;
    }

    private hasFreshUrl(n: number) {
        const cached = this.urls.get(n);
        return !!cached && cached.expiresAt > Date.now();
    }

    private putPart(n: number, url: string): Promise<PartResult> {
        const start = (n - 1) * this.rec!.part_size;
        const blob = this.file.slice(start, start + this.partSize(n));

        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            const entry = { xhr, loaded: 0 };
            let stallTimer: ReturnType<typeof setTimeout> | undefined;
            let stalled = false;

            const armStallTimer = () => {
                clearTimeout(stallTimer);
                stallTimer = setTimeout(() => {
                    stalled = true;
                    xhr.abort();
                }, STALL_TIMEOUT_MS);
            };
            const finish = (result: PartResult) => {
                clearTimeout(stallTimer);
                this.inflight.delete(n);
                this.emit();
                resolve(result);
            };

            xhr.upload.onprogress = (e) => {
                entry.loaded = e.loaded;
                armStallTimer();
                this.emit();
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) finish("ok");
                else if (xhr.status === 403) finish("expired");
                else finish("retryable");
            };
            xhr.onerror = () => finish("retryable");
            xhr.onabort = () => finish(stalled ? "retryable" : "aborted");

            this.inflight.set(n, entry);
            xhr.open("PUT", url);
            armStallTimer();
            xhr.send(blob);
        });
    }

    /** Waits before the next attempt. Offline time doesn't count as a failed attempt. */
    private async backoff(failures: number, id: number): Promise<number> {
        if (!navigator.onLine) {
            await this.waitUntilOnline(id);
            return failures;
        }
        failures++;
        if (failures > MAX_RETRIES) {
            throw new FatalUploadError(
                "The upload keeps failing. Check your connection and press Retry. Finished parts are kept.",
            );
        }
        const delay = Math.min(30_000, 1000 * 2 ** (failures - 1));
        this.set("retrying", `Connection problem. Retrying in ${Math.round(delay / 1000)}s…`);
        await this.sleep(delay, id);
        return failures;
    }

    private async waitUntilOnline(id: number) {
        this.set("offline", "You're offline. The upload will continue when the connection is back.");
        await new Promise<void>((resolve) => {
            const check = () => {
                if (navigator.onLine || id !== this.runId) done();
            };
            const done = () => {
                window.removeEventListener("online", check);
                clearInterval(poll);
                this.wakers.delete(done);
                resolve();
            };
            window.addEventListener("online", check);
            // The "online" event isn't fully reliable across browsers, so also check now and then.
            const poll = setInterval(check, 3000);
            this.wakers.add(done);
        });
        if (id === this.runId && this.state === "offline") this.set("uploading", "Back online. Continuing…");
    }

    private sleep(ms: number, id: number) {
        return new Promise<void>((resolve) => {
            const done = () => {
                clearTimeout(timer);
                this.wakers.delete(done);
                resolve();
            };
            const timer = setTimeout(done, ms);
            if (id !== this.runId) done();
            else this.wakers.add(done);
        });
    }

    // ---- state ----

    /** Stops everything started under the current run id and returns a new id. */
    private bump() {
        this.runId++;
        for (const { xhr } of this.inflight.values()) xhr.abort();
        for (const wake of [...this.wakers]) wake();
        return this.runId;
    }

    private fail(err: unknown) {
        this.bump();
        let message = "Something went wrong. Press Retry to continue.";
        if (err instanceof FatalUploadError || err instanceof ApiError || err instanceof NetworkError) {
            message = err.message;
        }
        this.set("error", message);
    }

    private set(state: UploadState, message: string | null) {
        this.state = state;
        this.message = message;
        this.emit(true);
    }

    /** Notifies the listener, at most every 100ms unless forced. */
    private emit(force = false) {
        const now = Date.now();
        const bytes = this.uploadedBytes();
        this.samples.push({ t: now, bytes });
        while (this.samples.length > 2 && now - this.samples[0].t > SPEED_WINDOW_MS) this.samples.shift();

        if (force || now - this.lastEmit >= 100) {
            if (this.emitTimer) clearTimeout(this.emitTimer);
            this.emitTimer = null;
            this.lastEmit = now;
            this.onChange(this.snapshot());
        } else if (!this.emitTimer) {
            this.emitTimer = setTimeout(() => this.emit(true), 100);
        }
    }

    private uploadedBytes() {
        let bytes = this.doneBytes;
        for (const { loaded } of this.inflight.values()) bytes += loaded;
        return Math.min(bytes, this.file.size);
    }

    private speed() {
        if (this.samples.length < 2) return 0;
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const seconds = (last.t - first.t) / 1000;
        return seconds > 0 ? Math.max(0, (last.bytes - first.bytes) / seconds) : 0;
    }

    private partSize(n: number) {
        const { part_size, part_count } = this.rec!;
        return n < part_count ? part_size : this.file.size - part_size * (part_count - 1);
    }
}
