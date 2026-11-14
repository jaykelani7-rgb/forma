import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  globalIgnores([
    ".next/**",
    ".next-share-links/**",
    "node_modules/**",
    "test-results/**",
    "playwright-report/**",
    "public/import-assets/**",
    ".companion-build/**",
    "dist/**",
    "apps/site/.next/**",
    "apps/site/.site-test-export/**",
    "apps/site/next-env.d.ts",
    "apps/site/out/**",
    "apps/vscode-extension/dist/**",
  ]),
]);
