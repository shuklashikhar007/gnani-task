import type { Recording } from "@/app/_uploads/api";
import { languageLabel } from "@/app/_uploads/languages";
import { formatDuration } from "@/app/_utils/format";

// Gnani batch job statuses, in words.
const GNANI_STAGES: Record<string, string> = {
    CREATED: "Starting the transcription job...",
    STARTING: "Starting the transcription job...",
    QUEUED: "Queued at the transcription service...",
    IN_PROGRESS: "Transcribing...",
    COMPLETED: "Saving the transcript...",
};

/** What the worker is doing with this recording right now, or null once it's finished. */
export function processingStage(rec: Recording): string | null {
    if (rec.status === "uploaded") return "Waiting to be transcribed…";
    if (rec.status !== "transcribing") return null;
    if (rec.attempts > 0) return "The transcription service had a problem. Retrying automatically…";
    if (!rec.transcription_mode) return "Checking the audio…";
    if (rec.transcription_mode === "sync") return "Transcribing…";
    return GNANI_STAGES[rec.gnani_status ?? ""] ?? "Transcribing…";
}

/** "3m 20s elapsed" while processing. */
export function elapsedText(rec: Recording, now: number): string | null {
    if (rec.status !== "transcribing" || !rec.processing_started_at) return null;
    return `${formatDuration((now - Date.parse(rec.processing_started_at)) / 1000)} elapsed`;
}

/** "Hindi + English · 3m 20s audio · batch". */
export function audioDetails(rec: Recording): string {
    const parts = [languageLabel(rec.language_code)];
    if (rec.duration_seconds) parts.push(`${formatDuration(rec.duration_seconds)} audio`);
    if (rec.transcription_mode) parts.push(rec.transcription_mode === "sync" ? "quick" : "batch");
    return parts.join(" · ");
}

/** A failed recording can be retried only if its file finished uploading. */
export const canRetry = (rec: Recording) => rec.status === "failed" && rec.uploaded_at !== null;
