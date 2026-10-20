import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CompanionStore } from "../apps/desktop/main/store";
import { RecognitionHub, CLIENT_MAX_AGE, PROPOSAL_MAX_AGE } from "../apps/desktop/main/recognition";
import { RecognitionGeneration, parseRecognition, type EditorContext } from "../packages/integrations/recognition";
import { cphMetadataPath, parseCphMetadata, readCphBindingWithRetry, SUPPORTED_CPH_VERSIONS } from "../packages/integrations/cph";
import { BROWSER_ORIGIN } from "../packages/integrations/browser-id";
import { assertBrowserOrigin, encodeNativeMessage, NativeMessageFrames, parseBrowserMessage } from "../packages/integrations/browser";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { capturePreconditions, freezeCaptureTarget } from "../packages/core/src/capture-target";
import { activeSolutionBinding } from "../packages/core/src/active-binding";

const A = { url: "https://codeforces.com/contest/4/problem/A", title: "Watermelon", source: "cph" as const, adapterVersion: SUPPORTED_CPH_VERSIONS[0] };
const B = { url: "https://codeforces.com/gym/100001/problem/A2", title: "Gym split index", source: "cph" as const, adapterVersion: SUPPORTED_CPH_VERSIONS[0] };
function setup() {
  const store = new CompanionStore(":memory:"); let now = Date.now();
  const hub = new RecognitionHub({ snapshot: async () => store.snapshot(), command: async c => store.command(c, "vscode", now), select: async (file, client) => store.selectBinding(file, client, now), changed: () => {}, now: () => now });
  let generation = 0;
  const context = (file: string, binding?: EditorContext["binding"], extra: Partial<EditorContext> = {}): EditorContext => ({ clientId: "local-client", workspaceId: "practice", instanceId: "window-one", generation: ++generation, focused: true, automatic: true, observedAt: now, fileUri: `file:///practice/${file}.cpp`, reason: "focus", ...(binding ? { binding } : {}), ...extra });
  return { store, hub, context, tick: (ms = 1) => { now += ms; }, now: () => now };
}
const journal = (store: CompanionStore) => Number(store.db.prepare("SELECT count(*) n FROM observations").get()!.n);

test("CPH recognition needs no input dialog, repeats are idempotent, and known files restore after host restart", async () => {
  const { store, hub, context, tick, now } = setup();
  try {
    const first = context("a", A); await hub.request(first);
    assert.equal(store.snapshot().state.identity, "contest:4:A"); assert.equal(store.snapshot().data.session, null);
    const count = journal(store), confirmed = store.snapshot().state.bindings[0].confirmedAt;
    await hub.request(first); await hub.request({ ...first, reason: "heartbeat" }); await hub.request(context("a", A));
    assert.equal(journal(store), count); assert.equal(store.snapshot().state.bindings[0].confirmedAt, confirmed);
    tick(); await hub.request(context("b", B)); assert.equal(store.snapshot().state.identity, "gym:100001:A2");
    const restarted = new RecognitionHub({ snapshot: async () => store.snapshot(), command: async c => store.command(c), select: async (file, client) => store.selectBinding(file, client), changed: () => {}, now });
    await restarted.request(context("a")); assert.equal(store.snapshot().state.identity, "contest:4:A");
    assert.equal(store.snapshot().state.bindings.find(b => b.identity === "contest:4:A")!.confirmedAt, confirmed); assert.equal(journal(store), count + 1);
    assert.equal(store.snapshot().state.bindings.length, 2); assert.equal(store.snapshot().data.attempts.length, 0); assert.equal(store.snapshot().state.localTests, "unknown");
  } finally { store.close(); }
});
test("checked-in adapter fixtures preserve exact CPH namespace and path provenance", () => {
  for (const [name, key] of [["contest", "contest:4:A"], ["gym", "gym:100001:A2"]]) {
    const fixture = JSON.parse(readFileSync(`tests/fixtures/cph/${SUPPORTED_CPH_VERSIONS[0]}/${name}.json`, "utf8"));
    const parsed = parseCphMetadata(fixture, fixture.srcPath, SUPPORTED_CPH_VERSIONS[0]);
    assert.ok(parsed.ok); if (parsed.ok) assert.equal(parsed.binding.problemKey, key);
  }
});
for (const phase of ["running", "paused", "reflection"] as const) test(`${phase} sessions retain their problem when another solution is recognised`, async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); store.command({ id: "start", type: "start", payload: {} });
    if (phase !== "running") store.command({ id: phase, type: phase === "paused" ? "pause" : "finish", payload: {} });
    const session = store.snapshot().data.session;
    await hub.request(context("b", B)); assert.deepEqual(store.snapshot().data.session, session);
    assert.equal(store.snapshot().state.identity, "contest:4:A"); assert.equal(store.snapshot().state.bindings.length, 2); assert.equal(hub.presentation()?.status, "needs-choice");
    hub.dismiss(); assert.equal(hub.presentation(), null); assert.deepEqual(store.snapshot().data.session, session);
  } finally { store.close(); }
});
test("finish-and-switch waits for an explicit reflection; cancelling keeps the session and candidate", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); store.command({ id: "start", type: "start", payload: {} }); await hub.request(context("b", B));
    await hub.finishAndSwitch(); assert.equal(store.snapshot().data.session?.phase, "reflection"); assert.equal(store.snapshot().state.identity, "contest:4:A");
    assert.equal(hub.presentation()?.status, "needs-choice"); assert.equal(store.snapshot().data.attempts.length, 0);
    store.command({ id: "reflect", type: "reflect", payload: { outcome: "hint", takeaway: "Parity" } }); await hub.afterReflection();
    assert.equal(store.snapshot().state.identity, "gym:100001:A2"); assert.equal(store.snapshot().data.attempts[0].outcome, "hint"); assert.equal(store.snapshot().data.session, null);
  } finally { store.close(); }
});
test("a late generation and background windows cannot replace the actual focused context", async () => {
  const { store, hub, context, tick } = setup();
  try {
    const late = context("a", A); tick(2); const current = context("b", B); await hub.request(current); await hub.request(late);
    assert.equal(store.snapshot().state.identity, "gym:100001:A2");
    await hub.request(context("background", A, { instanceId: "background", focused: false, reason: "observe" }));
    assert.equal(store.snapshot().state.identity, "gym:100001:A2");
    await hub.request({ ...late, instanceId: "old-window", generation: 10 }); assert.equal(store.snapshot().state.identity, "gym:100001:A2");
    store.command({ id: "desktop-select", type: "attach", payload: { url: A.url } });
    await hub.request({ ...current, reason: "heartbeat" }); assert.equal(store.snapshot().state.identity, "contest:4:A");
  } finally { store.close(); }
});
test("manual/browser mappings win over CPH and file reuse has an explicit resolution", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", { ...A, source: "manual" }));
    await hub.request(context("a", A)); assert.equal(store.snapshot().state.bindings[0].source, "manual");
    await hub.request(context("a", B)); assert.equal(hub.presentation()?.status, "conflict"); assert.equal(store.snapshot().state.identity, "contest:4:A");
    await hub.resolveConflict(); assert.equal(store.snapshot().state.identity, "gym:100001:A2"); assert.equal(store.snapshot().state.bindings[0].source, "cph");
  } finally { store.close(); }
});
test("known rename and forget affect associations only, preserving notebook memory", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); store.command({ id: "thought", type: "thought", payload: { text: "private observation" } });
    store.command({ id: "rename", type: "rename-binding", payload: { fileUri: "file:///practice/a.cpp", newFileUri: "file:///practice/renamed.cpp", clientId: "local-client", workspaceId: "practice" } });
    assert.equal(store.snapshot().state.bindings[0].fileUri, "file:///practice/renamed.cpp");
    store.command({ id: "forget", type: "forget-binding", payload: { fileUri: "file:///practice/renamed.cpp", clientId: "local-client", workspaceId: "practice" } });
    assert.equal(store.snapshot().state.bindings.length, 0); assert.equal(store.snapshot().state.thoughts[0].text, "private observation"); assert.equal(store.snapshot().data.problems.length, 1);
  } finally { store.close(); }
});
test("permission withdrawal and expired candidates reject browser selection", async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context("a", A); await hub.request(c);
    const p = await hub.browser({ kind: "propose", url: B.url, title: B.title });
    await hub.request({ ...c, reason: "withdraw", generation: c.generation + 1 });
    await assert.rejects(hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id }), /changed/);
    await hub.request(context("a", A)); tick(CLIENT_MAX_AGE + 1);
    await assert.rejects(hub.browser({ kind: "propose", url: B.url, title: B.title }), /permitted solution/);
    assert.equal(store.snapshot().state.identity, "contest:4:A");
  } finally { store.close(); }
});
test("browser proposals freeze exact targets, reject changed files, expire, and replay without duplicate writes", async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context("a", A); await hub.request(c);
    await hub.request(context("unfocused", A, { instanceId: "never-focused", focused: false, reason: "observe" }));
    const p = await hub.browser({ kind: "propose", url: B.url, title: B.title });
    assert.equal(p.targets!.length, 1); assert.match(p.targets![0].label, /^a.cpp/); assert.ok(!JSON.stringify(p).includes("file:///"));
    const targetId = p.targets![0].id;
    assert.equal((await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId })).status, "waiting");
    const delivery = (await hub.request({ reason: "poll", instanceId: c.instanceId })).proposal as { fileUri: string; generation: number };
    assert.equal(delivery.fileUri, c.fileUri); assert.equal(delivery.generation, c.generation);
    await hub.request({ ...c, reason: "observe", proposalId: p.proposalId, binding: { ...B, source: "browser", replace: true } });
    await hub.request({ reason: "proposal-result", instanceId: c.instanceId, proposalId: p.proposalId!, accepted: true });
    const writes = journal(store);
    assert.equal((await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId })).status, "saved"); assert.equal(journal(store), writes);
    const changed = await hub.browser({ kind: "propose", url: A.url, title: A.title }); await hub.request(context("b", B));
    await assert.rejects(hub.browser({ kind: "confirm", proposalId: changed.proposalId, targetId: changed.targets![0].id }), /changed/);
    const expired = await hub.browser({ kind: "propose", url: A.url, title: A.title }); tick(PROPOSAL_MAX_AGE + 1);
    assert.equal((await hub.browser({ kind: "status", proposalId: expired.proposalId })).status, "expired");
    assert.equal(store.snapshot().data.attempts.length, 0);
  } finally { store.close(); }
});
test("native framing and scoped browser schemas reject forged authority and preserve split UTF-8", () => {
  assert.doesNotThrow(() => assertBrowserOrigin(BROWSER_ORIGIN)); assert.throws(() => assertBrowserOrigin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"));
  for (const bad of [{ kind: "start", payload: {} }, { kind: "propose", url: A.url, title: "x", command: "reflect" }, { kind: "propose", url: "https://evil.example/contest/4/problem/A", title: "x" }, { kind: "propose", url: "file:///tmp/a", title: "x" }]) assert.throws(() => parseBrowserMessage(bad));
  assert.equal(parseBrowserMessage({ kind: "propose", url: B.url, title: "色" }).kind, "propose");
  const frame = encodeNativeMessage({ kind: "propose", url: B.url, title: "色" }), reader = new NativeMessageFrames(), split = frame.indexOf(Buffer.from("色")) + 1;
  assert.deepEqual(reader.push(frame.subarray(0, split)), []); assert.equal((reader.push(frame.subarray(split))[0] as { title: string }).title, "色"); reader.end();
  assert.throws(() => new NativeMessageFrames().push(Buffer.from([255, 255, 255, 255])));
  const truncated = new NativeMessageFrames(); truncated.push(frame.subarray(0, 5)); assert.throws(() => truncated.end());
  assert.throws(() => parseRecognition({ reason: "focus", instanceId: "x", fileUri: "https://evil.example" }));
  const manifest = JSON.parse(readFileSync("apps/chrome-extension/manifest.json", "utf8"));
  const id = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)].map(n => String.fromCharCode(97 + (n >> 4)) + String.fromCharCode(97 + (n & 15))).join("");
  assert.equal(BROWSER_ORIGIN, `chrome-extension://${id}/`); assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "nativeMessaging"]); assert.equal(manifest.host_permissions, undefined);
});
test("bounded retries survive partial/atomic CPH writes, long titles, and obsolete reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forma-recognition-")), source = join(directory, "a.cpp");
  try {
    await writeFile(source, ""); await mkdir(join(directory, ".cph")); const metadata = cphMetadataPath(source);
    await writeFile(metadata, "{"); let waits = 0;
    const record = { srcPath: source, url: B.url, name: "A".repeat(500), tests: [] };
    const result = await readCphBindingWithRetry({ solutionPath: source, version: SUPPORTED_CPH_VERSIONS[0], permittedFolders: [directory] }, () => true, async () => { waits++; await writeFile(metadata + ".tmp", JSON.stringify(record)); await rename(metadata + ".tmp", metadata); });
    assert.equal(waits, 1); assert.ok(result?.ok); if (result?.ok) assert.equal(result.binding.title.length, 240);
    const token = new RecognitionGeneration(), first = token.next(); token.next();
    assert.equal(await readCphBindingWithRetry({ solutionPath: source, version: SUPPORTED_CPH_VERSIONS[0], permittedFolders: [directory] }, () => token.current(first)), null);
    assert.deepEqual(parseCphMetadata(record, source, "unknown"), { ok: false, reason: "unsupported-version" });
    await rm(metadata); let missingWaits = 0;
    await readCphBindingWithRetry({ solutionPath: source, version: SUPPORTED_CPH_VERSIONS[0], permittedFolders: [directory] }, () => true, async () => { missingWaits++; }); assert.equal(missingWaits, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("disabling CPH or forgetting a file stops automatic selection, while explicit browser capture remains available", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); await hub.request(context("b", B));
    await hub.request(context("a", undefined, { automatic: false })); assert.equal(store.snapshot().state.identity, "gym:100001:A2"); assert.equal(hub.presentation(), null);
    await hub.request(context("a", undefined, { suppressed: true })); assert.equal(store.snapshot().state.identity, "gym:100001:A2");
    const proposal = await hub.browser({ kind: "propose", url: A.url, title: A.title });
    hub.cancelBrowser(); assert.equal((await hub.browser({ kind: "status", proposalId: proposal.proposalId })).status, "cancelled");
    await hub.request(context("a", A)); assert.equal(store.snapshot().state.identity, "contest:4:A");
  } finally { store.close(); }
});
test("a browser saved acknowledgement requires an actual matching durable browser association", async () => {
  const { store, hub, context } = setup();
  try {
    const c = context("a", A); await hub.request(c); const p = await hub.browser({ kind: "propose", url: B.url, title: B.title });
    await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id });
    await hub.request({ reason: "proposal-result", instanceId: c.instanceId, proposalId: p.proposalId!, accepted: true });
    assert.equal((await hub.browser({ kind: "status", proposalId: p.proposalId })).status, "rejected"); assert.equal(store.snapshot().state.identity, "contest:4:A");
  } finally { store.close(); }
});
test("deferred forget and rename cannot remove a newer confirmed association", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); const old = store.snapshot().state.bindings[0];
    await hub.request(context("a", { ...B, source: "manual", replace: true }));
    assert.throws(() => store.command({ id: "old-forget", type: "forget-binding", payload: { fileUri: old.fileUri, bindingId: old.id, clientId: "local-client", workspaceId: "practice" } }), /association changed/);
    assert.equal(store.snapshot().state.bindings[0].identity, "gym:100001:A2");
  } finally { store.close(); }
});
test("cancelled and expired browser deliveries cannot write a binding after confirmation", async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context("a", A); await hub.request(c);
    for (const kind of ["cancel", "expire"] as const) {
      const p = await hub.browser({ kind: "propose", url: B.url, title: B.title });
      await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id });
      if (kind === "cancel") await hub.browser({ kind: "cancel", proposalId: p.proposalId }); else tick(PROPOSAL_MAX_AGE + 1);
      await assert.rejects(hub.request({ ...c, observedAt: Date.now(), reason: "observe", proposalId: p.proposalId, binding: { ...B, source: "browser", replace: true } }), /expired|cancelled/);
      assert.equal(store.snapshot().state.bindings[0].identity, "contest:4:A");
    }
  } finally { store.close(); }
});
test("restoring a saved browser mapping in a background window cannot steal focused context", async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context("a", A); await hub.request(c); const p = await hub.browser({ kind: "propose", url: A.url, title: A.title });
    await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id });
    await hub.request({ ...c, reason: "observe", proposalId: p.proposalId, binding: { ...A, source: "browser", replace: true } });
    tick(); await hub.request(context("b", B, { instanceId: "foreground" }));
    await hub.request(context("a", { ...A, source: "browser" }, { instanceId: "background", focused: false, reason: "observe" }));
    assert.equal(store.snapshot().state.identity, "gym:100001:A2");
  } finally { store.close(); }
});
test("two windows on the same solution offer one browser target, and a browser choice cannot reassign a paused session", async () => {
  const { store, hub, context, tick } = setup();
  try {
    await hub.request(context("a", A)); store.command({ id: "start", type: "start", payload: {} }); store.command({ id: "pause", type: "pause", payload: {} });
    tick(); const c = context("b", B); await hub.request(c); tick(); const duplicate = context("b", B, { instanceId: "duplicate-window" }); await hub.request(duplicate);
    const p = await hub.browser({ kind: "propose", url: "https://codeforces.com/contest/6/problem/B", title: "Another problem" });
    assert.equal(p.targets!.length, 1);
    await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id });
    await hub.request({ ...duplicate, reason: "observe", proposalId: p.proposalId, binding: { url: "https://codeforces.com/contest/6/problem/B", title: "Another problem", source: "browser", replace: true } });
    assert.equal(store.snapshot().state.identity, "contest:4:A"); assert.equal(store.snapshot().data.session?.runningSince, null); assert.equal(hub.presentation()?.status, "needs-choice"); assert.equal(store.snapshot().data.attempts.length, 0);
  } finally { store.close(); }
});
test("a stale browser cache refreshes after explicit CPH conflict resolution instead of restoring its old mapping", async () => {
  const { store, hub, context } = setup();
  try {
    const c = context("a", A); await hub.request(c); const p = await hub.browser({ kind: "propose", url: A.url, title: A.title });
    await hub.browser({ kind: "confirm", proposalId: p.proposalId, targetId: p.targets![0].id });
    await hub.request({ ...c, reason: "observe", proposalId: p.proposalId, binding: { ...A, source: "browser", replace: true } });
    await hub.request(context("a", B)); await hub.resolveConflict();
    const refreshed = await hub.request(context("a", { ...A, source: "browser" }));
    assert.equal((refreshed.savedBinding as { identity: string }).identity, "gym:100001:A2"); assert.equal(store.snapshot().state.bindings[0].source, "cph");
  } finally { store.close(); }
});
test("desktop drafts retain their original problem and session across focus changes and later sessions", async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context("a", A)); const thought = freezeCaptureTarget(store.snapshot())!;
    await hub.request(context("b", B));
    assert.throws(() => store.command({ id: "delayed-draft", type: "thought", payload: { text: "For Watermelon" }, ...capturePreconditions(thought) }), /problem changed/);
    assert.equal(store.snapshot().state.thoughts.length, 0);
    await hub.request(context("a", A)); store.command({ id: "first-session", type: "start", payload: {} }); const reflection = freezeCaptureTarget(store.snapshot())!;
    store.command({ id: "first-finish", type: "finish", payload: {} }); store.command({ id: "first-reflect", type: "reflect", payload: { outcome: "hint" } }); store.command({ id: "later-session", type: "start", payload: {} });
    assert.throws(() => store.command({ id: "delayed-reflection", type: "reflect", payload: { outcome: "independent" }, ...capturePreconditions(reflection) }), /session changed/);
    assert.equal(store.snapshot().data.attempts.length, 1); assert.equal(store.snapshot().data.session?.id, "companion:later-session");
  } finally { store.close(); }
});

for (const phase of ['ready', 'running', 'paused', 'reflection'] as const) test(`same-problem own/generated files follow real editor focus during ${phase}`, async () => {
  const { store, hub, context } = setup();
  try {
    const own = context('1968B', { ...A, source: 'manual' }); await hub.request(own);
    if (phase !== 'ready') store.command({ id: 'start', type: 'start', payload: {} });
    if (phase === 'paused' || phase === 'reflection') store.command({ id: phase, type: phase === 'paused' ? 'pause' : 'finish', payload: {} });
    await hub.request(context('B_Prefiquence', A));
    assert.equal(hub.activeFileUri(), 'file:///practice/B_Prefiquence.cpp');
    const session = store.snapshot().data.session, writes = journal(store), bindings = store.snapshot().state.bindings;
    hub.dismiss();
    const reply = await hub.request(context('1968B'));
    assert.equal((reply.recognition as { status: string }).status, 'active');
    assert.equal(activeSolutionBinding(store.snapshot().state.bindings, store.snapshot().state.problemId!, hub.activeFileUri())?.fileUri, own.fileUri);
    assert.deepEqual(store.snapshot().data.session, session); assert.deepEqual(store.snapshot().state.bindings, bindings); assert.equal(journal(store), writes);
    // Closing the generated tab and re-opening an already known own file is not a new confirmation.
    await hub.request(context('1968B')); assert.equal(journal(store), writes);
    const closed = context('1968B', undefined, { fileUri: null, reason: 'withdraw' }); await hub.request(closed);
    assert.equal(hub.activeFileUri(), null);
    assert.equal(activeSolutionBinding(bindings, store.snapshot().state.problemId!, hub.activeFileUri()), undefined);
  } finally { store.close(); }
});

test('explicit repeated Chrome capture reopens an offer after Keep current, without duplicating associations or changing the session', async () => {
  const { store, hub, context } = setup();
  try {
    await hub.request(context('current', A)); store.command({ id: 'start', type: 'start', payload: {} });
    const c = context('1968B'); await hub.request(c);
    const session = store.snapshot().data.session;
    for (let i = 0; i < 4; i++) {
      const p = await hub.browser({ kind: 'propose', url: B.url, title: B.title });
      await hub.browser({ kind: 'confirm', proposalId: p.proposalId, targetId: p.targets![0].id });
      const reply = await hub.request({ ...c, reason: 'observe', focused: false, proposalId: p.proposalId, binding: { ...B, source: 'browser', replace: true } });
      await hub.request({ reason: 'proposal-result', instanceId: c.instanceId, proposalId: p.proposalId!, accepted: true });
      assert.equal((reply.recognition as { status: string }).status, 'candidate');
      assert.equal(hub.presentation()?.status, 'needs-choice'); hub.dismiss();
      assert.equal(hub.presentation(), null); assert.deepEqual(store.snapshot().data.session, session);
    }
    assert.equal(store.snapshot().state.bindings.length, 2); assert.equal(journal(store), 3);
  } finally { store.close(); }
});

test('late dismissals cannot hide a newer candidate and background editor changes cannot claim the active file', async () => {
  const { store, hub, context } = setup();
  try {
    const first = context('a', A); await hub.request(first); const oldView = hub.presentation()!;
    const second = context('b', B); await hub.request(second);
    hub.dismiss(oldView.id); assert.equal(hub.presentation()?.fileUri, second.fileUri);
    await hub.request(context('a', A, { focused: false, reason: 'observe' }));
    assert.equal(hub.activeFileUri(), null); assert.equal(store.snapshot().state.identity, 'gym:100001:A2');
    assert.equal(activeSolutionBinding(store.snapshot().state.bindings, store.snapshot().state.problemId!, hub.activeFileUri()), undefined);
  } finally { store.close(); }
});

test('CPH conflict resolution keeps the actual metadata target when clicking Fenn blurs VS Code', async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context('a', { ...A, source: 'manual' }); await hub.request(c);
    await hub.request({ ...c, reason: 'observe', binding: B }); assert.equal(hub.presentation()?.status, 'conflict');
    tick(); await hub.request({ ...c, observedAt: Date.now(), reason: 'focus', focused: false });
    await hub.resolveConflict(); assert.equal(store.snapshot().state.identity, 'gym:100001:A2');
    await hub.request(context('a', A)); await hub.request(context('b', B));
    await assert.rejects(hub.resolveConflict(), /eligible solution/);
  } finally { store.close(); }
});

test('late focus and metadata cannot revive a withdrawn file, while a fresh generation can reconnect', async () => {
  const { store, hub, context, tick } = setup();
  try {
    const c = context('a', A); await hub.request(c);
    await hub.request({ ...c, generation: c.generation + 1, reason: 'withdraw', fileUri: null });
    for (const reason of ['focus', 'observe', 'heartbeat'] as const) {
      const reply = await hub.request({ ...c, reason }); assert.equal(reply.stale, true); assert.equal(hub.activeFileUri(), null);
    }
    await assert.rejects(hub.browser({ kind: 'propose', url: B.url, title: B.title }), /permitted solution/);
    tick(); await hub.request({ ...c, observedAt: Date.now(), generation: c.generation + 2 });
    assert.equal(hub.activeFileUri(), c.fileUri); assert.equal(store.snapshot().state.bindings.length, 1);
  } finally { store.close(); }
});

test('closing or changing a file after browser confirmation promptly rejects its pending delivery', async () => {
  const { store, hub, context } = setup();
  try {
    const c = context('a', A); await hub.request(c);
    const p = await hub.browser({ kind: 'propose', url: B.url, title: B.title }); await hub.browser({ kind: 'confirm', proposalId: p.proposalId, targetId: p.targets![0].id });
    await hub.request(context('b', B));
    assert.equal((await hub.browser({ kind: 'status', proposalId: p.proposalId })).status, 'rejected');
    await assert.rejects(hub.request({ ...c, generation: c.generation + 10, reason: 'observe', proposalId: p.proposalId, binding: { ...B, source: 'browser' } }), /expired|cancelled|another file/);
    assert.equal(store.snapshot().state.bindings.find(b => b.fileUri === c.fileUri)!.identity, 'contest:4:A');
  } finally { store.close(); }
});

test('confirming an expired or cancelled proposal reports its real state rather than a different-file conflict', async () => {
  const { store, hub, context, tick } = setup();
  try {
    await hub.request(context('a', A));
    for (const kind of ['expired', 'cancelled'] as const) {
      const p = await hub.browser({ kind: 'propose', url: B.url, title: B.title });
      if (kind === 'expired') tick(PROPOSAL_MAX_AGE + 1); else await hub.browser({ kind: 'cancel', proposalId: p.proposalId });
      const reply = await hub.browser({ kind: 'confirm', proposalId: p.proposalId, targetId: p.targets![0].id });
      assert.equal(reply.status, kind);
      await hub.request(context('a', A));
    }
    assert.equal(store.snapshot().state.bindings.length, 1);
  } finally { store.close(); }
});
