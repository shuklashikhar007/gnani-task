"use client";

import { useEffect, useRef, useState } from "react";

import { formatBytes } from "@/app/_utils/format";
import { LANGUAGES } from "@/app/_uploads/languages";
import { isUploading, useUploads } from "@/app/_uploads/store";

const ACCEPT = ".wav,.mp3,.mp4,.flac,.ogg,.opus,.m4a,.aac,.webm,.amr,audio/*";

export default function UploadPanel() {
    const active = useUploads(isUploading);
    const startUpload = useUploads((s) => s.startUpload);
    const hasUpload = useUploads((s) => s.upload !== null);
    const language = useUploads((s) => s.language);
    const setLanguage = useUploads((s) => s.setLanguage);
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    // Warn before leaving mid-upload. Finished parts are kept, but the user has to pick the file again.
    useEffect(() => {
        if (!active) return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [active]);

    const pick = (files: FileList | null) => {
        const file = files?.[0];
        if (file) startUpload(file);
        if (inputRef.current) inputRef.current.value = "";
    };

    return (
        <section className="w-full space-y-4">
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    pick(e.dataTransfer.files);
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                    dragging ? "border-blue-500 bg-blue-50" : "border-zinc-300"
                } ${active ? "opacity-50" : ""}`}
            >
                <p className="font-medium">Drop an audio file here</p>
                <p className="text-sm text-zinc-500">WAV, MP3, M4A, FLAC, OGG, AAC, WebM… up to 2 GB</p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-zinc-600">
                        Spoken language
                        <select
                            value={language}
                            disabled={active}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 disabled:opacity-50"
                        >
                            {LANGUAGES.map((l) => (
                                <option key={l.code} value={l.code}>
                                    {l.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        disabled={active}
                        onClick={() => inputRef.current?.click()}
                        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Choose file
                    </button>
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => pick(e.target.files)}
                />
            </div>

            {hasUpload && <Progress />}
        </section>
    );
}

function Progress() {
    const s = useUploads((state) => state.upload)!;
    const { pause, resume, cancel, dismiss } = useUploads.getState();
    const percent = s.totalBytes ? Math.floor((s.uploadedBytes / s.totalBytes) * 100) : 0;
    const barColor =
        s.state === "error"
            ? "bg-red-500"
            : s.state === "done"
              ? "bg-emerald-500"
              : s.state === "paused" || s.state === "offline"
                ? "bg-amber-500"
                : "bg-blue-500";
    const finished = s.state === "done" || s.state === "cancelled";
    const canPause = ["uploading", "retrying", "offline"].includes(s.state);
    const canResume = s.state === "paused" || s.state === "error";

    return (
        <div className="rounded-xl border border-zinc-200 p-4 space-y-3" aria-live="polite">
            <div className="flex items-baseline justify-between gap-4">
                <p className="truncate font-medium">{s.fileName}</p>
                <p className="shrink-0 text-sm tabular-nums text-zinc-600">{percent}%</p>
            </div>

            <div
                className="h-2 w-full overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className={`h-full transition-[width] duration-200 ${barColor}`}
                    style={{ width: `${percent}%` }}
                />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600">
                <span className="tabular-nums">
                    {formatBytes(s.uploadedBytes)} of {formatBytes(s.totalBytes)}
                    {s.partCount > 0 && ` · part ${s.partsDone} of ${s.partCount}`}
                    {s.state === "uploading" && s.bytesPerSecond > 0 && ` · ${formatBytes(s.bytesPerSecond)}/s`}
                </span>
                <div className="flex gap-2">
                    {canPause && <Button onClick={pause}>Pause</Button>}
                    {canResume && <Button onClick={resume}>{s.state === "error" ? "Retry" : "Resume"}</Button>}
                    {!finished && <Button onClick={() => void cancel()}>Cancel</Button>}
                    {finished && <Button onClick={dismiss}>Dismiss</Button>}
                </div>
            </div>

            {s.message && (
                <p
                    className={`text-sm ${s.state === "error" ? "text-red-600" : s.state === "offline" || s.state === "retrying" ? "text-amber-700" : "text-zinc-600"}`}
                >
                    {s.message}
                </p>
            )}
        </div>
    );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50"
        >
            {children}
        </button>
    );
}
