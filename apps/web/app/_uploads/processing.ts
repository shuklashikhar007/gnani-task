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
    if (rec.status === "transcribed") return "Transcript ready. Summarizing next...";
    if (rec.status === "summarizing") {
        if (rec.attempts > 0) return "The summary service had a problem. Retrying automatically...";
        const p = rec.summary_progress;
        return p ? `Summarizing part ${Math.min(p.done + 1, p.total)} of ${p.total}...` : "Summarizing...";
    }
    if (rec.status !== "transcribing") return null;
    if (rec.attempts > 0) return "The transcription service had a problem. Retrying automatically…";
    if (!rec.transcription_mode) return "Checking the audio…";
    if (rec.transcription_mode === "sync") return "Transcribing…";
    return GNANI_STAGES[rec.gnani_status ?? ""] ?? "Transcribing…";
}

/** True while transcription or the summary is running, i.e. while an elapsed-time clock is shown. */
export function isTicking(rec: Recording): boolean {
    const active = rec.status === "transcribing" || rec.status === "transcribed" || rec.status === "summarizing";
    return active && rec.processing_started_at !== null;
}

/** "3m 20s elapsed" while processing (counted from when transcription started). */
export function elapsedText(rec: Recording, now: number): string | null {
    if (!isTicking(rec) || !rec.processing_started_at) return null;
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

/** The transcript exists from "transcribed" on (and stays if only the summary failed). */
export const hasTranscript = (rec: Recording) =>
    rec.status === "transcribed" ||
    rec.status === "summarizing" ||
    rec.status === "completed" ||
    (rec.status === "failed" && rec.transcribed_at !== null);
