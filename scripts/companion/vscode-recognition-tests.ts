import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cphMetadataPath, SUPPORTED_CPH_VERSIONS } from "../../packages/integrations/cph";
import type { EditorContext } from "../../packages/integrations/recognition";
import type { SharedCode } from "../../packages/tutor/types";

type TestApi = { seed: (token: string, folders: string[]) => Promise<void>; reconcile: () => Promise<void>; state: () => { connection: string; bindings: Record<string, { key: string; id?: string }>; observing: EditorContext | null; queue: { command: { expectedProblemKey?: string }; blocked?: string }[] }; frozenTarget: () => Promise<{ fileUri: string; key: string }>; capture: (type: string, payload: Record<string, unknown>, target: { fileUri: string; key: string }) => Promise<void>; setTutorCodeChoice: (mode:"selection"|"file"|"cancel", afterChoice?:()=>Promise<void>)=>void; tutorCommandError:()=>string|null };
export async function run() {
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const extension = vscode.extensions.getExtension<TestApi>("forma.forma-companion")!;
  const api = await extension.activate(); assert.ok(api?.seed);
  const cph = vscode.extensions.getExtension("divyanshuagrawal.competitive-programming-helper");
  assert.equal(cph?.packageJSON.version, SUPPORTED_CPH_VERSIONS[0]); await cph!.activate();
  await api.seed(process.env.FORMA_TEST_CREDENTIAL!, [folder]);
  const files = [join(folder, "a.cpp"), join(folder, "b.cpp")];
  await mkdir(join(folder, ".cph"), { recursive: true });
  async function waitFor(check: () => boolean) { const until = Date.now() + 20000; while (!check()) { if (Date.now() > until) throw new Error("Real VS Code recognition did not acknowledge: " + JSON.stringify(api.state())); await new Promise(r => setTimeout(r, 100)); } }
  for (const [i, file] of files.entries()) {
    await writeFile(file, "// Disposable recognition test solution; no compile or submit.\n");
    await writeFile(cphMetadataPath(file), JSON.stringify({ srcPath: file, name: i ? "B. Split index" : "A. Watermelon", url: i ? "https://codeforces.com/gym/100001/problem/A2" : "https://codeforces.com/contest/4/problem/A", tests: [] }));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file)); await api.reconcile();
    await new Promise(resolve => setTimeout(resolve, 1000)); await api.reconcile();
    await waitFor(() => api.state().bindings[vscode.Uri.file(file).toString()]?.key === (i ? "gym:100001:A2" : "contest:4:A"));
  }
  // The real editor event source, watchers, SecretStorage and socket ACK path are in use.
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(files[0])); await api.reconcile();
  await waitFor(() => api.state().observing?.fileUri === vscode.Uri.file(files[0]).toString());
  await writeFile(join(folder, "browser-ready.json"), JSON.stringify({ ready: true }));
  await waitFor(() => api.state().bindings[vscode.Uri.file(files[0]).toString()]?.key === "contest:6:B");
  await new Promise(resolve => setTimeout(resolve, 300));
  // Reproduce generated/own-file switching for one identity in the real editor host.
  const own = join(folder, '1968B.cpp'), generated = join(folder, 'B_Prefiquence.cpp');
  const url = 'https://codeforces.com/contest/1968/problem/B';
  for (const file of [own, generated]) {
    await writeFile(file, '// Existing disposable solution; no compile or submit.\nint prefix(int x) { return x + 1; }\n');
    await writeFile(cphMetadataPath(file), JSON.stringify({ srcPath: file, name: 'B. Prefiquence', url, tests: [] }));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file)); await api.reconcile();
    await waitFor(() => api.state().bindings[vscode.Uri.file(file).toString()]?.key === 'contest:1968:B');
  }
  const beforeFiles = (await readdir(folder)).sort();
  for (let i = 0; i < 3; i++) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(generated)); await api.reconcile();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(own)); await api.reconcile();
    assert.equal(api.state().observing?.fileUri, vscode.Uri.file(own).toString());
    assert.equal(api.state().connection, 'File linked');
  }
  assert.deepEqual((await readdir(folder)).sort(), beforeFiles);
  // Invoke the actual registered Tutor action, replacing only the picker choice in this Test host.
  const codeEditor = vscode.window.activeTextEditor!;
  codeEditor.selection = new vscode.Selection(1, 0, 1, codeEditor.document.lineAt(1).text.length);
  api.setTutorCodeChoice("selection");
  await vscode.commands.executeCommand("formaCompanion.askSelectedCode");
  assert.equal(api.tutorCommandError(), null);
  const acknowledged = JSON.parse(await readFile(join(folder, "tutor-code-ack.json"), "utf8")) as { code:SharedCode; captures:number; conversationId:string; providerTurns:number };
  assert.equal(acknowledged.captures, 1); assert.equal(acknowledged.providerTurns, 0); assert.ok(acknowledged.conversationId);
  assert.equal(acknowledged.code.fileUri, vscode.Uri.file(own).toString()); assert.equal(acknowledged.code.identity, "contest:1968:B");
  assert.equal(acknowledged.code.filename, "1968B.cpp"); assert.equal(acknowledged.code.language, "cpp");
  assert.equal(acknowledged.code.text, "int prefix(int x) { return x + 1; }"); assert.equal(acknowledged.code.startLine, 2); assert.equal(acknowledged.code.endLine, 2);
  assert.match(acknowledged.code.revision, /^version:\d+:sha256:[a-f0-9]{64}$/);
  assert.equal(acknowledged.code.workspaceId, api.state().observing?.workspaceId);
  api.setTutorCodeChoice("cancel"); await vscode.commands.executeCommand("formaCompanion.askSelectedCode"); assert.equal(api.tutorCommandError(), null);
  api.setTutorCodeChoice("selection", async () => { await codeEditor.edit(edit => edit.insert(new vscode.Position(0,0), "// Changed during the explicit source picker.\n")); });
  await vscode.commands.executeCommand("formaCompanion.askSelectedCode"); assert.match(api.tutorCommandError() ?? "", /changed/);
  api.setTutorCodeChoice("file", async () => { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(generated)); await api.reconcile(); });
  await vscode.commands.executeCommand("formaCompanion.askSelectedCode"); assert.match(api.tutorCommandError() ?? "", /changed/);
  const unchanged = JSON.parse(await readFile(join(folder, "tutor-code-ack.json"), "utf8"));
  assert.equal(unchanged.captures, 1); assert.equal(unchanged.code.revision, acknowledged.code.revision);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(own)); await api.reconcile();
  const ownTarget = await api.frozenTarget();
  await api.capture('attach', {url, fileUri: ownTarget.fileUri, source: 'manual', activate: false, replace: true}, ownTarget);
  assert.ok(api.state().bindings[ownTarget.fileUri].id, 'Manual association must retain its receipt for safe deferred forget/rename');
  await writeFile(join(folder, 'same-problem-returned.json'), JSON.stringify({ fileUri: vscode.Uri.file(own).toString() }));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(files[0])); await api.reconcile();
  const frozen = await api.frozenTarget();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(files[1])); await api.reconcile();
  await api.capture("thought", { text: "Controlled delayed-dialog observation" }, frozen);
  assert.equal(api.state().queue[0].command.expectedProblemKey, "contest:6:B"); assert.ok(api.state().queue[0].blocked);
  await writeFile(join(folder, "live-results.json"), JSON.stringify({ realExtensionHost: true, cphVersion: cph!.packageJSON.version, cphActivated: true, metadataSource: "controlled .prob fixtures; not a live CPH import", pairedSecretStorage: true, twoDurableBindings: true, realBrowserDeliveryToFrozenEditor: true, ownAndGeneratedFileSwitching: true, noGeneratedFilesByForma: true, mismatchedFrozenCaptureRetained: true, explicitSelectedCodeCommand: true, tutorPickerChoiceSource: "deterministic isolated Test-host choice; production picker unchanged", tutorFrozenProblemAndSource: true, tutorCancellationAndRapidEditsRejected: true, tutorRapidEditorSwitchRejected: true, tutorProviderTurnNotCreatedOnShare: true, focused: vscode.window.state.focused, returnedFile: api.state().observing?.fileUri }, null, 2));
}
