"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { isSameFile, type Recording, UNFINISHED_STATUSES } from "@/app/_uploads/api";
import { audioDetails, canRetry, elapsedText, processingStage } from "@/app/_uploads/processing";
import StatusBadge from "@/app/_uploads/status-badge";
import { activeRecordingId, isUploading, useUploads } from "@/app/_uploads/store";
import { formatBytes, formatDate } from "@/app/_utils/format";
import { useNow } from "@/app/_utils/use-now";

const POLL_MS = 5000;

export default function RecordingsList() {
    const recordings = useUploads((s) => s.recordings);
    const pendingBytes = useUploads((s) => s.pendingBytes);
    const error = useUploads((s) => s.error);
    const activeId = useUploads(activeRecordingId);
    const uploadActive = useUploads(isUploading);
    const { loadRecordings, startUpload, deleteRecording, retryRecording } = useUploads.getState();
    const hasUnfinished = recordings?.some((r) => UNFINISHED_STATUSES.includes(r.status)) ?? false;
    const now = useNow(recordings?.some((r) => r.status === "transcribing") ?? false);

    useEffect(() => {
        void loadRecordings();
    }, [loadRecordings]);

    // Poll while anything is unfinished. Each poll also advances due transcriptions on the server (no worker).
    useEffect(() => {
        if (!hasUnfinished) return;
        const timer = setInterval(() => void loadRecordings(), POLL_MS);
        return () => clearInterval(timer);
    }, [hasUnfinished, loadRecordings]);

    const remove = (rec: Recording) => {
        if (window.confirm(`Delete "${rec.filename}"?`)) void deleteRecording(rec);
    };

    const inputRef = useRef<HTMLInputElement>(null);
    const [resumeTarget, setResumeTarget] = useState<Recording | null>(null);
    const [resumeError, setResumeError] = useState<string | null>(null);

    const chooseFileFor = (rec: Recording) => {
        setResumeTarget(rec);
        setResumeError(null);
        inputRef.current?.click();
    };

    const onPicked = (file: File | undefined) => {
        if (inputRef.current) inputRef.current.value = "";
        if (!file || !resumeTarget) return;
        if (!isSameFile(file, resumeTarget)) {
            setResumeError(`That isn't the same file as "${resumeTarget.filename}". Pick the original file to resume.`);
            return;
        }
        startUpload(file);
    };

    return (
        <section className="w-full space-y-3">
            <h2 className="text-lg font-semibold">Your uploads</h2>
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => onPicked(e.target.files?.[0])} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {resumeError && <p className="text-sm text-red-600">{resumeError}</p>}
            {recordings === null && !error && <p className="text-sm text-zinc-500">Loading…</p>}
            {recordings?.length === 0 && <p className="text-sm text-zinc-500">No uploads yet.</p>}

            <ul className="divide-y rounded-xl border border-zinc-200">
                {recordings?.map((rec) => {
                    const isActive = rec.id === activeId;
                    const stored = pendingBytes[rec.id];
                    const stage = processingStage(rec);
                    const elapsed = elapsedText(rec, now);
                    const hasFile = rec.uploaded_at !== null;
                    return (
                        <li key={rec.id} className="flex flex-col gap-1 p-4">
                            <div className="flex items-center justify-between gap-3">
                                {hasFile ? (
                                    <Link href={`/recordings/${rec.id}`} className="truncate font-medium hover:underline">
                                        {rec.filename}
                                    </Link>
                                ) : (
                                    <p className="truncate font-medium">{rec.filename}</p>
                                )}
                                <StatusBadge status={rec.status} />
                            </div>
                            <p className="text-sm text-zinc-500">
                                {formatBytes(rec.size_bytes)} · {formatDate(rec.created_at)} · {audioDetails(rec)}
                            </p>

                            {stage && (
                                <p className="text-sm text-blue-700" aria-live="polite">
                                    {stage}
                                    {elapsed && <span className="text-zinc-500"> · {elapsed}</span>}
                                </p>
                            )}

                            {rec.status === "pending_upload" && !isActive && (
                                <p className="text-sm text-amber-700">
                                    {stored !== undefined && `${Math.floor((stored / rec.size_bytes) * 100)}% uploaded. `}
                                    Select the same file again to continue where it stopped.
                                </p>
                            )}
                            {rec.status === "pending_upload" && isActive && <p className="text-sm text-blue-700">Uploading now…</p>}
                            {rec.status === "failed" && rec.error && <p className="text-sm text-red-600">{rec.error}</p>}

                            <div className="mt-1 flex gap-3 text-sm">
                                {rec.status === "transcribed" && (
                                    <Link href={`/recordings/${rec.id}`} className="font-medium text-blue-700 hover:underline">
                                        View transcript
                                    </Link>
                                )}
                                {canRetry(rec) && (
                                    <button
                                        type="button"
                                        onClick={() => void retryRecording(rec)}
                                        className="font-medium text-blue-700 hover:underline"
                                    >
                                        Retry
                                    </button>
                                )}
                                {rec.status === "pending_upload" && !isActive && (
                                    <button
                                        type="button"
                                        disabled={uploadActive}
                                        onClick={() => chooseFileFor(rec)}
                                        className="font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Resume
                                    </button>
                                )}
                                {!isActive && (
                                    <button type="button" onClick={() => remove(rec)} className="font-medium text-zinc-500 hover:text-red-600 hover:underline">
                                        Delete
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
