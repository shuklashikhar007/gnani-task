"use client";

import { create } from "zustand";

import { api, type Recording } from "@/app/_uploads/api";
import { DEFAULT_LANGUAGE } from "@/app/_uploads/languages";
import { ACTIVE_STATES, Uploader, type UploadSnapshot } from "@/app/_uploads/uploader";

// The upload engine isn't React state; the store only mirrors its snapshots.
// Living at module level also means an upload keeps going across in-app navigation.
let uploader: Uploader | null = null;

interface UploadsState {
    recordings: Recording[] | null;
    /** Bytes R2 already has for unfinished uploads other than the current one. */
    pendingBytes: Record<string, number>;
    error: string | null;
    upload: UploadSnapshot | null;
    /** Language for the next upload. */
    language: string;

    loadRecordings: () => Promise<void>;
    deleteRecording: (rec: Recording) => Promise<void>;
    retryRecording: (rec: Recording) => Promise<void>;
    setLanguage: (language: string) => void;
    startUpload: (file: File) => void;
    pause: () => void;
    resume: () => void;
    cancel: () => Promise<void>;
    dismiss: () => void;
}

export const isUploading = (s: UploadsState) => !!s.upload && ACTIVE_STATES.includes(s.upload.state);

export const activeRecordingId = (s: UploadsState) => (isUploading(s) ? (s.upload?.recording?.id ?? null) : null);

export const useUploads = create<UploadsState>()((set, get) => ({
    recordings: null,
    pendingBytes: {},
    error: null,
    upload: null,
    language: DEFAULT_LANGUAGE,

    loadRecordings: async () => {
        try {
            // Refresh, not just list: each poll also moves due transcriptions forward on the server.
            const recordings = await api.refreshRecordings();
            set({ recordings, error: null });
            // The live upload reports its own progress; ask R2 only about the others.
            const activeId = activeRecordingId(get());
            const pending = recordings.filter((r) => r.status === "pending_upload" && r.id !== activeId);
            const entries = await Promise.all(
                pending.map((r) =>
                    api
                        .getUploadedParts(r.id)
                        .then((p) => [r.id, p.uploaded_bytes] as const)
                        .catch(() => [r.id, 0] as const),
                ),
            );
            set({ pendingBytes: Object.fromEntries(entries) });
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Couldn't load your uploads." });
        }
    },

    deleteRecording: async (rec) => {
        try {
            await api.deleteRecording(rec.id);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Couldn't delete it." });
        }
        await get().loadRecordings();
    },

    retryRecording: async (rec) => {
        try {
            await api.retryRecording(rec.id);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Couldn't retry it." });
        }
        await get().loadRecordings();
    },

    setLanguage: (language) => set({ language }),

    startUpload: (file) => {
        if (isUploading(get())) return;
        const current: Uploader = new Uploader(
            file,
            (snapshot) => {
                if (uploader !== current) return; // a dismissed upload's late events
                const prev = get().upload;
                set({ upload: snapshot });
                // Refresh the list when the upload changes state or gets its recording.
                if (prev?.state !== snapshot.state || prev?.recording?.id !== snapshot.recording?.id) {
                    void get().loadRecordings();
                }
            },
            get().language,
        );
        uploader = current;
        void current.start();
    },

    pause: () => uploader?.pause(),
    resume: () => uploader?.resume(),
    cancel: async () => {
        await uploader?.cancel();
        await get().loadRecordings();
    },
    dismiss: () => {
        uploader = null;
        set({ upload: null });
    },
}));
