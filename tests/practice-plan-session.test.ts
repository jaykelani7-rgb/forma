import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  emptyData,
  localDate,
  validateData,
  type Data,
} from "../src/lib/model";
import {
  reconcilePracticePlan,
  currentPracticePlan,
} from "../src/lib/practice-plan";
import { withPlannedPracticeSession } from "../src/lib/practice-plan-session";
import {
  commitWorkspace,
  loadWorkspace,
  openDatabase,
} from "../src/lib/storage";

Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null },
});
const now = new Date("2026-10-08T12:00:00Z");
function fixture(): Data {
  const data = emptyData();
  data.settings.practicePreferences = {
    dailyMinutes: 7,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  };
  data.problems = [
    {
      id: "planned-problem",
      title: "A short deliberate attempt",
      platform: "Codeforces",
      url: "https://codeforces.com/problemset/problem/4/A",
      problemCode: "4A",
      tags: [],
      rating: 800,
      createdAt: now.toISOString(),
      reviewAt: localDate(now),
      reviewCount: 1,
    },
  ];
  return reconcilePracticePlan(data, now);
}

test("short planned coding binds one real session and does not fabricate completion", () => {
  const data = fixture(),
    plan = currentPracticePlan(data, now)!;
  const next = withPlannedPracticeSession(
    data,
    plan.items[0].id,
    now.getTime(),
    "seven-minute-session",
  );
  assert.equal(next.session!.targetMinutes, 7);
  assert.equal(next.practicePlans!.length, 1);
  assert.equal(
    currentPracticePlan(next, now)!.items[0].sessionId,
    next.session!.id,
  );
  assert.equal(currentPracticePlan(next, now)!.items[0].status, "pending");
  assert.deepEqual(next.attempts, []);
  assert.deepEqual(next.revisions, []);
  assert.deepEqual(validateData(next), next);
  assert.throws(
    () =>
      withPlannedPracticeSession(
        next,
        plan.items[0].id,
        now.getTime(),
        "duplicate",
      ),
    /already open/,
  );
});

test("changed schedules reject stale planned starts without changing the original plan or history", () => {
  const data = fixture(),
    item = currentPracticePlan(data, now)!.items[0];
  const changed = {
    ...data,
    problems: data.problems.map((problem) => ({
      ...problem,
      reviewAt: "2026-10-10",
    })),
  };
  const before = JSON.stringify(changed);
  assert.throws(
    () => withPlannedPracticeSession(changed, item.id, now.getTime(), "stale"),
    /activity changed/,
  );
  assert.equal(JSON.stringify(changed), before);
  assert.equal(changed.session, null);
});

test("an aborted planned-start transaction retains its exact retry proposal and never duplicates the day plan", async () => {
  const key = "account:planned-session-abort";
  let base = await loadWorkspace(key);
  await commitWorkspace(key, base, fixture());
  base = await loadWorkspace(key);
  const item = currentPracticePlan(base.data, now)!.items[0];
  const proposed = withPlannedPracticeSession(
    base.data,
    item.id,
    now.getTime(),
    "retry-same-session",
  );
  const database = await openDatabase();
  const transaction = database.transaction.bind(database);
  database.transaction = ((
    names: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ) => {
    const tx = transaction(names, mode, options);
    if (
      mode === "readwrite" &&
      Array.isArray(names) &&
      names.includes("recoveries")
    )
      queueMicrotask(() => tx.abort());
    return tx;
  }) as typeof database.transaction;
  try {
    await assert.rejects(commitWorkspace(key, base, proposed));
  } finally {
    database.transaction = transaction;
  }
  const untouched = await loadWorkspace(key);
  assert.equal(untouched.revision, base.revision);
  assert.equal(untouched.data.session, null);
  assert.equal(untouched.data.practicePlans!.length, 1);
  assert.equal(
    currentPracticePlan(untouched.data, now)!.items[0].sessionId,
    undefined,
  );
  await commitWorkspace(key, base, proposed);
  const restored = (await loadWorkspace(key)).data;
  assert.equal(restored.session!.id, "retry-same-session");
  assert.equal(restored.practicePlans!.length, 1);
  assert.equal(
    currentPracticePlan(restored, now)!.items[0].sessionId,
    restored.session!.id,
  );
  assert.deepEqual(restored.attempts, []);
  assert.deepEqual(restored.revisions, []);
});
