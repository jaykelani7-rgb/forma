import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData, type Problem } from "../src/lib/model";
import {
  createContest,
  startContest,
  editContest,
} from "../src/lib/contest-lab";
import {
  loadWorkspace,
  commitWorkspace,
  recoveriesFor,
} from "../src/lib/storage";
const p: Problem = {
  id: "p",
  title: "Personal problem",
  platform: "LeetCode",
  url: "",
  problemCode: "",
  rating: null,
  tags: [],
  createdAt: "2026-10-08T00:00:00Z",
  reviewAt: null,
  reviewCount: 0,
};
const now = new Date("2026-10-08T00:00:00Z");
function fixture() {
  return createContest(
    { ...emptyData(), problems: [p] },
    "contest",
    "Private contest",
    30,
    [p],
    false,
    "manual",
    now,
  );
}
test("contest records, drafts and recovery copies use isolated account caches and real atomic storage", async () => {
  const a = await loadWorkspace("account:contest-a", fixture());
  const b = await loadWorkspace("account:contest-b", emptyData());
  const started = startContest(a.data, "contest", now);
  const saved = await commitWorkspace("account:contest-a", a, started);
  assert.equal(saved.conflicts.length, 0);
  assert.equal(
    (await loadWorkspace("account:contest-b")).data.contests?.length ?? 0,
    0,
  );
  assert.equal(b.data.problems.length, 0);
  const base = saved.record;
  const note = (value: string) =>
    editContest(base.data, "contest", (c) => ({
      ...c,
      problems: c.problems.map((p) => ({ ...p, notes: value })),
    }));
  await commitWorkspace("account:contest-a", base, note("First tab"));
  const conflict = await commitWorkspace(
    "account:contest-a",
    base,
    note("Second tab"),
  );
  assert.ok(conflict.conflicts.length);
  assert.equal(
    conflict.record.data.contests![0].problems[0].notes,
    "First tab",
  );
  const copies = await recoveriesFor("account:contest-a");
  assert.equal(copies[0].data.contests![0].problems[0].notes, "Second tab");
  assert.equal((await recoveriesFor("account:contest-b")).length, 0);
});
