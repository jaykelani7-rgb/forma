import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData } from "../src/lib/model";
import {
  encodeBackup,
  decodeBackup,
  mergeWorkspaces,
} from "../src/lib/concurrency";
import {
  commitWorkspace,
  loadWorkspace,
  recoveriesFor,
  STORAGE_KEYS,
} from "../src/lib/storage";
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (key: string) => values.get(key) ?? null },
});
const problem = (id: string) => ({
  id,
  title: id,
  platform: "Codeforces",
  url: "",
  problemCode: "",
  tags: [],
  rating: null,
  createdAt: "2026-10-04T00:00:00.000Z",
  reviewAt: null,
  reviewCount: 0,
});
test("two stale tabs merge adding a problem and saving preferences transactionally", async () => {
  const a = await loadWorkspace("personal");
  const b = await loadWorkspace("personal");
  await commitWorkspace("personal", a, { ...a.data, problems: [problem("A")] });
  const result = await commitWorkspace("personal", b, {
    ...b.data,
    settings: { ...b.data.settings, weeklyGoal: 7 },
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.record.data.problems[0].id, "A");
  assert.equal(result.record.data.settings.weeklyGoal, 7);
  assert.equal(result.record.revision, 3);
});
test("conflicting session notes keep newer state and recoverable losing copy", async () => {
  const data = {
    ...emptyData(),
    problems: [problem("notes")],
    session: {
      id: "session",
      problemId: "notes",
      startedAt: "2026-10-04T00:00:00.000Z",
      runningSince: null,
      elapsedMs: 0,
      targetMinutes: 30 as const,
      notes: "base",
      timerVisible: true,
      phase: "focus" as const,
    },
  };
  const base = await loadWorkspace("demo", data);
  await commitWorkspace("demo", base, {
    ...base.data,
    session: { ...data.session, notes: "tab A" },
  });
  const result = await commitWorkspace("demo", base, {
    ...base.data,
    session: { ...data.session, notes: "tab B" },
  });
  assert.ok(result.conflicts.includes("workspace.session.notes"));
  assert.equal(result.record.data.session?.notes, "tab A");
  assert.equal((await recoveriesFor("demo"))[0].data.session?.notes, "tab B");
});
test("legacy migration keeps original source until and after commit", async () => {
  const legacy = JSON.stringify(emptyData());
  values.set(STORAGE_KEYS.personal, legacy);
  await loadWorkspace("personal");
  assert.equal(values.get(STORAGE_KEYS.personal), legacy);
});
test("large realistic notes produce restorable backups beyond old 5 MB limit", () => {
  const data = emptyData();
  data.problems = [problem("large")];
  data.attempts = Array.from({ length: 140 }, (_, i) => ({
    id: `a${i}`,
    problemId: "large",
    startedAt: "2026-10-04T00:00:00.000Z",
    completedAt: "2026-10-04T00:01:00.000Z",
    elapsedMs: 60000,
    outcome: "hint",
    difficulty: "coding",
    takeaway: "",
    notes: "x".repeat(50000),
  }));
  const backup = encodeBackup(data);
  assert.ok(backup.length > 5 * 1024 * 1024);
  assert.deepEqual(decodeBackup(backup), data);
});
test("concurrent deletion and edit produce explicit conflict, not broken references", () => {
  const base = { ...emptyData(), problems: [problem("p")] };
  const result = mergeWorkspaces(
    base,
    { ...base, problems: [] },
    { ...base, problems: [{ ...problem("p"), title: "edited" }] },
  );
  assert.ok(result.conflicts.length);
  assert.equal(result.data.problems[0].title, "edited");
});

test("confirmed restoration can create a workspace after its initial migration failed", async () => {
  const key = "account:restore-new";
  const baseline = {
    key,
    revision: 0,
    data: emptyData(),
    savedAt: "2026-10-04T00:00:00.000Z",
  } as const;
  const restored = { ...emptyData(), problems: [problem("preserved-backup")] };
  const result = await commitWorkspace(key, baseline, restored, true);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.record.revision, 1);
  assert.deepEqual((await loadWorkspace(key)).data, restored);
});

test("restoration with no known baseline cannot overwrite an existing workspace", async () => {
  const key = "account:restore-existing";
  const baseline = {
    key,
    revision: 0,
    data: emptyData(),
    savedAt: "2026-10-04T00:00:00.000Z",
  } as const;
  const original = { ...emptyData(), problems: [problem("newer-record")] };
  await commitWorkspace(key, baseline, original, true);
  const proposed = { ...emptyData(), problems: [problem("proposed-backup")] };
  const result = await commitWorkspace(key, baseline, proposed, true);
  assert.ok(result.conflicts.length);
  assert.deepEqual((await loadWorkspace(key)).data, original);
  assert.ok(
    (await recoveriesFor(key)).some(
      (copy) => copy.data.problems[0]?.id === "proposed-backup",
    ),
  );
});
