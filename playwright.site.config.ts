import { defineConfig, devices } from "@playwright/test";
import {
  siteBasePath,
  siteDownloadUrl,
  siteNotebookOrigin,
  siteWaitlistUrl,
} from "./tests/site/fixtures";

export default defineConfig({
  testDir: "./tests/site",
  outputDir: "./test-results/site",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3005", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node tests/site/serve.mjs",
    env: {
      FORMA_SITE_BASE_PATH: siteBasePath,
      FORMA_SITE_TEST: "1",
      FORMA_MAC_DOWNLOAD_URL: siteDownloadUrl,
      FORMA_WINDOWS_WAITLIST_URL: siteWaitlistUrl,
      FORMA_NOTEBOOK_ORIGIN: siteNotebookOrigin,
    },
    url: `http://127.0.0.1:3005${siteBasePath}/`,
    timeout: 120_000,
  },
});
