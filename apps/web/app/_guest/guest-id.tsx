"use client";

import { useEffect, useState } from "react";

export default function GuestId() {
    const [guestId, setGuestId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/whoami")
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data: { guest_id: string }) => setGuestId(data.guest_id))
            .catch((err: Error) => setError(err.message));
    }, []);

    if (error) return <p className="text-red-600">Failed to load guest ID: {error}</p>;
    if (!guestId) return <p className="text-zinc-500">Loading guest ID…</p>;
    return (
        <p>
            Your guest ID: <code className="font-mono">{guestId}</code>
        </p>
    );
}
