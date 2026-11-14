import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  ...(process.env.FORMA_SITE_TEST === "1" && { distDir: ".site-test-export" }),
  trailingSlash: true,
  basePath: process.env.FORMA_SITE_BASE_PATH ?? "",
  turbopack: { root: resolve(process.cwd(), "../..") },
};

export default config;
