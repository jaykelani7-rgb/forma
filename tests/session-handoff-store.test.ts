import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompanionStore } from "../apps/desktop/main/store";
import { backupHash } from "../apps/desktop/main/backup-schema";

const start = Date.parse("2026-11-08T08:00:00Z");
const transfer = {
  id: "a61d56bc-ef13-4a7f-b2f0-86e1f3554d04",
  origin: "https://forma.example",
  sourceKey: "a".repeat(43),
  claimKey: "b".repeat(43),
  sessionId: "companion:practice",
};
const accountId = "f14368fa-dbcf-4cdd-97c8-3d45483054a5";
const otherAccountId = "07e94ecf-59a1-4734-8ad0-2dc10c8dfb7a";
const url = "https://codeforces.com/contest/4/problem/A";
const fileUri = "file:///private/solutions/4A.cpp";

function pausedPractice(store: CompanionStore) {
  store.command({ id: "profile", type: "set-handle", payload: { handle: "tourist" } }, "desktop", start);
  const attached = store.command({ id: "attach", type: "attach", payload: { url, fileUri } }, "desktop", start);
  store.command({ id: "practice", type: "start", payload: {} }, "desktop", start);
  store.command({
    id: "pin", type: "desk-add", expectedProblemKey: "contest:4:A", expectedSessionId: transfer.sessionId,
    payload: { kind: "code", text: "return 0;", fileUri },
  }, "vscode", start + 1_000);
  store.command({
    id: "thread", type: "desk-add", expectedProblemKey: "contest:4:A",
    payload: { kind: "thread", text: "Check the odd input first.", problemId: attached.state.problemId },
  }, "desktop", start + 2_000);
  return store.command({ id: "pause", type: "pause", payload: {} }, "desktop", start + 8_000);
}

test("a paused handoff survives restart and a web receipt permanently retires the source timer", () => {
  const folder = mkdtempSync(join(tmpdir(), "forma-handoff-store-"));
  const path = join(folder, "notebook.sqlite");
  let store = new CompanionStore(path);
  try {
    const paused = pausedPractice(store);
    const beforeBackup = store.backups.export({ scope: "companion", includeTutor: true }, start + 8_000);
    assert.throws(() => store.beginHandoff({ ...transfer, sessionId: "old-session" }), /practice session changed/);
    const pending = store.beginHandoff(transfer);
    assert.equal(pending.offered, false);
    assert.equal(pending.packet.session.id, transfer.sessionId);
    assert.equal(pending.packet.session.elapsedMs, 8_000);
    assert.match(JSON.stringify(pending.packet), /Check the odd input first/);
    assert.doesNotMatch(JSON.stringify(pending.packet), /private\/solutions|return 0/);
    assert.deepEqual(store.snapshot(), paused);
    assert.doesNotMatch(JSON.stringify(store.snapshot()), new RegExp(transfer.sourceKey));
    assert.throws(() => store.exportNotebook(), /before exporting/);
    assert.throws(() => store.backups.preview(beforeBackup), /before restoring/);
    for (const [type, payload] of [["resume", {}], ["finish", {}], ["reflect", { outcome: "hint" }]] as const) {
      assert.throws(() => store.command({
        id: `blocked-${type}`, type, payload, expectedSessionId: transfer.sessionId,
      }, "vscode", start + 10_000), /Finish or cancel the web handoff/);
    }

    const sent = store.markHandoffSending({ id: transfer.id, accountId });
    assert.equal(sent.offered, true);
    store.close();
    store = new CompanionStore(path);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 6);
    assert.deepEqual(store.currentHandoff(), sent);
    assert.deepEqual(store.pauseForLifecycle("restart", start + 60_000), paused);
    assert.throws(() => store.markHandoffSending({ id: transfer.id, accountId: otherAccountId }), /workspace changed/);
    assert.throws(() => store.cancelHandoff({ id: transfer.id, terminal: false }), /Confirm cancellation/);
    assert.throws(() => store.completeHandoff({ id: transfer.id, sessionId: "old-session" }), /does not match/);

    const receipt = { id: transfer.id, sessionId: transfer.sessionId };
    const completed = store.completeHandoff(receipt, start + 60_000);
    assert.equal(store.currentHandoff(), null);
    assert.equal(completed.data.session, null);
    assert.deepEqual(completed.data.attempts, []);
    assert.equal(completed.state.desk?.find(item => item.id === "pin")?.sessionId, undefined);
    assert.equal(completed.state.desk?.find(item => item.id === "pin")?.text, "return 0;");
    assert.deepEqual(completed.state.followups, []);
    assert.deepEqual(store.completeHandoff(receipt, start + 61_000), completed);
    const recovery = store.backups.export({ scope: "companion", includeTutor: true }, start + 60_000);
    assert.throws(() => store.backups.restore(beforeBackup, {
      json: recovery, sha256: backupHash(recovery),
    }), /session was handed off/);
    assert.doesNotMatch(recovery, new RegExp(`${transfer.sourceKey}|${transfer.claimKey}`));
    const next = store.command({ id: "another-practice", type: "start", payload: {} }, "desktop", start + 61_000);
    assert.equal(next.data.session?.id, "companion:another-practice");
    assert.deepEqual(store.completeHandoff(receipt, start + 62_000), next);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("cancellation preserves measured time and restores the original session", () => {
  const store = new CompanionStore(":memory:");
  try {
    const paused = pausedPractice(store);
    store.beginHandoff(transfer);
    assert.deepEqual(store.cancelHandoff({ id: transfer.id, terminal: false }), paused);
    store.beginHandoff(transfer);
    store.markHandoffSending({ id: transfer.id, accountId });
    assert.deepEqual(store.cancelHandoff({ id: transfer.id, terminal: true }), paused);
    const resumed = store.command({ id: "resume-local", type: "resume", payload: {}, expectedSessionId: transfer.sessionId }, "desktop", start + 90_000);
    assert.equal(resumed.data.session?.id, transfer.sessionId);
    assert.equal(resumed.data.session?.elapsedMs, 8_000);
    assert.equal(resumed.data.session?.runningSince, start + 90_000);
  } finally {
    store.close();
  }
});
