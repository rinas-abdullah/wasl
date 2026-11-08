import type { NextConfig } from "next";

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@wasl/shared"],
  poweredByHeader: false,
  output: "standalone",
  // The browser only ever talks to this origin; /api/* is proxied to the Node API so the
  // HttpOnly session cookie stays first-party (SameSite=Lax) and no CORS is needed.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
