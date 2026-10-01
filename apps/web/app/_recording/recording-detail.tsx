"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type RecordingDetail as Detail, type Summary, UNFINISHED_STATUSES } from "@/app/_uploads/api";
import { audioDetails, canRetry, elapsedText, hasTranscript, isTicking, processingStage } from "@/app/_uploads/processing";
import StatusBadge from "@/app/_uploads/status-badge";
import { formatBytes, formatClock, formatDate } from "@/app/_utils/format";
import { useNow } from "@/app/_utils/use-now";

const POLL_MS = 3000;

export default function RecordingDetail({ id }: { id: string }) {
    const [rec, setRec] = useState<Detail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    const load = useCallback(async () => {
        try {
            setRec(await api.refreshRecording(id));
            setError(null);
        } catch (err) {
            if (err instanceof ApiError && err.status === 404) setNotFound(true);
            else setError(err instanceof Error ? err.message : "Couldn't load this recording.");
        }
    }, [id]);

    const unfinished = rec !== null && UNFINISHED_STATUSES.includes(rec.status);
    const now = useNow(rec !== null && isTicking(rec));

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the request resolves
        void load();
    }, [load]);

    // Same approach as the list: poll until finished. Each poll also advances the transcription on the server.
    useEffect(() => {
        if (!unfinished) return;
        const timer = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(timer);
    }, [unfinished, load]);

    const retry = async () => {
        try {
            await api.retryRecording(id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't retry.");
        }
        await load();
    };

    if (notFound) {
        return (
            <div className="space-y-3">
                <BackLink />
                <p>This recording doesn&apos;t exist, or it belongs to another browser.</p>
            </div>
        );
    }
    if (!rec) {
        return (
            <div className="space-y-3">
                <BackLink />
                <p className="text-sm text-zinc-500">{error ?? "Loading…"}</p>
            </div>
        );
    }

    const stage = processingStage(rec);
    const elapsed = elapsedText(rec, now);

    return (
        <div className="space-y-8">
            <BackLink />

            <header className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                    <h1 className="break-all text-2xl font-semibold">{rec.filename}</h1>
                    <StatusBadge status={rec.status} />
                </div>
                <p className="text-sm text-zinc-500">
                    {formatBytes(rec.size_bytes)} · uploaded {formatDate(rec.uploaded_at ?? rec.created_at)} · {audioDetails(rec)}
                </p>
            </header>

            <Stepper rec={rec} />

            {stage && (
                <p className="text-sm text-blue-700" aria-live="polite">
                    {stage}
                    {elapsed && <span className="text-zinc-500"> · {elapsed}</span>}
                </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {rec.status === "failed" && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm text-red-700">{rec.error ?? "Something went wrong."}</p>
                    {canRetry(rec) && (
                        <button type="button" onClick={() => void retry()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
                            {hasTranscript(rec) ? "Retry summary" : "Retry transcription"}
                        </button>
                    )}
                </div>
            )}

            {rec.summary ? (
                <SummarySection summary={rec.summary} />
            ) : (
                (rec.status === "transcribed" || rec.status === "summarizing") && (
                    <section className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-4">
                        <h2 className="text-lg font-semibold">Summary</h2>
                        <p className="text-sm text-zinc-500">Generating the summary...</p>
                    </section>
                )
            )}

            {hasTranscript(rec) && rec.transcript && <Transcript rec={rec} />}
        </div>
    );
}

function BackLink() {
    return (
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← All uploads
        </Link>
    );
}

const STEPS = ["Uploaded", "Transcribing", "Summarizing", "Done"] as const;

/** How far the recording got: steps before `reached` are done; `active` is in progress; `failedAt` failed. */
function stepState(rec: Detail): { reached: number; active: number | null; failedAt: number | null } {
    switch (rec.status) {
        case "pending_upload":
            return { reached: 0, active: 0, failedAt: null };
        case "uploaded":
        case "transcribing":
            return { reached: 1, active: 1, failedAt: null };
        case "transcribed":
        case "summarizing":
            return { reached: 2, active: 2, failedAt: null };
        case "completed":
            return { reached: STEPS.length, active: null, failedAt: null };
        case "failed": {
            const at = hasTranscript(rec) ? 2 : rec.uploaded_at ? 1 : 0;
            return { reached: at, active: null, failedAt: at };
        }
    }
}

function Stepper({ rec }: { rec: Detail }) {
    const { reached, active, failedAt } = stepState(rec);
    return (
        <ol className="flex flex-wrap items-center gap-2 text-sm">
            {STEPS.map((label, i) => {
                const done = i < reached;
                const dot = i === failedAt ? "bg-red-500" : done ? "bg-emerald-500" : i === active ? "bg-blue-500 animate-pulse" : "bg-zinc-300";
                const text = i === failedAt ? "text-red-700" : done || i === active ? "text-zinc-900" : "text-zinc-400";
                return (
                    <li key={label} className="flex items-center gap-2">
                        {i > 0 && <span className="h-px w-6 bg-zinc-300" />}
                        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                        <span className={text}>{label}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function SummarySection({ summary }: { summary: Summary }) {
    return (
        <section className="space-y-4 rounded-xl border border-zinc-200 p-5">
            <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Summary</p>
                <h2 className="text-xl font-semibold">{summary.title}</h2>
            </div>
            <p className="leading-relaxed">{summary.overview}</p>
            {summary.key_points.length > 0 && (
                <div className="space-y-2">
                    <h3 className="font-medium">Key points</h3>
                    <ul className="list-disc space-y-1 pl-5">
                        {summary.key_points.map((point, i) => (
                            <li key={i}>{point}</li>
                        ))}
                    </ul>
                </div>
            )}
            {summary.action_items.length > 0 && (
                <div className="space-y-2">
                    <h3 className="font-medium">Action items</h3>
                    <ul className="list-disc space-y-1 pl-5">
                        {summary.action_items.map((item, i) => (
                            <li key={i}>{item}</li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function Transcript({ rec }: { rec: Detail }) {
    const [copied, setCopied] = useState(false);
    const segments = rec.segments?.filter((s) => s.text?.trim()) ?? [];

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(rec.transcript ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard can be blocked; the text is still selectable.
        }
    };

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Transcript</h2>
                <button type="button" onClick={() => void copy()} className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50">
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            {segments.length > 0 ? (
                <ol className="space-y-2 rounded-xl border border-zinc-200 p-4">
                    {segments.map((s, i) => (
                        <li key={i} className="flex gap-3 leading-relaxed">
                            <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-400 tabular-nums">{formatClock(s.start_time)}</span>
                            <span>{s.text}</span>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="whitespace-pre-wrap rounded-xl border border-zinc-200 p-4 leading-relaxed">{rec.transcript}</p>
            )}
        </section>
    );
}
