// Typed client for the recordings API. Requests go through the Next.js /api rewrite.

export type RecordingStatus = "pending_upload" | "uploaded" | "transcribing" | "transcribed" | "failed";

/** Statuses the recording will still move on from; the UI keeps polling while any are present. */
export const UNFINISHED_STATUSES: RecordingStatus[] = ["pending_upload", "uploaded", "transcribing"];

export interface Recording {
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    file_last_modified: number;
    part_size: number;
    part_count: number;
    status: RecordingStatus;
    error: string | null;
    created_at: string;
    updated_at: string;
    uploaded_at: string | null;
    language_code: string;
    duration_seconds: number | null;
    transcription_mode: "sync" | "batch" | null;
    /** Latest Gnani batch job status (CREATED, QUEUED, IN_PROGRESS, ...), shown as progress. */
    gnani_status: string | null;
    /** Transient failures so far; above 0 means the worker is retrying. */
    attempts: number;
    processing_started_at: string | null;
    transcribed_at: string | null;
}

export interface Segment {
    start_time: number;
    end_time: number;
    text: string;
    speaker_id?: string | null;
}

export interface RecordingDetail extends Recording {
    transcript: string | null;
    segments: Segment[] | null;
}

export interface PresignedParts {
    parts: { part_number: number; url: string }[];
    expires_in: number;
}

export interface UploadProgress {
    parts: { part_number: number; size: number }[];
    uploaded_bytes: number;
}

/** The server answered with an error. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly missingParts?: number[],
    ) {
        super(message);
    }

    /** Worth retrying: the server or proxy had a temporary problem. */
    get retryable() {
        return this.status >= 500 || this.status === 429;
    }
}

/** The request never got an answer (offline, DNS, connection reset). */
export class NetworkError extends Error {}

export function isRetryable(err: unknown) {
    return err instanceof NetworkError || (err instanceof ApiError && err.retryable);
}

async function request<T>(path: string, method = "GET", json?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: json === undefined ? undefined : { "Content-Type": "application/json" },
            body: json === undefined ? undefined : JSON.stringify(json),
        });
    } catch {
        throw new NetworkError("Can't reach the server.");
    }
    if (!res.ok) {
        let body: { detail?: unknown; missing_parts?: number[] } = {};
        try {
            body = await res.json();
        } catch {
            // Non-JSON error body, e.g. from the proxy.
        }
        const message = typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`;
        throw new ApiError(res.status, message, body.missing_parts);
    }
    return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
    createRecording: (file: File, languageCode: string) =>
        request<Recording>("/recordings", "POST", {
            filename: file.name,
            size_bytes: file.size,
            content_type: file.type,
            last_modified: file.lastModified,
            language_code: languageCode,
        }),
    listRecordings: () => request<Recording[]>("/recordings"),
    /** Like listRecordings, but first advances any transcription work that's due (this drives processing). */
    refreshRecordings: () => request<Recording[]>("/recordings/refresh", "POST"),
    /** One recording with its transcript, after advancing any work that's due. */
    refreshRecording: (id: string) => request<RecordingDetail>(`/recordings/${id}/refresh`, "POST"),
    getRecording: (id: string) => request<RecordingDetail>(`/recordings/${id}`),
    presignParts: (id: string, partNumbers: number[]) =>
        request<PresignedParts>(`/recordings/${id}/parts`, "POST", { part_numbers: partNumbers }),
    getUploadedParts: (id: string) => request<UploadProgress>(`/recordings/${id}/parts`),
    completeUpload: (id: string) => request<Recording>(`/recordings/${id}/complete`, "POST"),
    retryRecording: (id: string) => request<Recording>(`/recordings/${id}/retry`, "POST"),
    deleteRecording: (id: string) => request<void>(`/recordings/${id}`, "DELETE"),
};

/** Same file the user picked before: name, size and last-modified time all match. */
export function isSameFile(file: File, rec: Recording) {
    return file.name === rec.filename && file.size === rec.size_bytes && file.lastModified === rec.file_last_modified;
}
