import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "share-links.spec.ts",
  fullyParallel: true,
  retries: 0,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:3003", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node --import tsx tests/fixtures/share-service.ts",
      url: "http://127.0.0.1:54399/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run start -- --port 3003",
      url: "http://127.0.0.1:3003",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        FORMA_BUILD_DIR: ".next-share-links",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_local_fixture_only",
        SUPABASE_SECRET_KEY: "sb_secret_local_fixture_only",
      },
    },
  ],
});
