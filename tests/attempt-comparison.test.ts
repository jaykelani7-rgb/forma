import assert from "node:assert/strict";
import test from "node:test";
import { attemptComparisonChoices, compareAttempts } from "../src/lib/attempt-comparison";
import type { LearningRecord } from "../src/lib/learning";
import type { Problem } from "../src/lib/model";

const problem: Problem = {
  id: "personal", title: "The same problem", platform: "Codeforces",
  url: "https://codeforces.com/contest/4/problem/A", problemCode: "4A", tags: [], rating: null,
  createdAt: "2026-11-01T10:00:00Z", reviewAt: null, reviewCount: 0,
};
const problems = new Map([
  [problem.id, problem],
  ["imported", { ...problem, id: "imported", cfHandle: "Active" }],
  ["gym", { ...problem, id: "gym", url: "https://codeforces.com/gym/4/problem/A" }],
]);

function attempt(id: string, day: number, changes: Partial<LearningRecord> = {}): LearningRecord {
  const completedAt = `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`;
  return {
    id, source: "timed", problemId: problem.id, problemIds: [problem.id], handle: null,
    learningKey: "notebook:contest:4:A", completedAt, reflectedAt: completedAt, outcome: "independent",
    difficulty: null, takeaway: "", notes: "", elapsedMs: 60_000, timedAttemptId: id,
    importedAttemptId: null, submissionIds: [], accepted: null, reflectionPending: false,
    reflectionSource: "timed", ...changes,
  };
}

test("comparison choices stay with the canonical problem and selected profile and prefer earlier written reflections", () => {
  const selected = attempt("now", 5, { handle: "active" });
  const hint = attempt("hint", 3, { outcome: "hint", handle: "ACTIVE", problemId: "imported" });
  const pending = attempt("pending", 4, { outcome: null, reflectedAt: null, reflectionPending: true });
  const later = attempt("later", 6);
  const equal = attempt("simultaneous", 5);
  const old = attempt("other-profile", 2, { handle: "archived" });
  const gym = attempt("other-namespace", 2, { problemId: "gym" });
  const duplicate = attempt("linked-copy", 3, { timedAttemptId: selected.timedAttemptId });
  const history = [later, pending, hint, selected, equal, old, gym, duplicate, hint];
  assert.deepEqual(attemptComparisonChoices(selected, history, problems), [hint, pending, later]);
  assert.deepEqual(attemptComparisonChoices(hint, [selected, pending, later], problems), [selected, later, pending]);
  assert.deepEqual(compareAttempts(selected, hint), {
    then: hint, now: selected, change: "Your earlier attempt used a hint. You marked the later attempt solved independently.",
  });
  assert.equal(compareAttempts(pending, selected)?.change, null);
  assert.equal(compareAttempts(selected, equal), null);
});

test("shared source evidence is never compared with itself, while distinct contest evidence can be", () => {
  const first = attempt("import", 3, {
    source: "codeforces", handle: "active", timedAttemptId: null, importedAttemptId: "import-id",
    submissionIds: [1], outcome: "editorial",
  });
  const linked = attempt("linked", 5, { handle: "active", importedAttemptId: "import-id", source: "linked" });
  assert.equal(compareAttempts(first, linked), null);
  const contest = attempt("contest", 4, {
    source: "contest", handle: "active", timedAttemptId: null, importedAttemptId: "import-id",
    submissionIds: [2], outcome: "independent",
  });
  assert.match(compareAttempts(first, contest)?.change ?? "", /earlier attempt used the editorial/);
  assert.equal(compareAttempts(first, { ...contest, submissionIds: [1, 2] }), null);
});
