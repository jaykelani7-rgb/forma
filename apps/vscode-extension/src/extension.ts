import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeCodeforcesIdentity } from "../../../src/lib/codeforces-identity";
import { parseCommand } from "../../../packages/contracts/src";
import { CPH_EXTENSION_ID, SUPPORTED_CPH_VERSIONS, cphMetadataPath, pathWithinFolder, readCphBinding } from "../../../packages/integrations/cph";
import { BoundedJsonLines, defaultCompanionEndpoint, encodeTransportMessage, parseTransportResponse, type TransportCommand, type TransportRequest, type TransportResponse } from "../../../packages/integrations/protocol";
import { enqueueCommand, restoreQueue, retryCommand, type QueuedCommand } from "../../../packages/integrations/queue";

const SECRET = "forma-companion.pairing.v1";
const QUEUE = "forma-companion.queue.v1";
const FOLDERS = "forma-companion.allowed-folders.v1";
const BINDINGS = "forma-companion.bindings.v1";
type Binding = { url: string; title?: string; key: string; fileUri: string; source: "manual" | "cph"; adapterVersion?: string; sessionId?: string };

function send(request: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(defaultCompanionEndpoint());
    const lines = new BoundedJsonLines();
    let complete = false;
    const finish = (error?: Error, response?: TransportResponse) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      if (error) reject(error); else resolve(response!);
    };
    socket.setTimeout(5000, () => finish(new Error("Companion did not acknowledge this capture.")));
    socket.on("connect", () => { try { socket.write(encodeTransportMessage(request)); } catch (error) { finish(error as Error); } });
    socket.on("data", (chunk: Buffer) => { try { const batch = lines.push(chunk); if (batch.length) finish(undefined, parseTransportResponse(batch[0], request.id)); } catch (error) { finish(error as Error); } });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("Companion closed before acknowledging this capture.")));
  });
}

export async function activate(context: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 60);
  status.command = "formaCompanion.open";
  status.name = "Forma Companion";
  status.show();
  context.subscriptions.push(status);
  let disposed = false;
  let queue: QueuedCommand[] = [];
  let queueRecovery = false;
  try { queue = restoreQueue(context.workspaceState.get(QUEUE, [])); } catch { queueRecovery = true; }
  let allowed = context.workspaceState.get<string[]>(FOLDERS, []);
  const bindings = context.workspaceState.get<Record<string, Binding>>(BINDINGS, {});
  let flushing = false;
  let changingQueue = Promise.resolve();
  let metadataWatcher: vscode.FileSystemWatcher | undefined;
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;
  let connection = "Not paired";
  const local = () => !vscode.env.remoteName && vscode.workspace.isTrusted;
  const renderStatus = () => {
    const state = vscode.env.remoteName ? "Remote workspace: limited" : !vscode.workspace.isTrusted ? "Trust required" : queueRecovery ? "Queue recovery needed" : queue[0]?.blocked ? "Capture needs attention" : queue.length ? `${queue.length} pending` : connection;
    status.text = `$(leaf) Forma · ${state}`;
    status.tooltip = `Local Forma Companion. CPH metadata: ${SUPPORTED_CPH_VERSIONS.join(", ")}; local test results unavailable.`;
  };
  renderStatus();
  function requireLocal() {
    if (vscode.env.remoteName) throw new Error("Forma currently supports local VS Code folders. Remote SSH, WSL, containers and Codespaces need a separate transport.");
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before enabling Forma tracking or sending pending captures.");
  }
  async function selectedSolution() {
    requireLocal();
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== "file") throw new Error("Open a local solution file first.");
    const actual = await realpath(document.uri.fsPath);
    const roots = await Promise.all(allowed.map((folder) => realpath(folder).catch(() => "")));
    if (!allowed.some((folder) => pathWithinFolder(document.uri.fsPath, folder)) || !roots.some((folder) => folder && pathWithinFolder(actual, folder))) throw new Error("Select this solution folder with Forma: Select Allowed Folders first.");
    return document;
  }
  async function credential() {
    const token = await context.secrets.get(SECRET);
    if (!token) throw new Error("Pair with Forma Companion first.");
    return token;
  }
  async function persistQueue(next: QueuedCommand[]) {
    await context.workspaceState.update(QUEUE, next);
    queue = next;
    renderStatus();
  }
  async function rememberHostContext(response: TransportResponse) {
    if (!response.ok || typeof response.identity !== "string" || !(response.sessionId === null || typeof response.sessionId === "string")) return;
    let changed = false;
    for (const binding of Object.values(bindings)) {
      if (binding.key !== response.identity) continue;
      if (binding.sessionId !== (response.sessionId ?? undefined)) {
        binding.sessionId = typeof response.sessionId === "string" ? response.sessionId : undefined;
        changed = true;
      }
    }
    if (changed) await context.workspaceState.update(BINDINGS, bindings);
  }
  function serializeQueue(operation: () => Promise<void>): Promise<void> {
    const result = changingQueue.then(operation);
    changingQueue = result.catch(() => {});
    return result;
  }
  async function flush() {
    if (flushing || disposed || !local() || queueRecovery) return;
    const token = await context.secrets.get(SECRET);
    if (!token) return;
    flushing = true;
    try {
      await serializeQueue(async () => {
        while (!disposed && local() && queue.length && !queue[0].blocked && queue[0].nextAttemptAt <= Date.now()) {
          const entry = queue[0];
          try {
            const response = await send({ version: 1, id: entry.command.id, credential: token, command: entry.command });
            if (!response.ok) {
              await persistQueue([{ ...entry, blocked: response.error }, ...queue.slice(1)]);
              connection = "Needs attention";
              void vscode.window.showWarningMessage(`Forma kept your capture locally: ${response.error}`);
              break;
            }
            // Acknowledge only after the host reports its durable local revision.
            await rememberHostContext(response);
            await persistQueue(queue.filter((pending) => pending.command.id !== entry.command.id));
            connection = "Connected";
          } catch {
            await persistQueue([retryCommand(entry, Date.now()), ...queue.filter((pending) => pending.command.id !== entry.command.id)]);
            connection = "Offline";
            break;
          }
        }
      });
    } catch {
      connection = "Local queue needs recovery";
      queueRecovery = true;
    } finally { flushing = false; renderStatus(); }
  }
  async function enqueue(command: TransportCommand) {
    requireLocal();
    await credential();
    if (queueRecovery) throw new Error("Export the existing queue for recovery before adding captures.");
    const parsed = parseCommand({ ...command, occurredAt: command.occurredAt ?? new Date().toISOString() });
    await serializeQueue(async () => persistQueue(enqueueCommand(queue, parsed, Date.now())));
    void flush();
  }
  async function action(action: "open" | "memory" | "ping") {
    requireLocal();
    const response = await send({ version: 1, id: randomUUID(), credential: await credential(), action });
    if (!response.ok) throw new Error(response.error);
    connection = "Connected";
    await rememberHostContext(response);
    renderStatus();
    return response;
  }
  async function selectFolders() {
    requireLocal();
    const folders = vscode.workspace.workspaceFolders?.filter((folder) => folder.uri.scheme === "file") ?? [];
    if (!folders.length) throw new Error("Open a local folder before enabling Forma tracking.");
    const choice = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, picked: allowed.includes(folder.uri.fsPath), folder })), { canPickMany: true, title: "Allow Forma to associate files in these folders", placeHolder: "No source contents are read or uploaded. Metadata stays local." });
    if (!choice) return;
    allowed = choice.map((item) => item.folder.uri.fsPath);
    await context.workspaceState.update(FOLDERS, allowed);
    await watchActive();
  }
  async function activeBinding(): Promise<Binding> {
    const document = await selectedSolution();
    const binding = bindings[document.uri.toString()];
    if (!binding) throw new Error("Attach a Codeforces URL to this file first.");
    return binding;
  }
  async function capture(type: string, payload: Record<string, unknown> = {}) {
    const binding = await activeBinding();
    // Timers need a live host clock. Queued notes remain useful without inventing
    // the duration of an offline work interval.
    if (["start", "pause", "resume", "finish"].includes(type)) await action("ping");
    if (["pause", "resume", "finish", "reflect"].includes(type) && !binding.sessionId) {
      if (queue.length) throw new Error("Reconnect before controlling a session whose identity has not been confirmed.");
      await action("ping");
      if (!binding.sessionId) throw new Error("Start a session from Forma for this file before using this action.");
    }
    const id = randomUUID();
    await enqueue({ id, type, payload, expectedProblemKey: binding.key, ...(type !== "start" && binding.sessionId ? { expectedSessionId: binding.sessionId } : {}) });
    if (type === "start") {
      binding.sessionId = `companion:${id}`;
      await context.workspaceState.update(BINDINGS, bindings);
    }
  }
  async function attach(binding: Binding) {
    const document = await selectedSolution();
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    await enqueue({ id: randomUUID(), type: "attach", payload: { url: binding.url, ...(binding.title ? { title: binding.title.slice(0, 300) } : {}), fileUri: binding.fileUri, workspaceId: folder?.uri.toString(), source: binding.source, ...(binding.adapterVersion ? { adapterVersion: binding.adapterVersion } : {}) } });
    bindings[document.uri.toString()] = binding;
    await context.workspaceState.update(BINDINGS, bindings);
  }
  async function inspectMetadata() {
    if (disposed || !local() || !vscode.workspace.getConfiguration("formaCompanion").get<boolean>("cphMetadataEnabled", false)) return;
    const document = await selectedSolution();
    const extension = vscode.extensions.getExtension(CPH_EXTENSION_ID);
    if (!extension) return;
    const version = String(extension.packageJSON.version);
    const result = await readCphBinding({ solutionPath: document.uri.fsPath, version, permittedFolders: allowed, saveLocation: vscode.workspace.getConfiguration("cph", document.uri).get<string>("general.saveLocation", "") });
    if (!result.ok) { if (result.reason === "unsupported-version") { connection = "CPH version unsupported"; renderStatus(); } return; }
    const previous = bindings[document.uri.toString()];
    if (previous?.source === "manual" || (previous?.url === result.binding.url && previous.adapterVersion === version)) return;
    await attach({ url: result.binding.url, title: result.binding.title, key: result.binding.problemKey, fileUri: result.binding.fileUri, source: "cph", adapterVersion: version });
  }
  function scheduleMetadata() {
    if (metadataTimer) clearTimeout(metadataTimer);
    metadataTimer = setTimeout(() => { void inspectMetadata().catch(() => {}); }, 350);
  }
  async function watchActive() {
    metadataWatcher?.dispose();
    metadataWatcher = undefined;
    if (!local() || !allowed.length || !vscode.workspace.getConfiguration("formaCompanion").get<boolean>("cphMetadataEnabled", false)) return;
    try {
      const document = await selectedSolution();
      const metadata = cphMetadataPath(document.uri.fsPath, vscode.workspace.getConfiguration("cph", document.uri).get<string>("general.saveLocation", ""));
      if (!allowed.some((folder) => pathWithinFolder(metadata, folder))) return;
      // One exact metadata file for the active solution; no recursive scan.
      metadataWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(metadata), path.basename(metadata)));
      metadataWatcher.onDidChange(scheduleMetadata);
      metadataWatcher.onDidCreate(scheduleMetadata);
      scheduleMetadata();
    } catch { /* Unselected or unavailable files remain untouched. */ }
  }
  function register(name: string, run: () => unknown) {
    context.subscriptions.push(vscode.commands.registerCommand(`formaCompanion.${name}`, async () => { try { await run(); } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Forma could not complete this action."); } }));
  }
  register("pair", async () => {
    requireLocal();
    const token = await vscode.window.showInputBox({ title: "Pair Forma Companion", prompt: "Paste the pairing credential from Companion settings", password: true, ignoreFocusOut: true, validateInput: (value) => /^[A-Za-z0-9_-]{32,256}$/.test(value.trim()) ? undefined : "Use the pairing credential shown by Forma Companion." });
    if (!token) return;
    const response = await send({ version: 1, id: randomUUID(), credential: token.trim(), action: "ping" });
    if (!response.ok) throw new Error(response.error);
    await context.secrets.store(SECRET, token.trim());
    connection = "Connected";
    await selectFolders();
    renderStatus();
    void flush();
  });
  register("unpair", async () => { await context.secrets.delete(SECRET); connection = "Not paired"; metadataWatcher?.dispose(); renderStatus(); });
  register("selectFolders", selectFolders);
  register("attachProblem", async () => {
    const document = await selectedSolution();
    const url = await vscode.window.showInputBox({ title: "Attach Codeforces Problem", prompt: "Confirm the Codeforces problem for this solution file", ignoreFocusOut: true, validateInput: (value) => /^https?:\/\//.test(value) && normalizeCodeforcesIdentity({ url: value }) ? undefined : "Enter a Codeforces problem URL, including its full index." });
    if (!url) return;
    const identity = normalizeCodeforcesIdentity({ url })!;
    await attach({ url: identity.url, key: identity.key, fileUri: document.uri.toString(), source: "manual" });
  });
  register("open", () => action("open"));
  register("memory", async () => { const binding = await activeBinding(); const response = await action("ping"); if (response.identity !== binding.key) throw new Error("Attach this file's problem before opening its prior memory."); return action("memory"); });
  register("saveThought", async () => { const text = await vscode.window.showInputBox({ title: "Save Thought", prompt: "A short observation for this problem", validateInput: (value) => value.trim() && value.length <= 10000 ? undefined : "Write up to 10,000 characters." }); if (text) await capture("thought", { text }); });
  register("start", () => capture("start"));
  register("pause", () => capture("pause"));
  register("resume", () => capture("resume"));
  register("finish", async () => {
    await capture("finish");
    const choice = await vscode.window.showQuickPick([{ label: "Independent", outcome: "independent" }, { label: "Used a hint", outcome: "hint" }, { label: "Used an editorial", outcome: "editorial" }, { label: "Still unsolved", outcome: "unsolved" }, { label: "Reflect later", outcome: null }], { title: "How did this attempt go?", placeHolder: "Acceptance does not choose your learning outcome." });
    if (!choice?.outcome) return;
    const takeaway = await vscode.window.showInputBox({ title: "Reflection", prompt: "What would you like to remember? (optional)", ignoreFocusOut: true, validateInput: (value) => value.length <= 300 ? undefined : "Keep the takeaway below 300 characters." });
    if (takeaway === undefined) return;
    await capture("reflect", { outcome: choice.outcome, takeaway });
  });
  register("runCphTests", async () => {
    await selectedSolution();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("cph.runTestCases")) throw new Error("The CPH Run Testcases command is unavailable.");
    await vscode.commands.executeCommand("cph.runTestCases");
    void vscode.window.setStatusBarMessage("Forma requested CPH tests. Check CPH for results; Forma has no supported result feed.", 7000);
  });
  register("retry", async () => { requireLocal(); await serializeQueue(async () => persistQueue(queue.map((entry) => { const next = { ...entry, nextAttemptAt: Date.now() }; delete next.blocked; return next; }))); await flush(); });
  register("exportQueue", async () => {
    const destination = await vscode.window.showSaveDialog({ title: "Export Forma Pending Captures", defaultUri: vscode.Uri.file(path.join(allowed[0] ?? process.cwd(), "forma-pending-captures.json")), filters: { JSON: ["json"] } });
    if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify({ format: "forma-vscode-queue-v1", queue: context.workspaceState.get(QUEUE, []) }, null, 2)));
  });
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => { void watchActive(); }), vscode.workspace.onDidGrantWorkspaceTrust(() => { renderStatus(); void watchActive(); void flush(); }), vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration("formaCompanion") || event.affectsConfiguration("cph.general.saveLocation")) void watchActive(); }));
  const interval = setInterval(() => { if (queue.length) void flush(); }, 1000);
  const heartbeat = setInterval(() => { if (local() && !queue.length) void context.secrets.get(SECRET).then((token) => token ? action("ping").catch(() => { connection = "Offline"; renderStatus(); }) : undefined); }, 30000);
  context.subscriptions.push({ dispose: () => { disposed = true; clearInterval(interval); clearInterval(heartbeat); if (metadataTimer) clearTimeout(metadataTimer); metadataWatcher?.dispose(); } });
  if (await context.secrets.get(SECRET)) { connection = "Reconnecting"; void flush(); }
  renderStatus();
  await watchActive();
}

export function deactivate() { /* VS Code disposes registered resources. */ }
