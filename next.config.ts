import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone): the smallest runtime footprint for a 256 MB host.
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true }, // no image optimizer (sharp) in memory
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
