import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, symlink, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { CompanionStore } from "../../apps/desktop/main/store";
import { connect } from "node:net";
import { startBrowserTransport } from "../../apps/desktop/main/browser-transport";
import type { BrowserReply } from "../../packages/integrations/browser";
import { startTransport } from "../../apps/desktop/main/transport";
import { RecognitionHub } from "../../apps/desktop/main/recognition";
import { SUPPORTED_CPH_VERSIONS } from "../../packages/integrations/cph";
async function main() {
const directory = await mkdtemp(join(tmpdir(), "forma-vscode-recognition-"));
const folder = join(directory, "practice"), extensions = join(directory, "extensions");
await mkdir(folder); await mkdir(extensions);
const cph = `divyanshuagrawal.competitive-programming-helper-${SUPPORTED_CPH_VERSIONS[0]}`;
await symlink(join(homedir(), ".vscode/extensions", cph), join(extensions, cph));
const profile = join(directory, "profile"); await mkdir(join(profile, "User"), { recursive: true });
await writeFile(join(profile, "User/settings.json"), JSON.stringify({ "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false, "cph.general.firstTime": false, "cph.general.autoShowJudge": false, "cph.general.defaultLanguage": "cpp" }));
await build({ entryPoints: ["scripts/companion/vscode-recognition-tests.ts"], outfile: ".companion-build/vscode-recognition-tests.cjs", bundle: true, platform: "node", format: "cjs", external: ["vscode"] });
const store = new CompanionStore(join(directory, "notebook.sqlite")), token = randomBytes(32).toString("base64url"), endpoint = join(directory, "runtime/companion.sock");
const hub = new RecognitionHub({ snapshot: async () => store.snapshot(), command: async c => store.command(c), select: async (file, client) => store.selectBinding(file, client), changed: () => {} });
let lostAck = false;
const server = await startTransport({ endpoint, credential: () => token, command: async c => store.command(c), recognition: async r => { const result = await hub.request(r); if (r.reason === "observe" && r.binding?.source === "cph" && !lostAck) { lostAck = true; throw new Error("Simulated lost recognition acknowledgement."); } return result; }, action: async () => store.snapshot().revision, context: async () => ({ identity: store.snapshot().state.identity, sessionId: store.snapshot().data.session?.id ?? null, hostEpoch: "isolated-test-host" }), connected: () => {} });
const browserCredential = randomBytes(32).toString("base64url"), browserEndpoint = join(directory, "runtime/browser.sock");
const browserServer = await startBrowserTransport({ endpoint: browserEndpoint, credential: () => browserCredential, message: m => hub.browser(m) });
function browserRequest(message: unknown): Promise<BrowserReply> { return new Promise((resolve, reject) => { const socket = connect(browserEndpoint); let data = ""; socket.on("connect", () => socket.write(JSON.stringify({ credential: browserCredential, message }) + "\n")); socket.on("error", reject); socket.on("data", chunk => { data += chunk; if (data.includes("\n")) { socket.destroy(); resolve(JSON.parse(data)); } }); socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Browser test socket timed out.")); }); }); }
try {
  const code = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const child = spawn(code, ["--new-window", "--wait", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--user-data-dir", profile, "--extensions-dir", extensions, `--extensionDevelopmentPath=${resolve("apps/vscode-extension")}`, `--extensionTestsPath=${resolve(".companion-build/vscode-recognition-tests.cjs")}`, folder], { env: { ...process.env, FORMA_TEST_ENDPOINT: endpoint, FORMA_TEST_CREDENTIAL: token }, stdio: "inherit" });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 90000);
  const browserWork = (async () => {
    const deadline = Date.now() + 60000;
    while (true) { try { await readFile(join(folder, "browser-ready.json")); break; } catch { if (Date.now() > deadline) throw new Error("VS Code did not reach browser delivery test."); await new Promise(r => setTimeout(r, 100)); } }
    const proposal = await browserRequest({ kind: "propose", url: "https://codeforces.com/contest/6/problem/B", title: "B. President's Office" });
    if (!proposal.ok || proposal.targets?.length !== 1) throw new Error("Expected exactly one frozen browser target.");
    let result = await browserRequest({ kind: "confirm", proposalId: proposal.proposalId, targetId: proposal.targets[0].id });
    while (result.status === "waiting" && Date.now() < deadline) { await new Promise(r => setTimeout(r, 100)); result = await browserRequest({ kind: "status", proposalId: proposal.proposalId }); }
    if (result.status !== "saved") throw new Error("Browser delivery was not durably acknowledged: " + result.status);
  })();
  const exit = await new Promise<number | null>((done, reject) => { child.once("exit", done); child.once("error", reject); }); clearTimeout(timeout);
  await browserWork;
  if (exit !== 0) throw new Error(`VS Code extension host exited ${exit}. Isolated logs: ${directory}`);
  const report = JSON.parse(await readFile(join(folder, "live-results.json"), "utf8"));
  console.log(JSON.stringify({ ...report, recoveredLostAcknowledgement: lostAck, browserScopedSocket: true, bindingsInActualSQLite: store.snapshot().state.bindings.length, selectedIdentity: store.snapshot().state.identity, isolatedDirectory: directory }, null, 2));
} finally { hub.reset(); server.close(); browserServer.close(); store.close(); }

}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
