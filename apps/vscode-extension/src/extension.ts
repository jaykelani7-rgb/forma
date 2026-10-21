import * as vscode from "vscode";
import { randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import { parseCommand } from "../../../packages/contracts/src";
import { CPH_EXTENSION_ID, SUPPORTED_CPH_VERSIONS, cphMetadataPath, pathWithinFolder, readCphBindingWithRetry } from "../../../packages/integrations/cph";
import { BoundedJsonLines, defaultCompanionEndpoint, encodeTransportMessage, parseTransportResponse, type TransportCommand, type TransportRequest, type TransportResponse } from "../../../packages/integrations/protocol";
import { RecognitionGeneration, type RecognisedBinding, type EditorContext, type BrowserDelivery } from "../../../packages/integrations/recognition";
import { enqueueCommand, restoreQueue, retryCommand, type QueuedCommand } from "../../../packages/integrations/queue";
import { collectExplicitCode, sameCodeSource, type CodeSourceFence } from "../../../packages/integrations/tutor-code";
import { companionConnectionError } from "../../../packages/integrations/connection-error";

const SECRET = "forma-companion.pairing.v1", QUEUE = "forma-companion.queue.v1", FOLDERS = "forma-companion.allowed-folders.v1", BINDINGS = "forma-companion.bindings.v1";
type Binding = RecognisedBinding & { id?: string; key: string; fileUri: string; sessionId?: string };
type Target = { fileUri: string; key: string; sessionId?: string };
let testEndpoint: string | undefined;
function send(request: TransportRequest, signal?: AbortSignal): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(testEndpoint ?? defaultCompanionEndpoint());
    const lines = new BoundedJsonLines(); let complete = false;
    const abort = () => finish(new Error("Observation cancelled."));
    const finish = (error?: Error, response?: TransportResponse) => {
      if (complete) return; complete = true; signal?.removeEventListener("abort", abort); socket.destroy();
      if (error) reject(error); else resolve(response!);
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(request.recognition?.reason === "poll" ? 25000 : 5000, () => finish(new Error("Companion did not acknowledge this capture.")));
    socket.on("connect", () => { try { socket.write(encodeTransportMessage(request)); } catch (error) { finish(error as Error); } });
    socket.on("data", (chunk: Buffer) => { try { const batch = lines.push(chunk); if (batch.length) finish(undefined, parseTransportResponse(batch[0], request.id)); } catch (error) { finish(error as Error); } });
    socket.on("error", error => finish(companionConnectionError(error))); socket.on("end", () => finish(new Error("Companion closed before acknowledging.")));
  });
}

export async function activate(context: vscode.ExtensionContext) {
  if (context.extensionMode === vscode.ExtensionMode.Test) testEndpoint = process.env.FORMA_TEST_ENDPOINT;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 60);
  status.command = "formaCompanion.setup"; status.name = "Forma Companion"; status.show(); context.subscriptions.push(status);
  let disposed = false, paired = !!await context.secrets.get(SECRET), connection = paired ? "Reconnecting" : "Not paired";
  let queue: QueuedCommand[] = [], queueRecovery = false;
  try { queue = restoreQueue(context.workspaceState.get(QUEUE, [])); } catch { queueRecovery = true; }
  let allowed = context.workspaceState.get<string[]>(FOLDERS, []);
  const bindings = context.workspaceState.get<Record<string, Binding>>(BINDINGS, {});
  const ignored = new Set(context.workspaceState.get<string[]>("forma-companion.ignored-files.v1", []));
  const targets = context.workspaceState.get<Record<string, Target>>("forma-companion.capture-targets.v1", {});
  const clientId = context.globalState.get<string>("forma-companion.client-id.v1") ?? createHash("sha256").update(`forma-vscode:${vscode.env.machineId}`).digest("hex").slice(0, 48);
  await context.globalState.update("forma-companion.client-id.v1", clientId);
  const workspaceId = createHash("sha256").update((vscode.workspace.workspaceFolders ?? []).map(f => f.uri.toString()).sort().join("\n")).digest("hex").slice(0, 48);
  const instanceId = randomUUID(), generation = new RecognitionGeneration();
  let activeGeneration = generation.next(), watcher: vscode.FileSystemWatcher | undefined, metadataTimer: ReturnType<typeof setTimeout> | undefined;
  let registeredEpoch: unknown = null;
  let observing: EditorContext | null = null, flushing = false, queueTail = Promise.resolve();
  let publishing: Promise<unknown> = Promise.resolve();
  let testTutorChoice: { mode: "selection" | "file" | "cancel"; afterChoice?: () => Promise<void> } | undefined;
  let testCommandError: string | null = null;
  let pollAbort: AbortController | undefined, observationAbort = new AbortController();
  const local = () => !disposed && !vscode.env.remoteName && vscode.workspace.isTrusted;
  const enabled = () => vscode.workspace.getConfiguration("formaCompanion").get<boolean>("cphMetadataEnabled", false);
  const warned = new Set<string>();
  function renderStatus() {
    const text = vscode.env.remoteName ? "Remote workspace: limited" : !vscode.workspace.isTrusted ? "Trust required" : queueRecovery ? "Queue recovery needed" : queue[0]?.blocked ? "Capture needs attention" : queue.length ? `${queue.length} waiting to save` : connection;
    status.text = `$(leaf) Forma · ${text}`;
    status.tooltip = `Recognise problems from CPH: ${enabled() ? "on" : "off"}. Supported CPH: ${SUPPORTED_CPH_VERSIONS.join(", ")}. CPH owns test results. Click for setup.`;
  }
  function requireLocal() { if (!local()) throw new Error("Forma needs a trusted local VS Code workspace. Remote workspaces remain in limited mode."); }
  async function permitted(fileUri: string) {
    requireLocal(); const uri = vscode.Uri.parse(fileUri);
    if (uri.scheme !== "file" || !vscode.workspace.getWorkspaceFolder(uri)) throw new Error("Use a local solution in this workspace.");
    const actual = await realpath(uri.fsPath), roots = await Promise.all(allowed.map(root => realpath(root).catch(() => "")));
    if (!allowed.some(root => pathWithinFolder(uri.fsPath, root)) || !roots.some(root => root && pathWithinFolder(actual, root))) throw new Error("Select this solution folder in Forma setup first.");
    requireLocal(); if (!allowed.some(root => pathWithinFolder(uri.fsPath, root))) throw new Error("Folder permission changed.");
    return uri;
  }
  async function selected() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) throw new Error("Open a local solution file first.");
    await permitted(uri.toString()); return uri;
  }
  async function credential() { const token = await context.secrets.get(SECRET); if (!token) throw new Error("Pair with Forma Companion first."); return token; }
  const saveBindings = () => context.workspaceState.update(BINDINGS, bindings);
  function serializeQueue(work: () => Promise<void>) { const p = queueTail.then(work); queueTail = p.catch(() => {}); return p; }
  async function persistQueue(next: QueuedCommand[]) { await context.workspaceState.update(QUEUE, next); queue = next; renderStatus(); }
  async function remember(response: TransportResponse) {
    if (!response.ok) return;
    const saved = response.savedBinding as { fileUri?: string; identity?: string; problemId?: string; id?: string; source?: Binding["source"]; adapterVersion?: string } | null | undefined;
    if (saved?.fileUri && saved.identity) {
      const identity = normalizeCodeforcesIdentity(saved.identity.replace(/^(contest|gym):/, (_m, ns) => ns === "gym" ? "Gym " : "").replace(":", ""));
      if (identity) bindings[saved.fileUri] = { ...bindings[saved.fileUri], fileUri: saved.fileUri, id: saved.id, key: saved.identity, url: identity.url, source: saved.source ?? "manual", adapterVersion: saved.adapterVersion };
    }
    for (const b of Object.values(bindings)) if (b.key === response.identity) b.sessionId = typeof response.sessionId === "string" ? response.sessionId : undefined;
    await saveBindings();
  }
  async function action(action: "open" | "memory" | "ping") {
    requireLocal(); const response = await send({ version: 1, id: randomUUID(), credential: await credential(), action });
    if (!response.ok) throw new Error(response.error); if (!observing) connection = "Connected"; await remember(response); renderStatus(); return response;
  }
  async function flush() {
    if (flushing || !local() || !paired || queueRecovery) return;
    flushing = true;
    try { await serializeQueue(async () => {
      while (local() && paired && queue.length && !queue[0].blocked && queue[0].nextAttemptAt <= Date.now()) {
        const entry = queue[0], target = targets[entry.command.id];
        try {
          // Legacy captures are retained; ambiguous or withdrawn targets require recovery.
          const uri = target?.fileUri ?? (typeof entry.command.payload.fileUri === "string" ? entry.command.payload.fileUri : Object.values(bindings).filter(b => b.key === entry.command.expectedProblemKey).length === 1 ? Object.values(bindings).find(b => b.key === entry.command.expectedProblemKey)!.fileUri : null);
          if (!uri) throw new Error("The saved target needs recovery before delivery.");
          if (entry.command.type === "attach" && entry.command.payload.activate !== false) throw new Error("A legacy attachment may contain obsolete focus. Export it for recovery; use fresh recognition to restore the current file.");
          await permitted(uri);
          const token = await credential(); if (!paired || !local()) break;
          const response = await send({ version: 1, id: entry.command.id, credential: token, command: entry.command });
          if (!response.ok) throw new Error(response.error);
          await remember(response);
          if (entry.command.type === "attach") {
            const p = entry.command.payload, identity = normalizeCodeforcesIdentity(String(p.url))!;
            bindings[uri] = { id: entry.command.id, fileUri: uri, key: identity.key, url: identity.url, title: typeof p.title === "string" ? p.title : undefined, source: p.source as Binding["source"] ?? "manual", adapterVersion: p.adapterVersion as string | undefined }; await saveBindings();
          }
          delete targets[entry.command.id]; await context.workspaceState.update("forma-companion.capture-targets.v1", targets);
          await persistQueue(queue.filter(q => q.command.id !== entry.command.id)); connection = "Connected";
        } catch (error) {
          const message = error instanceof Error ? error.message : "Capture needs recovery.";
          const offline = /acknowledge|connect|ENOENT|ECONN|closed/i.test(message);
          const uncertainTimer = offline && ["start", "pause", "resume", "finish"].includes(entry.command.type);
          await persistQueue([uncertainTimer ? { ...entry, blocked: "Session acknowledgement is uncertain. Retry explicitly after reconnecting; offline time is not reconstructed." } : offline ? retryCommand(entry, Date.now()) : { ...entry, blocked: message }, ...queue.slice(1)]);
          connection = offline ? "Offline" : "Capture needs attention"; break;
        }
      }
    }); } catch { queueRecovery = true; } finally { flushing = false; renderStatus(); }
  }
  async function enqueue(command: TransportCommand, target: Target) {
    await permitted(target.fileUri); await credential();
    if (queueRecovery) throw new Error("Export existing captures for recovery before adding more.");
    const parsed = parseCommand({ ...command, occurredAt: command.occurredAt ?? new Date().toISOString() });
    await serializeQueue(async () => { targets[parsed.id] = { ...target }; await context.workspaceState.update("forma-companion.capture-targets.v1", targets); await persistQueue(enqueueCommand(queue, parsed, Date.now())); });
    await flush();
  }
  async function frozenTarget(): Promise<Target> {
    const uri = await selected(), b = bindings[uri.toString()];
    if (!b) throw new Error("Open a CPH-imported solution, use Chrome’s Use in Forma, or choose Advanced: Attach Codeforces Problem.");
    return { fileUri: uri.toString(), key: b.key, sessionId: b.sessionId };
  }
  async function capture(type: string, payload: Record<string, unknown> = {}, frozen?: Target) {
    const target = frozen ?? await frozenTarget(); await permitted(target.fileUri);
    const timerControl = ["start", "pause", "resume", "finish"].includes(type);
    if (timerControl) {
      if (queue.length) throw new Error("Resolve pending captures before controlling measured time.");
      const host = await action("ping");
      if (host.identity !== target.key) throw new Error("This file is a candidate. Keep or finish the current problem in Fenn before starting it.");
      if (!target.sessionId && typeof host.sessionId === "string") target.sessionId = host.sessionId;
      if (type !== "start" && (!target.sessionId || host.sessionId !== target.sessionId)) throw new Error("The session changed. Reopen this action for the intended session.");
    }
    if (type === "reflect" && !target.sessionId) throw new Error("Reconnect to confirm the intended reflection session first.");
    const id = randomUUID();
    await enqueue({ id, type, payload, expectedProblemKey: target.key, ...(type !== "start" && target.sessionId ? { expectedSessionId: target.sessionId } : {}) }, target);
    if (timerControl && queue.some(e => e.command.id === id)) throw new Error("The session change is waiting for acknowledgement. Reconnect and retry explicitly before continuing.");
    if (type === "start" && !queue.some(e => e.command.id === id)) { bindings[target.fileUri].sessionId = `companion:${id}`; await saveBindings(); }
  }
  async function askSelectedCode() {
    const uri = await selected(), editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) throw new Error("The editor changed. Choose the code again.");
    const fileUri = uri.toString(), binding = bindings[fileUri];
    if (!binding) throw new Error("Associate this solution with a Codeforces problem before sharing code.");
    await credential();
    const fence: CodeSourceFence = { fileUri, identity: binding.key, bindingId: binding.id ?? binding.url, generation: activeGeneration, version: editor.document.version };
    const current = (): CodeSourceFence | null => {
      const active = vscode.window.activeTextEditor, linked = bindings[fileUri];
      return local() && paired && active === editor && active.document.uri.toString() === fileUri && linked ? { fileUri, identity: linked.key, bindingId: linked.id ?? linked.url, generation: activeGeneration, version: active.document.version } : null;
    };
    const selection = editor.selection;
    const choices = [
      ...(!selection.isEmpty ? [{ label: "Selected code", detail: `Lines ${selection.start.line + 1}–${Math.max(selection.start.line + 1, selection.end.line + (selection.end.character ? 1 : 0))}`, selected: true }] : []),
      { label: "Current file", detail: "Up to 24,000 characters; choose a selection for a smaller snapshot.", selected: false },
    ];
    // Only VS Code's isolated extension-test host may supply a deterministic UI choice.
    const fixtureChoice = context.extensionMode === vscode.ExtensionMode.Test ? testTutorChoice : undefined;
    testTutorChoice = undefined;
    if (fixtureChoice?.afterChoice) await fixtureChoice.afterChoice();
    const choice = fixtureChoice ? fixtureChoice.mode === "cancel" ? undefined : choices.find(item => item.selected === (fixtureChoice.mode === "selection")) : await vscode.window.showQuickPick(choices, { title: `Ask Fenn · ${binding.title || binding.key} · ${path.basename(uri.fsPath)}`, placeHolder: "Choose code to review locally in Fenn. Inspect it and press Send there to share with your configured AI provider.", ignoreFocusOut: true });
    if (!choice) return;
    if (!sameCodeSource(fence, current())) throw new Error("The editor, source, or problem changed. Choose the code again.");
    const size = choice.selected ? editor.document.offsetAt(selection.end) - editor.document.offsetAt(selection.start) : editor.document.offsetAt(editor.document.lineAt(editor.document.lineCount - 1).range.end);
    if (size > 24000) throw new Error("This code exceeds 24,000 characters. Select a smaller relevant section.");
    const shared = await collectExplicitCode({ fence, current, permitted: () => permitted(fileUri), credential, id: randomUUID(), workspaceId, clientId,
      read: () => ({ text: editor.document.getText(choice.selected ? selection : undefined), startLine: choice.selected ? selection.start.line + 1 : 1, endLine: choice.selected ? Math.max(selection.start.line + 1, selection.end.line + (selection.end.character ? 1 : 0)) : editor.document.lineCount, language: editor.document.languageId, filename: path.basename(uri.fsPath) }),
    });
    // No offline source queue: an uncertain acknowledgement requires another explicit share.
    await permitted(fileUri);
    const finalCredential = await credential();
    if (!sameCodeSource(fence, current()) || finalCredential !== shared.credential) throw new Error("Sharing permission or source changed. Choose the code again.");
    const response = await send({ version: 1, id: shared.code.id, credential: shared.credential, tutorCode: shared.code });
    if (!response.ok) throw new Error(response.error);
    void vscode.window.showInformationMessage("Code snapshot saved locally in Fenn. Inspect Context included and press Send there to use your AI provider.");
  }
  async function publish(input: EditorContext, signal = observationAbort.signal) {
    const run = publishing.then(async () => {
      if (signal.aborted || !paired || !local() || !generation.current(input.generation)) throw new Error("Recognition permission or focus changed.");
      if (input.fileUri) await permitted(input.fileUri);
      if (signal.aborted || !generation.current(input.generation)) throw new Error("The focused file changed.");
      const response = await send({ version: 1, id: randomUUID(), credential: await credential(), recognition: input }, signal);
      if (!response.ok) throw new Error(response.error);
      await remember(response);
      if (!generation.current(input.generation) || observing?.fileUri !== input.fileUri) return response;
      registeredEpoch = response.hostEpoch;
      const projection = response.recognition as { fileUri?: string; status?: string } | undefined;
      if (projection?.fileUri === input.fileUri) connection = projection.status === "active" ? "File linked" : projection.status === "candidate" ? "Linked · session kept" : projection.status === "inactive" ? "File linked · background" : projection.status === "conflict" ? "Association needs a choice" : projection.status === "unbound" ? "No problem linked" : "Recognition off for this file";
      else if (input.reason !== "heartbeat") connection = response.savedBinding ? "File linked" : "Connected";
      renderStatus(); return response;
      // A newer focus invalidates selection, not an already durable, file-scoped ACK.

    });
    publishing = run.catch(() => { connection = "Offline · waiting to recognise"; renderStatus(); });
    return run;
  }
  async function withdraw() {
    const old = observing; observing = null;
    activeGeneration = generation.next(); observationAbort.abort(); observationAbort = new AbortController();
    watcher?.dispose(); watcher = undefined; clearTimeout(metadataTimer); pollAbort?.abort();
    if (old && paired) try { await send({ version: 1, id: randomUUID(), credential: await credential(), recognition: { ...old, generation: activeGeneration, observedAt: Date.now(), focused: false, fileUri: null, reason: "withdraw", binding: undefined } }); } catch { /* A disconnected host's lease expires. */ }
  }
  async function inspect(input: EditorContext) {
    if (!input.fileUri || !enabled() || ignored.has(input.fileUri) || !await context.secrets.get(SECRET)) return;
    const uri = vscode.Uri.parse(input.fileUri), cph = vscode.extensions.getExtension(CPH_EXTENSION_ID);
    const current = () => local() && paired && enabled() && generation.current(input.generation) && vscode.window.activeTextEditor?.document.uri.toString() === input.fileUri && allowed.some(root => pathWithinFolder(uri.fsPath, root));
    if (!cph) { quiet("missing", "CPH is not installed. Use Chrome’s Use in Forma or Advanced: Attach Codeforces Problem."); return; }
    const result = await readCphBindingWithRetry({ solutionPath: uri.fsPath, version: String(cph.packageJSON.version), permittedFolders: allowed, saveLocation: vscode.workspace.getConfiguration("cph", uri).get<string>("general.saveLocation", "") }, current);
    if (!result || !current()) return;
    if (!result.ok) { quiet(result.reason, result.reason === "unsupported-version" ? "This CPH version is not inspected. Use Chrome’s Use in Forma or Advanced attach." : "No usable CPH association yet. Import into CPH, or use Chrome’s Use in Forma."); return; }
    await permitted(input.fileUri); if (!current()) return;
    const b: Binding = { url: result.binding.url, title: result.binding.title, key: result.binding.problemKey, fileUri: input.fileUri, source: "cph", adapterVersion: result.binding.adapterVersion };
    // Confirmed sources take precedence; conflicting reuse is resolved explicitly.
    observing = { ...input, observedAt: Date.now(), focused: vscode.window.state.focused, reason: "observe", binding: { url: b.url, title: b.title, source: b.source, adapterVersion: b.adapterVersion } };
    await publish(observing);
  }
  function quiet(key: string, text: string) { if (warned.has(key)) return; warned.add(key); void vscode.window.setStatusBarMessage(`Forma: ${text}`, 10000); }
  function scheduleMetadata() {
    clearTimeout(metadataTimer); const frozen = observing;
    metadataTimer = setTimeout(() => { if (frozen) void inspect(frozen).catch(() => {}); }, 300);
  }
  async function watchActive(reason: "focus" | "observe" = "focus") {
    watcher?.dispose(); watcher = undefined; clearTimeout(metadataTimer); observationAbort.abort(); observationAbort = new AbortController();
    const id = activeGeneration = generation.next();
    connection = "Checking file"; renderStatus();
    if (!local() || !paired || !allowed.length || !await context.secrets.get(SECRET)) { await withdraw(); renderStatus(); return; }
    try {
      const uri = await selected(); if (!generation.current(id)) return;
      const known = bindings[uri.toString()];
      const input: EditorContext = { clientId, workspaceId, instanceId, generation: id, focused: vscode.window.state.focused, observedAt: Date.now(), automatic: enabled(), suppressed: ignored.has(uri.toString()), fileUri: uri.toString(), reason, ...(known && !ignored.has(uri.toString()) ? { binding: known } : {}) };
      // Strip local-only binding keys at the protocol boundary.
      if (input.binding) input.binding = { url: known.url, title: known.title, source: known.source, adapterVersion: known.adapterVersion };
      observing = input; await publish(input);
      if (!generation.current(id)) return;
      if (enabled() && !ignored.has(input.fileUri!)) {
        const metadata = cphMetadataPath(uri.fsPath, vscode.workspace.getConfiguration("cph", uri).get<string>("general.saveLocation", ""));
        let ancestor = path.dirname(metadata), actual = "";
        while (!actual && ancestor !== path.dirname(ancestor)) { try { actual = await realpath(ancestor); } catch { ancestor = path.dirname(ancestor); } }
        const roots = await Promise.all(allowed.map(root => realpath(root).catch(() => "")));
        if (generation.current(id) && allowed.some(root => pathWithinFolder(metadata, root)) && roots.some(root => root && actual && pathWithinFolder(actual, root))) {
          watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(metadata), path.basename(metadata)));
          watcher.onDidChange(scheduleMetadata); watcher.onDidCreate(scheduleMetadata); watcher.onDidDelete(scheduleMetadata); scheduleMetadata();
        }
      }
      startPolling();
    } catch { if (generation.current(id)) { await withdraw(); connection = "Open a permitted solution"; renderStatus(); } }
  }
  async function deliver(proposal: BrowserDelivery) {
    const input = observing;
    try {
      if (!input || input.fileUri !== proposal.fileUri || input.generation !== proposal.generation || !generation.current(input.generation)) throw new Error("The chosen solution changed. Capture again from Chrome.");
      await permitted(proposal.fileUri);
      if (!generation.current(input.generation) || vscode.window.activeTextEditor?.document.uri.toString() !== proposal.fileUri) throw new Error("The chosen solution changed.");
      const binding: RecognisedBinding = { url: proposal.url, title: proposal.title, source: "browser", replace: true };
      const reply = await publish({ ...input, reason: "observe", binding, proposalId: proposal.proposalId });
      const saved = reply?.savedBinding as { fileUri?: string; identity?: string; source?: string } | undefined;
      if (!generation.current(input.generation) || observing?.fileUri !== proposal.fileUri || saved?.fileUri !== proposal.fileUri || saved.identity !== normalizeCodeforcesIdentity(proposal.url)?.key || saved.source !== "browser") throw new Error("The chosen solution changed or its association was not saved.");
      ignored.delete(proposal.fileUri); await context.workspaceState.update("forma-companion.ignored-files.v1", [...ignored]);
      await send({ version: 1, id: randomUUID(), credential: await credential(), recognition: { reason: "proposal-result", instanceId, proposalId: proposal.proposalId, accepted: true } });
    } catch (error) {
      if (paired) await send({ version: 1, id: randomUUID(), credential: await credential(), recognition: { reason: "proposal-result", instanceId, proposalId: proposal.proposalId, accepted: false, error: (error instanceof Error ? error.message : "Permission changed.").slice(0, 300) } }).catch(() => {});
    }
  }
  function startPolling() {
    if (pollAbort && !pollAbort.signal.aborted) return;
    const controller = pollAbort = new AbortController();
    void (async () => { while (!controller.signal.aborted && local() && paired && observing) {
      try { const response = await send({ version: 1, id: randomUUID(), credential: await credential(), recognition: { reason: "poll", instanceId } }, controller.signal); if (!response.ok || response.unregistered) break; if (response.proposal) await deliver(response.proposal as BrowserDelivery); }
      catch { break; }
    } if (pollAbort === controller) pollAbort = undefined; })();
  }
  async function consent() {
    const choice = await vscode.window.showQuickPick([{ label: "Recognise problems from CPH", detail: "Watch only the active permitted solution’s metadata. No source reading, test-result claims, or automatic timer.", value: true }, { label: "Keep automatic recognition off", detail: "Use Chrome capture or advanced manual association.", value: false }], { title: "Forma · automatic recognition", ignoreFocusOut: true });
    if (!choice) return;
    await vscode.workspace.getConfiguration("formaCompanion").update("cphMetadataEnabled", choice.value, vscode.ConfigurationTarget.Global);
    await watchActive();
  }
  async function selectFolders() {
    requireLocal(); const folders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === "file") ?? [];
    const choice = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, picked: allowed.includes(folder.uri.fsPath), folder })), { canPickMany: true, title: "Forma · permitted practice folders", placeHolder: "Metadata stays local. Source contents are not read or uploaded.", ignoreFocusOut: true });
    if (!choice) return;
    await withdraw(); allowed = choice.map(item => item.folder.uri.fsPath); await context.workspaceState.update(FOLDERS, allowed); await watchActive();
  }
  function register(name: string, run: () => unknown) { context.subscriptions.push(vscode.commands.registerCommand(`formaCompanion.${name}`, async () => { try { testCommandError = null; await run(); } catch (error) { const message = error instanceof Error ? error.message : "Forma could not complete this action."; if (context.extensionMode === vscode.ExtensionMode.Test) testCommandError = message; void vscode.window.showErrorMessage(message); } })); }
  register("setup", async () => { const choice = await vscode.window.showQuickPick(["Open Fenn", "Ask about selected code", "Recognise problems from CPH", "Select allowed folders", "Advanced: Attach Codeforces Problem", "Forget this file’s association"], { title: `Forma · ${connection}`, ignoreFocusOut: true }); if (choice === "Open Fenn") await action("open"); else if (choice === "Ask about selected code") await askSelectedCode(); else if (choice === "Recognise problems from CPH") await consent(); else if (choice === "Select allowed folders") await selectFolders(); else if (choice === "Advanced: Attach Codeforces Problem") await vscode.commands.executeCommand("formaCompanion.attachProblem"); else if (choice) await vscode.commands.executeCommand("formaCompanion.forget"); });
  register("recognition", consent);
  register("pair", async () => {
    requireLocal(); const token = await vscode.window.showInputBox({ title: "Pair Forma Companion", prompt: "Paste the pairing credential from Fenn settings", password: true, ignoreFocusOut: true, validateInput: value => /^[A-Za-z0-9_-]{32,256}$/.test(value.trim()) ? undefined : "Use the pairing credential shown by Fenn." });
    if (!token) return; const response = await send({ version: 1, id: randomUUID(), credential: token.trim(), action: "ping" }); if (!response.ok) throw new Error(response.error);
    await context.secrets.store(SECRET, token.trim()); paired = true; connection = "Connected"; await selectFolders(); await consent(); await flush();
  });
  register("unpair", async () => { await withdraw(); paired = false; await context.secrets.delete(SECRET); connection = "Not paired"; renderStatus(); });
  register("selectFolders", selectFolders);
  register("attachProblem", async () => {
    const uri = await selected();
    const url = await vscode.window.showInputBox({ title: `Attach problem · ${path.basename(uri.fsPath)}`, prompt: "Advanced recovery: confirm the exact Codeforces URL for this frozen file", ignoreFocusOut: true, validateInput: value => /^https?:\/\//.test(value) && normalizeCodeforcesIdentity({ url: value }) ? undefined : "Enter a full Codeforces problem URL." });
    if (!url) return; await permitted(uri.toString()); const identity = normalizeCodeforcesIdentity(url)!;
    await enqueue({ id: randomUUID(), type: "attach", payload: { url: identity.url, fileUri: uri.toString(), clientId, workspaceId, source: "manual", activate: false, replace: true } }, { fileUri: uri.toString(), key: identity.key });
    ignored.delete(uri.toString()); await context.workspaceState.update("forma-companion.ignored-files.v1", [...ignored]);
    await watchActive();
  });
  register("forget", async () => {
    const uri = await selected(), binding = bindings[uri.toString()]; if (!binding) return;
    const yes = await vscode.window.showQuickPick(["Forget association", "Keep association"], { title: `Forget ${path.basename(uri.fsPath)}? Practice history remains.`, ignoreFocusOut: true });
    if (yes !== "Forget association") return;
    await enqueue({ id: randomUUID(), type: "forget-binding", payload: { fileUri: uri.toString(), clientId, workspaceId, ...(binding.id ? { bindingId: binding.id } : {}) } }, { fileUri: uri.toString(), key: binding.key });
    delete bindings[uri.toString()]; ignored.add(uri.toString()); await saveBindings(); await context.workspaceState.update("forma-companion.ignored-files.v1", [...ignored]); await watchActive();
  });
  register("useCph", async () => {
    const uri = await selected(), extension = vscode.extensions.getExtension(CPH_EXTENSION_ID);
    if (!extension) throw new Error("Install the supported CPH version first.");
    const result = await readCphBindingWithRetry({ solutionPath: uri.fsPath, permittedFolders: allowed, version: String(extension.packageJSON.version), saveLocation: vscode.workspace.getConfiguration("cph", uri).get<string>("general.saveLocation", "") }, () => local() && paired);
    if (!result?.ok) throw new Error("No supported CPH association is available for this file.");
    const yes = await vscode.window.showQuickPick(["Use CPH association", "Keep current association"], { title: `${path.basename(uri.fsPath)} → ${result.binding.title}`, ignoreFocusOut: true });
    if (yes !== "Use CPH association") return;
    await permitted(uri.toString()); await enqueue({ id: randomUUID(), type: "attach", payload: { url: result.binding.url, title: result.binding.title, fileUri: uri.toString(), clientId, workspaceId, source: "cph", adapterVersion: result.binding.adapterVersion, replace: true, activate: false } }, { fileUri: uri.toString(), key: result.binding.problemKey });
    ignored.delete(uri.toString()); await context.workspaceState.update("forma-companion.ignored-files.v1", [...ignored]); await watchActive();
  });
  register("open", () => action("open"));
  register("askSelectedCode", askSelectedCode);
  register("memory", async () => { const target = await frozenTarget(); const host = await action("ping"); if (host.identity !== target.key) throw new Error("Switch to this file’s problem in Fenn first."); return action("memory"); });
  register("saveThought", async () => { const target = await frozenTarget(); const text = await vscode.window.showInputBox({ title: "Save Thought", prompt: "An observation for this problem", ignoreFocusOut: true, validateInput: value => value.trim() && value.length <= 10000 ? undefined : "Write up to 10,000 characters." }); if (text) await capture("thought", { text }, target); });
  register("start", () => capture("start")); register("pause", () => capture("pause")); register("resume", () => capture("resume"));
  register("finish", async () => {
    const target = await frozenTarget(); await capture("finish", {}, target);
    const choice = await vscode.window.showQuickPick([{ label: "Independent", outcome: "independent" }, { label: "Used a hint", outcome: "hint" }, { label: "Used an editorial", outcome: "editorial" }, { label: "Still unsolved", outcome: "unsolved" }, { label: "Reflect later", outcome: null }], { title: "How did this attempt go?", ignoreFocusOut: true });
    if (!choice?.outcome) return;
    const takeaway = await vscode.window.showInputBox({ title: "Reflection", prompt: "What would you like to remember?", ignoreFocusOut: true, validateInput: value => value.length <= 300 ? undefined : "Keep the takeaway below 300 characters." });
    if (takeaway !== undefined) await capture("reflect", { outcome: choice.outcome, takeaway }, target);
  });
  register("runCphTests", async () => { await selected(); if (!(await vscode.commands.getCommands(true)).includes("cph.runTestCases")) throw new Error("The CPH Run Testcases command is unavailable."); await vscode.commands.executeCommand("cph.runTestCases"); void vscode.window.setStatusBarMessage("CPH owns test results. Forma does not infer a pass.", 7000); });
  register("retry", async () => { requireLocal(); await serializeQueue(() => persistQueue(queue.map(entry => { const next = { ...entry, nextAttemptAt: Date.now() }; delete next.blocked; return next; }))); await flush(); await watchActive(); });
  register("exportQueue", async () => { const destination = await vscode.window.showSaveDialog({ title: "Export Forma Pending Captures", filters: { JSON: ["json"] } }); if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(JSON.stringify({ format: "forma-vscode-queue-v1", queue: context.workspaceState.get(QUEUE, []), targets }, null, 2))); });
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => { void watchActive(); }),
    vscode.window.onDidChangeWindowState(() => { void (async () => {
      if (!observing || observing.fileUri !== vscode.window.activeTextEditor?.document.uri.toString() || !local() || !paired) { await watchActive(); return; }
      const b = bindings[observing.fileUri!];
      observing = { ...observing, reason: "focus", observedAt: Date.now(), focused: vscode.window.state.focused, proposalId: undefined, ...(b ? { binding: { url: b.url, title: b.title, source: b.source, adapterVersion: b.adapterVersion } } : { binding: undefined }) };
      await publish(observing); if (enabled()) scheduleMetadata();
    })().catch(() => {}); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void watchActive(); void flush(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void withdraw().then(() => watchActive()); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("formaCompanion") || event.affectsConfiguration("cph.general.saveLocation")) void watchActive(); }),
    vscode.workspace.onDidRenameFiles(event => { void (async () => { for (const file of event.files) { const old = file.oldUri.toString(), b = bindings[old]; if (!b) continue; try { await permitted(file.newUri.toString()); for (const target of Object.values(targets)) if (target.fileUri === old) target.fileUri = file.newUri.toString(); await context.workspaceState.update("forma-companion.capture-targets.v1", targets); await enqueue({ id: randomUUID(), type: "rename-binding", payload: { fileUri: old, newFileUri: file.newUri.toString(), clientId, workspaceId, ...(b.id ? { bindingId: b.id } : {}) } }, { fileUri: file.newUri.toString(), key: b.key }); if (queue.length) continue; bindings[file.newUri.toString()] = { ...b, fileUri: file.newUri.toString() }; delete bindings[old]; await saveBindings(); } catch { quiet("rename", "The moved file needs an explicit association in a permitted folder."); } } await watchActive(); })(); }),
    vscode.workspace.onDidDeleteFiles(event => { for (const file of event.files) if (file.toString() === observing?.fileUri) void withdraw(); })
  );
  const retry = setInterval(() => { if (queue.length) void flush(); }, 1000);
  const heartbeat = setInterval(() => { void (async () => { if (!local() || !paired) { await withdraw(); return; } try { const host = await action("ping"); if (host.hostEpoch !== registeredEpoch) await watchActive(vscode.window.state.focused ? "focus" : "observe"); else if (observing) await publish({ ...observing, reason: "heartbeat", observedAt: Date.now(), binding: undefined }); else await watchActive(); startPolling(); } catch { connection = "Offline"; renderStatus(); } })(); }, 30000);
  context.subscriptions.push({ dispose: () => { disposed = true; generation.next(); observationAbort.abort(); pollAbort?.abort(); clearInterval(retry); clearInterval(heartbeat); clearTimeout(metadataTimer); watcher?.dispose(); } });
  context.subscriptions.push(context.secrets.onDidChange(event => { if (event.key === SECRET) void (async () => { paired = !!await context.secrets.get(SECRET); if (paired) await watchActive(); else { await withdraw(); connection = "Not paired"; renderStatus(); } })(); }));
  renderStatus(); await watchActive(); void flush();
  // Only VS Code's isolated extension-test host receives this harness; normal activation exports no access.
  if (context.extensionMode === vscode.ExtensionMode.Test) return {
    seed: async (token: string, folders: string[]) => { await context.secrets.store(SECRET, token); paired = true; allowed = folders; await context.workspaceState.update(FOLDERS, folders); await vscode.workspace.getConfiguration("formaCompanion").update("cphMetadataEnabled", true, vscode.ConfigurationTarget.Global); await watchActive(); },
    state: () => ({ bindings: structuredClone(bindings), queue: structuredClone(queue), observing: observing && { ...observing }, connection }),
    reconcile: () => watchActive(),
    setTutorCodeChoice: (mode: "selection" | "file" | "cancel", afterChoice?: () => Promise<void>) => { testTutorChoice = { mode, afterChoice }; },
    tutorCommandError: () => testCommandError,
    capture, frozenTarget,
  };
}
export function deactivate() { /* VS Code disposes all watchers, timers and sockets. */ }
