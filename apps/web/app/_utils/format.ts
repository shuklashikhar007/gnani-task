export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "45s", "3m 20s", "1h 02m". */
export function formatDuration(totalSeconds: number) {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Timestamp for a position in audio: "01:05" or "1:02:05". */
export function formatClock(totalSeconds: number) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}
