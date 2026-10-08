import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData, localDate, type Data } from "../src/lib/model";
import {
  reconcilePracticePlan,
  currentPracticePlan,
  practicePlanView,
  setPlanAvailability,
  setPracticePreferences,
} from "../src/lib/practice-plan";
import {
  commitWorkspace,
  loadWorkspace,
  recoveriesFor,
} from "../src/lib/storage";
import {
  decodeBackup,
  encodeBackup,
  mergeWorkspaces,
} from "../src/lib/concurrency";
const now = new Date(2026, 9, 8, 12),
  after = new Date(now.getTime() + 600000);
const source = (): Data => ({
  ...emptyData(),
  problems: ["a", "b", "c"].map((id) => ({
    id,
    title: id,
    platform: "LeetCode",
    url: "",
    problemCode: "",
    tags: ["arrays"],
    rating: null,
    createdAt: now.toISOString(),
    reviewAt: localDate(now),
    reviewCount: 0,
  })),
});

test("failed day-plan persistence retains the proposal and exact retry/double submission saves one plan with stable items", async () => {
  const key = "account:plan-failed",
    base = await loadWorkspace(key, source());
  const proposal = setPlanAvailability(base.data, 45, now),
    ids = currentPracticePlan(proposal, now)!.items.map((item) => item.id);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    value: unknown,
    recordKey?: IDBValidKey,
  ) {
    if (this.name === "workspaces")
      throw new DOMException("Storage is full.", "QuotaExceededError");
    return recordKey === undefined
      ? original.call(this, value)
      : original.call(this, value, recordKey);
  };
  try {
    await assert.rejects(
      commitWorkspace(key, base, proposal),
      /Storage is full/,
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.equal((await loadWorkspace(key)).data.practicePlans, undefined);
  const retried = await commitWorkspace(key, base, proposal),
    twice = await commitWorkspace(key, retried.record, proposal);
  const restored = await loadWorkspace(key);
  assert.deepEqual(twice.conflicts, []);
  assert.equal(restored.data.practicePlans!.length, 1);
  assert.deepEqual(
    currentPracticePlan(restored.data, now)!.items.map((item) => item.id),
    ids,
  );
  assert.deepEqual(decodeBackup(encodeBackup(restored.data)), proposal);
});
test("two tabs creating equivalent first plans converge without duplicate IDs or spurious date conflicts", () => {
  const base = source(),
    first = reconcilePracticePlan(base, now),
    second = reconcilePracticePlan(base, new Date(now.getTime() + 1000));
  const result = mergeWorkspaces(base, first, second);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.data.practicePlans!.length, 1);
  assert.deepEqual(
    currentPracticePlan(result.data, now),
    currentPracticePlan(first, now),
  );
});
test("different simultaneous plan choices remain explicit recoverable conflicts rather than silent overwrites", async () => {
  const key = "account:plan-conflict",
    base = await loadWorkspace(key, source());
  const first = setPlanAvailability(base.data, 15, now),
    second = setPlanAvailability(base.data, 60, now);
  await commitWorkspace(key, base, first);
  const result = await commitWorkspace(key, base, second);
  assert.ok(result.conflicts.length > 0);
  assert.equal(currentPracticePlan(result.record.data, now)!.budgetMinutes, 15);
  assert.ok(
    (await recoveriesFor(key)).some(
      (copy) => currentPracticePlan(copy.data, now)!.budgetMinutes === 60,
    ),
  );
});
test("plans and preferences remain isolated across account keys and old backups retain optional compatibility", async () => {
  const firstKey = "account:plan-isolation-a",
    secondKey = "account:plan-isolation-b";
  const first = await loadWorkspace(firstKey, source()),
    second = await loadWorkspace(secondKey);
  const selected = reconcilePracticePlan(
    setPracticePreferences(first.data, {
      dailyMinutes: 15,
      preferredDays: [1, 3, 4],
      mode: "track",
      targetDate: "2027-03-01",
    }),
    now,
  );
  await commitWorkspace(firstKey, first, selected);
  assert.equal((await loadWorkspace(secondKey)).data.practicePlans, undefined);
  assert.equal(
    (await loadWorkspace(secondKey)).data.settings.practicePreferences,
    undefined,
  );
  assert.equal((await loadWorkspace(firstKey)).data.practicePlans!.length, 1);
  assert.deepEqual(decodeBackup(encodeBackup(second.data)), emptyData());
});
test("a concurrent actual reflection and preference edit merge then reconcile one genuine completion", () => {
  const base = reconcilePracticePlan(source(), now);
  const local = setPracticePreferences(base, {
    dailyMinutes: 45,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  });
  const remote = {
    ...base,
    attempts: [
      {
        id: "remote-session",
        problemId: "a",
        startedAt: now.toISOString(),
        completedAt: after.toISOString(),
        elapsedMs: 600000,
        outcome: "unsolved" as const,
        difficulty: null,
        notes: "Saved in another tab.",
        takeaway: "Practised without solving.",
      },
    ],
  };
  const result = mergeWorkspaces(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  const reconciled = reconcilePracticePlan(result.data, after);
  assert.equal(practicePlanView(reconciled, after).completed.length, 1);
  assert.equal(
    practicePlanView(reconciled, after).completed[0].completion!.recordId,
    "remote-session",
  );
  assert.equal(reconciled.attempts.length, 1);
  assert.equal(reconciled.settings.practicePreferences!.dailyMinutes, 45);
  assert.deepEqual(decodeBackup(encodeBackup(reconciled)), reconciled);
});
