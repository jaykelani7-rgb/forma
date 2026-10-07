import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData, type Problem } from "../src/lib/model";
import { withPracticeSession } from "../src/lib/practice-session";
import {
  commitWorkspace,
  loadWorkspace,
  openDatabase,
  recoveriesFor,
} from "../src/lib/storage";

Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null },
});
const now = Date.parse("2026-10-07T06:00:00Z");
const problem: Problem = {
  id: "fresh-practice-fixture",
  title: "Fresh practice fixture",
  platform: "Codeforces",
  url: "https://codeforces.com/problemset/problem/6001/A",
  problemCode: "6001A",
  tags: [],
  rating: 1200,
  createdAt: new Date(now).toISOString(),
  reviewAt: null,
  reviewCount: 0,
};

test("fresh practice durably creates the problem and session in one revision", async () => {
  const key = "account:atomic-fresh";
  const base = await loadWorkspace(key);
  const result = await commitWorkspace(
    key,
    base,
    withPracticeSession(base.data, problem, 30, now, "fresh-session", true),
  );
  assert.deepEqual(result.conflicts, []);
  const durable = await loadWorkspace(key);
  assert.equal(durable.revision, base.revision + 1);
  assert.equal(durable.data.problems.length, 1);
  assert.equal(durable.data.session?.problemId, durable.data.problems[0].id);
  assert.throws(
    () =>
      withPracticeSession(durable.data, problem, 30, now, "duplicate", true),
    /already open/,
  );
});

test("an aborted fresh-practice transaction leaves neither a problem nor an orphan session", async () => {
  const key = "account:atomic-abort";
  const base = await loadWorkspace(key);
  const proposed = withPracticeSession(
    base.data,
    problem,
    30,
    now,
    "abort-session",
    true,
  );
  const db = await openDatabase();
  const transaction = db.transaction.bind(db);
  db.transaction = ((
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
  }) as typeof db.transaction;
  try {
    await assert.rejects(commitWorkspace(key, base, proposed));
  } finally {
    db.transaction = transaction;
  }
  const durable = await loadWorkspace(key);
  assert.equal(durable.revision, base.revision);
  assert.equal(durable.data.problems.length, 0);
  assert.equal(durable.data.session, null);
  assert.equal(proposed.session?.problemId, proposed.problems[0].id);
});

test("conflicting fresh sessions preserve the committed pair and recover the entire losing pair", async () => {
  const key = "account:atomic-conflict";
  const base = await loadWorkspace(key);
  const other = { ...problem, id: "other-fresh-fixture" };
  await commitWorkspace(
    key,
    base,
    withPracticeSession(base.data, other, 30, now, "other-session", true),
  );
  const proposed = withPracticeSession(
    base.data,
    problem,
    60,
    now,
    "proposed-session",
    true,
  );
  const result = await commitWorkspace(key, base, proposed);
  assert.ok(result.conflicts.length);
  const durable = (await loadWorkspace(key)).data;
  assert.equal(durable.problems.length, 1);
  assert.equal(durable.session?.problemId, other.id);
  const recovered = (await recoveriesFor(key))[0].data;
  assert.equal(recovered.session?.problemId, problem.id);
  assert.equal(recovered.problems[0].id, problem.id);
});

test("regular practice requires a saved problem and keeps existing problem details", () => {
  const data = emptyData();
  assert.throws(
    () => withPracticeSession(data, problem, 30, now, "missing"),
    /has not been saved/,
  );
  const saved = { ...problem, title: "My existing title" };
  const next = withPracticeSession(
    { ...data, problems: [saved] },
    problem,
    30,
    now,
    "existing",
    true,
  );
  assert.deepEqual(next.problems, [saved]);
  assert.equal(next.session?.problemId, saved.id);
});
