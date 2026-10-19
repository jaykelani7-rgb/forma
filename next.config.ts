import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.FORMA_BUILD_DIR || ".next",
  ...(process.env.FORMA_BUILD_DIR === ".next-share-links"
    ? { typescript: { tsconfigPath: "tsconfig.share-links.json" } }
    : {}),
  devIndicators: false,
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: "/share/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};
export default config;
