import { readFile } from "node:fs/promises";
import { Arch, Platform, build } from "electron-builder";

if (process.platform !== "darwin") throw new Error("Build the Mac release on macOS.");
const hasNotaryCredentials = process.env.APPLE_KEYCHAIN_PROFILE ||
  [process.env.APPLE_ID, process.env.APPLE_APP_SPECIFIC_PASSWORD, process.env.APPLE_TEAM_ID].every(Boolean) ||
  [process.env.APPLE_API_KEY, process.env.APPLE_API_KEY_ID, process.env.APPLE_API_ISSUER].every(Boolean);
if (!hasNotaryCredentials) throw new Error("Configure Apple notarization credentials before building the public DMG.");

const config = JSON.parse(await readFile("apps/desktop/electron-builder.json", "utf8"));
delete config.mac.identity;
config.mac.notarize = true;
config.forceCodeSigning = true;
config.directories.output = "../dist/forma-mac";
config.artifactName = "Forma-${version}-${arch}.${ext}";

await build({
  projectDir: ".companion-build",
  targets: Platform.MAC.createTarget(["dmg"], Arch.arm64),
  config,
});
