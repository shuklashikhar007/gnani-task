import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
    // Proxy /api/* to the FastAPI backend so cookies it sets stay first-party.
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: `${API_URL}/:path*`,
            },
        ];
    },
};

export default nextConfig;
