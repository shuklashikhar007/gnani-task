import type { RecordingStatus } from "@/app/_uploads/api";

const STYLES: Record<RecordingStatus, { label: string; className: string }> = {
    pending_upload: { label: "Incomplete", className: "bg-amber-100 text-amber-800" },
    uploaded: { label: "Queued", className: "bg-zinc-100 text-zinc-700" },
    transcribing: { label: "Transcribing", className: "bg-blue-100 text-blue-800" },
    transcribed: { label: "Transcribed", className: "bg-emerald-100 text-emerald-800" },
    failed: { label: "Failed", className: "bg-red-100 text-red-800" },
};

export default function StatusBadge({ status }: { status: RecordingStatus }) {
    const { label, className } = STYLES[status];
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
