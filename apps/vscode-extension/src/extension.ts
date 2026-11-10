import * as vscode from "vscode";
import { randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeCodeforcesIdentity } from "../../../packages/core/src/codeforces-identity";
import { parseCommand } from "../../../packages/contracts/src";
import { CPH_EXTENSION_ID, SUPPORTED_CPH_VERSIONS, cphMetadataPath, pathWithinFolder, readCphBindingWithRetry } from "../../../packages/integrations/cph";
import { BoundedJsonLines, defaultCompanionEndpoint, encodeTransportMessage, parseTransportResponse, type TransportCommand, type TransportRequest, type TransportResponse } from "../../../packages/integrations/protocol";
import { RecognitionGeneration, type RecognisedBinding, type EditorContext, type BrowserDelivery } from "../../../packages/integrations/recognition";
import { captureRecoveryEpoch, enqueueCommand, requireCaptureRecoveryEpoch, restoreQueue, retryCommand, type QueuedCommand } from "../../../packages/integrations/queue";
import { collectExplicitCode, sameCodeSource, type CodeSourceFence } from "../../../packages/integrations/tutor-code";
import { companionConnectionError } from "../../../packages/integrations/connection-error";
import { afterCompanionReady, CompanionLauncher, launchCompanion, resolveCompanionLaunch, userDevelopmentLaunchPath } from "../../../packages/integrations/local-launch";
import { cppChallengeSupported, readCppChallengeSource, runCppChallenge, runCppReferenceChallenge, runCppReferenceChallengeBatch } from "../../../packages/integrations/cpp-challenge";
import { CHALLENGE_RUN_LIMITS, FIRST_CHALLENGE_CASE_ID, challengeOutputEqual, readChallengeReferenceBatchPlan, readChallengeReferenceBatchReceipts, readChallengeRunPlan, readChallengeRunReceipt, type ChallengeRunRequest } from "../../../packages/tutor/challenge-run";

const SECRET = "forma-companion.pairing.v1", QUEUE = "forma-companion.queue.v1", FOLDERS = "forma-companion.allowed-folders.v1", BINDINGS = "forma-companion.bindings.v1";
type Binding = RecognisedBinding & { id?: string; key: string; fileUri: string; sessionId?: string };
type Target = { fileUri: string; key: string; sessionId?: string; recoveryEpoch?: string | null };
type ChallengeSubmission = Extract<ChallengeRunRequest, { operation: "record" | "record-reference-batch" }>;
type ChallengeRunMode = "single" | "reference" | "batch";
type ChallengeOracle =
  | { kind: "reference"; uri: vscode.Uri; file: string; source: Buffer }
  | { kind: "expected"; expectedOutput: string; expectedSource: "statement-sample" | "user" };
let testEndpoint: string | undefined;

function expectedChallengeOutput(value: string) {
  // JSON strings allow newlines and preserve exact output bytes in an input box.
  const output: unknown = value.startsWith('"') ? JSON.parse(value) : value;
  if (typeof output !== "string" || output.length > CHALLENGE_RUN_LIMITS.expectedOutput || output.includes("\0")) {
    throw new Error("Enter up to 4,000 characters of expected output.");
  }
  return output;
}

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
    socket.on("data", (chunk: Buffer) => { try { const batch = lines.push(chunk); if (batch.length) finish(undefined, parseTransportResponse(batch[0], request.id)); } catch (error) { finish(new Error("Fenn returned an incompatible or invalid response. Update both Forma Companion and the VS Code extension, then retry.", { cause: error })); } });
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
  let lastRecoveryEpoch = captureRecoveryEpoch(context.workspaceState.get("forma-companion.recovery-epoch.v1"));
  let observing: EditorContext | null = null, flushing = false, queueTail = Promise.resolve();
  let publishing: Promise<unknown> = Promise.resolve();
  let testTutorChoice: { mode: "selection" | "file" | "cancel"; afterChoice?: () => Promise<void> } | undefined;
  let testCommandError: string | null = null;
  let pollAbort: AbortController | undefined, observationAbort = new AbortController();
  let challengeRun: AbortController | undefined;
  const unsavedChallenges = new Map<string, ChallengeSubmission>();
  const local = () => !disposed && !vscode.env.remoteName && vscode.workspace.isTrusted;
  const enabled = () => vscode.workspace.getConfiguration("formaCompanion").get<boolean>("cphMetadataEnabled", false);
  const warned = new Set<string>();
  function renderStatus() {
    const text = vscode.env.remoteName ? "Remote workspace: limited" : !vscode.workspace.isTrusted ? "Trust required" : queueRecovery ? "Queue recovery needed" : queue[0]?.blocked ? "Capture needs attention" : queue.length ? `${queue.length} waiting to save` : connection;
    status.text = `$(leaf) Forma · ${text}`;
    status.tooltip = `Recognise problems from CPH: ${enabled() ? "on" : "off"}. Supported CPH: ${SUPPORTED_CPH_VERSIONS.join(", ")}. CPH owns test results. Click for setup.`;
  }
  function requireLocal() { if (!local()) throw new Error("Forma needs a trusted local VS Code workspace. Remote workspaces remain in limited mode."); }
  async function permittedFile(fileUri: string) {
    requireLocal(); const uri = vscode.Uri.parse(fileUri);
    if (uri.scheme !== "file" || !vscode.workspace.getWorkspaceFolder(uri)) throw new Error("Use a local solution in this workspace.");
    const actual = await realpath(uri.fsPath), roots = await Promise.all(allowed.map(root => realpath(root).catch(() => "")));
    if (!allowed.some(root => pathWithinFolder(uri.fsPath, root)) || !roots.some(root => root && pathWithinFolder(actual, root))) throw new Error("Select this solution folder in Forma setup first.");
    requireLocal(); if (!allowed.some(root => pathWithinFolder(uri.fsPath, root))) throw new Error("Folder permission changed.");
    return { uri, actual };
  }
  async function permitted(fileUri: string) { return (await permittedFile(fileUri)).uri; }
  async function selected() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) throw new Error("Open a local solution file first.");
    await permitted(uri.toString()); return uri;
  }
  async function credential() { const token = await context.secrets.get(SECRET); if (!token) throw new Error("Pair with Forma Companion first."); return token; }
  const launcher = new CompanionLauncher({
    connect: async (token, signal) => {
      const response = await send({ version: 1, id: randomUUID(), credential: token, action: "ping" }, signal);
      if (!response.ok) throw new Error(response.error);
    },
    // Explicitly ignore workspaceValue/workspaceFolderValue, including in trusted workspaces.
    resolve: () => resolveCompanionLaunch({ developmentPath: userDevelopmentLaunchPath(vscode.workspace.getConfiguration("formaCompanion").inspect("developmentLaunchPath")) }),
    launch: launchCompanion,
  });
  const launchAbort = new AbortController();
  context.subscriptions.push({ dispose: () => { launchAbort.abort(); launcher.cancel(); } });
  function editorLaunchFence() {
    const editor = vscode.window.activeTextEditor, fileUri = editor?.document.uri.toString();
    const binding = fileUri ? bindings[fileUri] : undefined;
    return JSON.stringify({ fileUri, version: editor?.document.version, binding: binding && { key: binding.key, id: binding.id, url: binding.url }, ignored: fileUri ? ignored.has(fileUri) : false, allowed: [...allowed].sort(), folders: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()).sort() });
  }
  async function companionReady(token: string) {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Forma · Open Fenn", cancellable: true }, async (progress, cancellation) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const subscription = cancellation.onCancellationRequested(cancel);
      launchAbort.signal.addEventListener("abort", cancel, { once: true });
      if (cancellation.isCancellationRequested || launchAbort.signal.aborted) controller.abort();
      try {
        await launcher.ready(token, controller.signal, message => { progress.report({ message }); connection = message.replace(/…$/, ""); renderStatus(); });
        connection = "Connected"; renderStatus();
      } catch (error) { connection = "Disconnected"; renderStatus(); throw error; }
      finally { subscription.dispose(); launchAbort.signal.removeEventListener("abort", cancel); }
    });
  }
  async function openCompanion(which: "open" | "memory" = "open") {
    requireLocal(); const token = await credential(), fence = editorLaunchFence();
    return afterCompanionReady({ ready: () => companionReady(token), current: async () => local() && paired && await credential() === token && editorLaunchFence() === fence,
      run: async () => {
        // The active file may have been observed while the host was stopped. Refresh only
        // this revalidated file; launch itself never starts a session or changes pairing.
        await watchActive("observe");
        if (editorLaunchFence() !== fence || !local() || await credential() !== token) throw new Error("The editor or problem changed while reconnecting. Invoke Forma again for the intended file.");
        if (which === "memory") { const target = await frozenTarget(); const host = await action("ping"); if (host.identity !== target.key) throw new Error("Switch to this file’s problem in Fenn first."); }
        return action(which);
      },
    });
  }
  const saveBindings = () => context.workspaceState.update(BINDINGS, bindings);
  function serializeQueue(work: () => Promise<void>) { const p = queueTail.then(work); queueTail = p.catch(() => {}); return p; }
  async function persistQueue(next: QueuedCommand[]) { await context.workspaceState.update(QUEUE, next); queue = next; renderStatus(); }
  async function remember(response: TransportResponse) {
    if (!response.ok) return;
    const recoveryEpoch = captureRecoveryEpoch(response.recoveryEpoch);
    if (recoveryEpoch !== lastRecoveryEpoch) { lastRecoveryEpoch = recoveryEpoch; await context.workspaceState.update("forma-companion.recovery-epoch.v1", recoveryEpoch); }
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
          const host = await send({ version: 1, id: randomUUID(), credential: token, action: "ping" });
          if (!host.ok) throw new Error(host.error);
          await remember(host);
          const recoveryEpoch = requireCaptureRecoveryEpoch(target?.recoveryEpoch, host.recoveryEpoch);
          const response = await send({ version: 1, id: entry.command.id, credential: token, command: entry.command, expectedRecoveryEpoch: recoveryEpoch });
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
    await serializeQueue(async () => { targets[parsed.id] = { ...target, recoveryEpoch: Object.hasOwn(target, "recoveryEpoch") ? target.recoveryEpoch : lastRecoveryEpoch }; await context.workspaceState.update("forma-companion.capture-targets.v1", targets); await persistQueue(enqueueCommand(queue, parsed, Date.now())); });
    await flush();
  }
  async function frozenTarget(): Promise<Target> {
    const uri = await selected(), b = bindings[uri.toString()];
    if (!b) throw new Error("Open a CPH-imported solution, use Chrome’s Use in Forma, or choose Advanced: Attach Codeforces Problem.");
    return { fileUri: uri.toString(), key: b.key, sessionId: b.sessionId, recoveryEpoch: lastRecoveryEpoch };
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
    const pending = queue.find(entry => entry.command.id === id);
    if (timerControl && pending) throw new Error("The session change is waiting for acknowledgement. Reconnect and retry explicitly before continuing.");
    if (type === "start" && !pending) { bindings[target.fileUri].sessionId = `companion:${id}`; await saveBindings(); }
    return pending;
  }

  async function saveChallengeRun(submission: ChallengeSubmission, token: string) {
    const response = await send({ version: 1, id: randomUUID(), credential: token, challengeRun: submission });
    const forget = () => {
      if (unsavedChallenges.get(submission.target.fileUri) === submission) unsavedChallenges.delete(submission.target.fileUri);
    };
    // A network failure retains the frozen submission for another acknowledgement attempt.
    // A definite rejection applies to this run and should not block future runs.
    if (!response.ok) {
      forget();
      throw new Error(response.error);
    }
    if (submission.operation === "record-reference-batch") {
      const { batch } = submission;
      const receipts = readChallengeReferenceBatchReceipts(response.batchReceipts);
      if (receipts.length !== batch.cases.length || receipts.some((receipt, index) => {
        const reviewed = batch.cases[index];
        const outcome = reviewed.outcome === "exited"
          ? (challengeOutputEqual(reviewed.output, reviewed.expectedOutput) ? "match" : "mismatch")
          : reviewed.outcome;
        return receipt.batchId !== batch.id || receipt.caseId !== reviewed.caseId ||
          receipt.sourceHash !== batch.sourceHash || receipt.reference?.fileName !== batch.reference.fileName ||
          receipt.reference?.sourceHash !== batch.reference.sourceHash || receipt.output !== reviewed.output ||
          receipt.expectedOutput !== reviewed.expectedOutput || receipt.referenceFailed !== reviewed.referenceFailed ||
          receipt.outcome !== outcome;
      })) {
        throw new Error("The saved batch acknowledgement did not match the reviewed cases. Retry saving the results.");
      }
      forget();
      const matched = receipts.filter(receipt => receipt.outcome === "match").length;
      const differed = receipts.filter(receipt => receipt.outcome === "mismatch").length;
      const skipped = receipts.length - matched - differed;
      void vscode.window.setStatusBarMessage(
        `Forma · ${matched} matched · ${differed} differed${skipped ? ` · ${skipped} could not be compared` : ""}. See the results in the Problem Desk.`, 9000,
      );
      return;
    }
    const receipt = readChallengeRunReceipt(response.receipt);
    if (receipt.id !== submission.run.id || receipt.expectedSource !== submission.run.expectedSource ||
      (receipt.caseId ?? FIRST_CHALLENGE_CASE_ID) !== (submission.run.caseId ?? FIRST_CHALLENGE_CASE_ID) ||
      receipt.reference?.fileName !== submission.run.reference?.fileName ||
      receipt.reference?.sourceHash !== submission.run.reference?.sourceHash) {
      throw new Error("The saved run acknowledgement did not match the reviewed case. Retry saving the result.");
    }
    forget();
    const detail = receipt.outcome === "match" ? "Output matches the expected output."
      : receipt.outcome === "mismatch" ? "Output differs from the expected output."
      : "The run ended before output could be compared.";
    void vscode.window.setStatusBarMessage(`Forma · ${detail} See the result in the Problem Desk.`, 9000);
  }

  async function savedReferencePath(uri: vscode.Uri, sourceFile: string) {
    const extension = path.extname(uri.fsPath);
    if (extension !== ".C" && ![".cpp", ".cc", ".cxx", ".c++"].includes(extension.toLowerCase())) {
      throw new Error("Choose a saved C++ reference file.");
    }
    const { actual } = await permittedFile(uri.toString());
    const [solution, reference] = await Promise.all([stat(sourceFile), stat(actual)]);
    if (actual === sourceFile || (solution.dev === reference.dev && solution.ino === reference.ino)) {
      throw new Error("Choose a different file for the reference solution.");
    }
    const dirtyFiles = await Promise.all(vscode.workspace.textDocuments
      .filter(document => document.isDirty && document.uri.scheme === "file")
      .map(document => realpath(document.uri.fsPath).catch(() => document.uri.fsPath)));
    if (dirtyFiles.includes(actual)) throw new Error("Save the reference solution before reviewing the challenge case.");
    return actual;
  }

  async function runChallengeCase(mode: ChallengeRunMode = "single") {
    if (challengeRun) throw new Error("A challenge case is already open in VS Code.");
    if (!cppChallengeSupported()) throw new Error("Local C++ challenge runs are available on macOS and Linux.");
    const withReference = mode !== "single";
    const controller = new AbortController();
    challengeRun = controller;
    let cancelOnEditorChange: vscode.Disposable | undefined;
    try {
      const editor = vscode.window.activeTextEditor;
      const target = await frozenTarget();
      if (!editor || editor.document.uri.toString() !== target.fileUri || editor.document.languageId !== "cpp") {
        throw new Error("Open the associated C++ solution before running a challenge case.");
      }
      const { document } = editor;
      if (document.isDirty) throw new Error("Save the C++ solution before reviewing the challenge case.");
      const runTarget = { fileUri: target.fileUri, workspaceId, clientId };
      const token = await credential();
      const fence = editorLaunchFence();
      cancelOnEditorChange = vscode.window.onDidChangeActiveTextEditor(next => {
        if (next?.document !== document) controller.abort();
      });
      async function checkTarget(unchanged = true) {
        await permitted(target.fileUri);
        if (controller.signal.aborted || !paired || await credential() !== token ||
          vscode.window.activeTextEditor?.document !== document || bindings[target.fileUri]?.key !== target.key ||
          (unchanged && (document.isDirty || editorLaunchFence() !== fence))) {
          throw new Error("The editor or practice context changed. Review the case again for the intended solution.");
        }
      }

      const previous = unsavedChallenges.get(target.fileUri);
      if (previous) {
        const choice = await vscode.window.showQuickPick(["Save previous result", "Review a new run"], {
          title: "Forma · Previous result is awaiting acknowledgement", ignoreFocusOut: true,
        });
        if (!choice) return;
        if (choice === "Save previous result") {
          await checkTarget(false);
          await saveChallengeRun(previous, token);
          return;
        }
      }

      async function review() {
        const updateMessage = mode === "batch"
          ? "Update Forma Companion to review and run challenge cases together."
          : "Update Forma Companion to run challenges with a reference solution.";
        const challengeReview: ChallengeRunRequest = mode === "batch"
          ? { operation: "review-reference-batch", target: runTarget }
          : { operation: "review", target: runTarget, ...(withReference ? { withReference: true } : {}) };
        const response = await send({ version: 1, id: randomUUID(), credential: token,
          challengeRun: challengeReview }, controller.signal).catch((error: unknown) => {
          if (withReference && error instanceof Error && error.message === "Invalid integration acknowledgement.") throw new Error(updateMessage);
          throw error;
        });
        if (!response.ok) {
          if (withReference && response.error === "The challenge run has invalid fields.") {
            throw new Error(updateMessage);
          }
          throw new Error(response.error);
        }
        return mode === "batch"
          ? { kind: "batch" as const, value: readChallengeReferenceBatchPlan(response.batchPlan) }
          : { kind: "case" as const, value: readChallengeRunPlan(response.plan) };
      }
      const plan = await review();
      const cases = plan.kind === "batch" ? plan.value.cases : [plan.value];
      await checkTarget();
      const { actual: sourceFile } = await permittedFile(target.fileUri);
      const source = await readCppChallengeSource(sourceFile);
      if (new TextDecoder("utf-8", { fatal: true }).decode(source) !== document.getText()) {
        throw new Error("The saved file differs from the editor. Reload or save the solution and review the case again.");
      }
      let oracle: ChallengeOracle;
      if (withReference) {
        const [reference] = await vscode.window.showOpenDialog({
          title: "Choose a saved reference solution",
          openLabel: "Choose reference solution",
          defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          filters: { "C++ source": ["cpp", "cc", "cxx", "c++", "C"] },
        }) ?? [];
        if (!reference) return;
        await checkTarget();
        const file = await savedReferencePath(reference, sourceFile);
        oracle = { kind: "reference", uri: reference, file, source: await readCppChallengeSource(file) };
      } else if (plan.kind === "case" && plan.value.sampleOutput !== null) {
        oracle = { kind: "expected", expectedOutput: plan.value.sampleOutput, expectedSource: "statement-sample" };
      } else {
        const entered = await vscode.window.showInputBox({
          title: `Expected output · ${plan.value.problemTitle}`,
          prompt: `Enter the expected output for input ${JSON.stringify(cases[0].input)}. For multiple lines, enter a JSON string like "3\\n4".`,
          ignoreFocusOut: true,
          validateInput: value => {
            try { expectedChallengeOutput(value); }
            catch (error) { return error instanceof SyntaxError ? "Enter a valid JSON string for quoted or multiline output." : (error as Error).message; }
          },
        });
        if (entered === undefined) return;
        oracle = { kind: "expected", expectedOutput: expectedChallengeOutput(entered), expectedSource: "user" };
      }
      async function checkReviewedFiles() {
        await checkTarget();
        if ((await permittedFile(target.fileUri)).actual !== sourceFile || !source.equals(await readCppChallengeSource(sourceFile))) {
          throw new Error("The saved source changed during review. Review the case again for the new source.");
        }
        if (oracle.kind === "reference" &&
          (await savedReferencePath(oracle.uri, sourceFile) !== oracle.file || !oracle.source.equals(await readCppChallengeSource(oracle.file)))) {
          throw new Error("The saved reference changed during review. Review the case again for the new source.");
        }
        await checkTarget();
      }
      if (oracle.kind === "reference") await checkReviewedFiles();
      const approvalTitle = mode === "batch" ? "Find a counterexample with these cases?"
        : withReference ? "Run this Forma challenge with a reference solution?" : "Run this Forma challenge case locally?";
      const approved = await vscode.window.showWarningMessage(approvalTitle, {
        modal: true,
        detail: [
          `${plan.value.problemTitle} · ${vscode.workspace.asRelativePath(document.uri, true)}`,
          `Assumption: ${plan.value.assumption}`,
          ...cases.map(candidate => `Case ${candidate.caseId.slice("case-".length)} input: ${JSON.stringify(candidate.input)}`),
          oracle.kind === "reference"
            ? `Reference solution\n${vscode.workspace.asRelativePath(oracle.uri, true)}`
            : `${oracle.expectedSource === "statement-sample" ? "Statement sample" : "Your expected output"}: ${JSON.stringify(oracle.expectedOutput)}`,
          oracle.kind === "reference"
            ? "Both saved C++ files run with your local user permissions. Successful reference outputs become the expected answers."
            : "This runs the reviewed saved C++ source with your local user permissions.",
        ].join("\n\n"),
      }, "Run locally");
      if (approved !== "Run locally") return;
      if (JSON.stringify(await review()) !== JSON.stringify(plan)) {
        throw new Error("The challenge changed. Review the new case before running it.");
      }
      await checkReviewedFiles();
      const submission = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: mode === "batch" ? "Forma · Checking reviewed cases" : "Forma · Running C++ challenge case",
        cancellable: true,
      }, async (_progress, cancellation): Promise<ChallengeSubmission> => {
        const subscription = cancellation.onCancellationRequested(() => controller.abort());
        if (cancellation.isCancellationRequested) controller.abort();
        try {
          const { turnId, requestId, recoveryEpoch } = plan.value;
          const base = { id: randomUUID(), turnId, requestId, recoveryEpoch };
          if (plan.kind === "batch") {
            if (oracle.kind !== "reference") throw new Error("Choose a saved reference solution before running the cases.");
            const result = await runCppReferenceChallengeBatch({ source, reference: oracle.source, cases: plan.value.cases, signal: controller.signal });
            return { operation: "record-reference-batch", target: runTarget, batch: {
              ...base, sourceHash: result.sourceHash, cases: result.cases,
              reference: { fileName: path.basename(oracle.uri.fsPath), sourceHash: result.referenceHash },
            } };
          }
          const { caseId, input: caseInput } = plan.value;
          const selected = { ...base, ...(caseId === FIRST_CHALLENGE_CASE_ID ? {} : { caseId }) };
          const input = { source, input: caseInput, signal: controller.signal };
          if (oracle.kind === "reference") {
            const { result, expectedOutput, referenceHash } = await runCppReferenceChallenge({ ...input, reference: oracle.source });
            // Compiler messages can include source excerpts. Keep them in VS Code for these runs.
            if (result.outcome !== "exited" && result.diagnostic) void vscode.window.showErrorMessage(result.diagnostic);
            return { operation: "record", target: runTarget, run: {
              ...selected, ...result, diagnostic: "", expectedOutput, expectedSource: "reference",
              reference: { fileName: path.basename(oracle.uri.fsPath), sourceHash: referenceHash },
            } };
          }
          return { operation: "record", target: runTarget, run: {
            ...selected, ...await runCppChallenge(input), expectedOutput: oracle.expectedOutput, expectedSource: oracle.expectedSource,
          } };
        }
        finally { subscription.dispose(); }
      });
      await checkTarget(false);
      if (submission.operation === "record-reference-batch") {
        try {
          encodeTransportMessage({ version: 1, id: randomUUID(), credential: token, challengeRun: submission });
        } catch {
          throw new Error("These results exceed the local transfer limit. Review and run the cases one at a time.");
        }
      }
      unsavedChallenges.set(target.fileUri, submission);
      await saveChallengeRun(submission, token);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      cancelOnEditorChange?.dispose();
      challengeRun = undefined;
    }
  }

  async function pinSelection() {
    requireLocal();
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.selections.length !== 1) throw new Error("Select one piece of code to pin to the Problem Desk.");
    const { document, selection } = editor;
    const fileUri = document.uri.toString(), version = document.version;
    const binding = bindings[fileUri];
    const size = document.offsetAt(selection.end) - document.offsetAt(selection.start);
    if (size > 10000) throw new Error("Select up to 10,000 characters to pin to the Problem Desk.");
    const target = await frozenTarget();
    const token = await credential();
    // A timer started on the desktop may have opened since the last heartbeat.
    // Keep the frozen queue target if the desktop is offline.
    const host = await send({ version: 1, id: randomUUID(), credential: token, action: "ping" }).catch(() => null);
    if (host?.ok && host.identity === target.key) {
      target.sessionId = typeof host.sessionId === "string" ? host.sessionId : undefined;
      target.recoveryEpoch = captureRecoveryEpoch(host.recoveryEpoch);
    }
    if (!local() || !paired || target.fileUri !== fileUri || !binding || target.key !== binding.key || bindings[fileUri] !== binding ||
        vscode.window.activeTextEditor !== editor || document.version !== version || editor.selections.length !== 1 || !editor.selection.isEqual(selection)) {
      throw new Error("The selection or problem changed. Choose the code again.");
    }
    const code = document.getText(selection);
    if (!code.trim()) throw new Error("Select code with some text to pin to the Problem Desk.");
    const pending = await capture("desk-add", { kind: "code", text: code, fileUri }, target);
    if (pending?.blocked) throw new Error(`Selection kept in pending captures. ${pending.blocked}`);
    const message = pending ? "Selection queued locally. It will appear on the Problem Desk after delivery." : "Selection pinned to the Problem Desk.";
    void vscode.window.setStatusBarMessage(message, 5000);
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
    const launchCredential = await credential(), launchFence = editorLaunchFence();
    await afterCompanionReady({ ready: () => companionReady(launchCredential), current: async () => {
      const candidate = current();
      // Starting the native app can change window focus and renew recognition's
      // generation. That alone does not change this explicitly chosen source.
      return !!candidate && sameCodeSource({ ...fence, generation: candidate.generation }, candidate) && editorLaunchFence() === launchFence && await credential() === launchCredential;
    }, run: async () => {} });
    fence.generation = activeGeneration;
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
    const choice = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, picked: allowed.includes(folder.uri.fsPath), folder })), { canPickMany: true, title: "Forma · permitted practice folders", placeHolder: "Recognition uses local metadata. Forma reads code only when you invoke a code command.", ignoreFocusOut: true });
    if (!choice) return;
    await withdraw(); allowed = choice.map(item => item.folder.uri.fsPath); await context.workspaceState.update(FOLDERS, allowed); await watchActive();
  }
  function register(name: string, run: () => unknown) { context.subscriptions.push(vscode.commands.registerCommand(`formaCompanion.${name}`, async () => { try { testCommandError = null; await run(); } catch (error) { const message = error instanceof Error ? error.message : "Forma could not complete this action."; if (context.extensionMode === vscode.ExtensionMode.Test) testCommandError = message; void vscode.window.showErrorMessage(message); } })); }
  register("setup", async () => { const choice = await vscode.window.showQuickPick(["Open Fenn", "Ask about selected code", "Recognise problems from CPH", "Select allowed folders", "Advanced: Attach Codeforces Problem", "Forget this file’s association"], { title: `Forma · ${connection}`, ignoreFocusOut: true }); if (choice === "Open Fenn") await openCompanion(); else if (choice === "Ask about selected code") await askSelectedCode(); else if (choice === "Recognise problems from CPH") await consent(); else if (choice === "Select allowed folders") await selectFolders(); else if (choice === "Advanced: Attach Codeforces Problem") await vscode.commands.executeCommand("formaCompanion.attachProblem"); else if (choice) await vscode.commands.executeCommand("formaCompanion.forget"); });
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
  register("open", () => openCompanion());
  register("askSelectedCode", askSelectedCode);
  register("pinSelection", pinSelection);
  register("runChallengeCase", () => runChallengeCase());
  register("runChallengeWithReference", () => runChallengeCase("reference"));
  register("findCounterexample", () => runChallengeCase("batch"));
  register("memory", () => openCompanion("memory"));
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
  register("retry", async () => {
    requireLocal(); const host = await action("ping"), epoch = captureRecoveryEpoch(host.recoveryEpoch);
    if (!epoch) throw new Error("Update Forma Companion and the VS Code extension before retrying saved captures.");
    const changed = queue.filter(entry => targets[entry.command.id]?.recoveryEpoch !== epoch);
    if (changed.length) {
      const choice = await vscode.window.showQuickPick([{ label: "Retry reviewed captures", detail: changed.map(entry => `${entry.command.type} · ${targets[entry.command.id]?.key ?? entry.command.expectedProblemKey ?? "target needs recovery"}`).join("; ").slice(0, 1000), retry: true }, { label: "Keep captures queued", detail: "Use Export Pending Captures for Recovery to inspect the original targets first.", retry: false }], { title: `${changed.length} saved capture(s) predate the current notebook. Review before delivery.`, ignoreFocusOut: true });
      if (!choice?.retry) return;
    }
    await serializeQueue(async () => {
      for (const entry of queue) { const target = targets[entry.command.id]; if (target) target.recoveryEpoch = epoch; }
      await context.workspaceState.update("forma-companion.capture-targets.v1", targets);
      await persistQueue(queue.map(entry => { const next = { ...entry, nextAttemptAt: Date.now() }; delete next.blocked; return next; }));
    });
    await flush(); await watchActive();
  });
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
  context.subscriptions.push({ dispose: () => { disposed = true; generation.next(); observationAbort.abort(); pollAbort?.abort(); challengeRun?.abort(); clearInterval(retry); clearInterval(heartbeat); clearTimeout(metadataTimer); watcher?.dispose(); } });
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
