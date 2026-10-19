import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const env = {
  ...process.env,
  FORMA_BUILD_DIR: ".next-share-links",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_fixture_only",
  SUPABASE_SECRET_KEY: "sb_secret_local_fixture_only",
};
const nextEnvironment = readFileSync("next-env.d.ts", "utf8");
let status = 1;
try {
  const build = spawnSync("npm", ["run", "build", "--", "--webpack"], {
    env,
    stdio: "inherit",
  });
  if (build.status === 0) {
    const browser = spawnSync(
      "npx",
      [
        "--no-install",
        "playwright",
        "test",
        "--config=playwright.links.config.ts",
        ...process.argv.slice(2),
      ],
      { env, stdio: "inherit" },
    );
    status = browser.status ?? 1;
  }
} finally {
  // The isolated build regenerates this ordinary-app file. Restore its exact
  // prior contents on success, build failure or browser failure.
  writeFileSync("next-env.d.ts", nextEnvironment);
}
process.exitCode = status;
