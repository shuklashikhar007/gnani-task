"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed every `intervalMs` while `enabled` (for "elapsed" counters). */
export function useNow(enabled: boolean, intervalMs = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!enabled) return;
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [enabled, intervalMs]);
    return now;
}
