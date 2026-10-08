import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  validateData,
  type Data,
  type Problem,
  type Attempt,
} from "../src/lib/model";
import {
  type PracticeContest,
  createContest,
  reviseContestSetup,
  startContest,
  endContest,
  reconcileContests,
  contestEvidence,
  generateContestProblems,
  queueUpsolve,
  eligibleUpsolves,
  editContest,
} from "../src/lib/contest-lab";
import { connectProfile, mergeActivity } from "../src/lib/codeforces";
import { withPracticeSession } from "../src/lib/practice-session";
import {
  practiceCandidates,
  reconcilePracticePlan,
} from "../src/lib/practice-plan";
import {
  encodeBackup,
  decodeBackup,
  mergeWorkspaces,
} from "../src/lib/concurrency";
import { assertSafeProblemEdit } from "../src/lib/workspace-proposal";
import type { SubmissionInput } from "../src/lib/codeforces-types";
const now = new Date("2026-10-08T06:30:00Z");
const after = (ms: number) => new Date(now.getTime() + ms);
const p = (id = "p", code = "4A"): Problem => ({
  id,
  title: `Problem ${code}`,
  platform: "Codeforces",
  url: `https://codeforces.com/problemset/problem/${code.slice(0, -1)}/${code.slice(-1)}`,
  problemCode: code,
  tags: ["SECRET"],
  rating: 1200,
  createdAt: now.toISOString(),
  reviewAt: null,
  reviewCount: 0,
});
function fixture(profile = true) {
  let d: Data = { ...emptyData(), problems: [p()] };
  if (profile)
    d = connectProfile(
      d,
      { handle: "fixture_user", rating: 1400, rank: "specialist" },
      now,
    );
  return createContest(
    d,
    "contest",
    "Boundary contest",
    30,
    [d.problems[0]],
    false,
    "manual",
    now,
  );
}
function submission(
  id: number,
  ms: number,
  verdict: string | null = "OK",
  code = "4A",
): SubmissionInput {
  return {
    id,
    submittedAt: after(ms).toISOString(),
    verdict,
    language: "GNU C++20",
    problem: {
      key: `contest:${code.slice(0, -1)}:${code.slice(-1)}`,
      title: `Problem ${code}`,
      code,
      url: p("x", code).url,
      rating: 1200,
      tags: ["SECRET"],
    },
  };
}
function sync(
  d: Data,
  values: SubmissionInput[],
  at = after(1200000),
  handle = "fixture_user",
) {
  return reconcileContests(
    mergeActivity(
      d,
      handle,
      [{ handle, from: 1, count: 50, submissions: values }],
      "refresh",
      at,
    ),
    at,
  );
}
function finished() {
  return endContest(
    startContest(fixture(), "contest", now),
    "contest",
    "early",
    after(600000),
  );
}
function reflected(d = finished()) {
  return editContest(d, "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({
      ...p,
      reflection: {
        outcome: "hint",
        difficulty: "edges",
        takeaway: "Keep the right endpoint.",
        approach: "Two pointers",
        mistakes: ["edges"],
        savedAt: after(660000).toISOString(),
      },
    })),
  }));
}
function queued(d = reflected()) {
  return queueUpsolve(d, "contest", "contest:0", "high", null, after(700000));
}
test("legacy backups remain valid and contest snapshots round-trip without invented practice credit", () => {
  assert.equal(validateData(emptyData()).contests, undefined);
  const d = fixture();
  assert.deepEqual(decodeBackup(encodeBackup(d)).contests, d.contests);
  assert.equal(d.attempts.length, 0);
  assert.equal(d.session, null);
  assert.equal(
    createContest(d, "contest", "other", 60, [p()], true, "manual"),
    d,
  );
});
test("start locks deadline and refuses regular-session or other-contest overlap", () => {
  const d = startContest(fixture(), "contest", now);
  assert.equal(d.contests![0].deadline, after(1800000).toISOString());
  assert.throws(() => startContest(d, "contest", now));
  assert.throws(() =>
    withPracticeSession(d, p(), 30, now.getTime(), "session"),
  );
  const regular = withPracticeSession(
    fixture(),
    p(),
    30,
    now.getTime(),
    "session",
  );
  assert.throws(() => startContest(regular, "contest", now));
  assert.throws(() => validateData({ ...d, session: regular.session }));
});
test("expiration is derived from persisted wall time, idempotent after reload, and never creates per-problem time", () => {
  const d = startContest(fixture(), "contest", now);
  const expired = reconcileContests(
    decodeBackup(encodeBackup(d)),
    after(3600000),
  );
  assert.equal(expired.contests![0].endReason, "expired");
  assert.equal(expired.contests![0].endedAt, after(1800000).toISOString());
  assert.equal(reconcileContests(expired, after(3600001)), expired);
  assert.equal(expired.attempts.length, 0);
  assert.equal("elapsedMs" in expired.contests![0].problems[0], false);
});
test("early finish and abandonment retain separate reasons and freeze original window", () => {
  for (const reason of ["early", "abandoned"] as const) {
    const d = endContest(
      startContest(fixture(), "contest", now),
      "contest",
      reason,
      after(600000),
    );
    assert.equal(d.contests![0].endReason, reason);
    assert.equal(
      d.contests![0].state,
      reason === "early" ? "finished" : "abandoned",
    );
    assert.equal(
      endContest(d, "contest", reason, after(900000)).contests![0].endedAt,
      after(600000).toISOString(),
    );
    validateData(d);
  }
});
test("late import matches actual submission time, canonical aliases, and captured handle only", () => {
  let d = finished();
  d = sync(d, [
    submission(1, -1000),
    submission(2, 300000),
    submission(3, 600001),
    submission(4, 300000, "OK", "5A"),
  ]);
  const c = d.contests![0];
  assert.deepEqual(
    contestEvidence(d, c, c.problems[0]).map((s) => s.id),
    [2],
  );
  assert.equal(d.attempts.length, 0);
  validateData(d);
  const switched = connectProfile(
    d,
    { handle: "other_user", rating: null, rank: null },
    after(1300000),
  );
  assert.deepEqual(
    contestEvidence(switched, c, c.problems[0]).map((s) => s.id),
    [2],
  );
  assert.throws(() =>
    startContest(
      connectProfile(
        fixture(),
        { handle: "other_user", rating: null, rank: null },
        now,
      ),
      "contest",
      now,
    ),
  );
});
test("pending, duplicate and rejudged submissions update evidence but never overwrite reflections", () => {
  let d = sync(reflected(), [submission(2, 300000, null)]);
  d = sync(d, [submission(2, 300000, "OK")]);
  assert.equal(d.contests![0].problems[0].evidence[0].verdict, "OK");
  assert.equal(d.contests![0].problems[0].reflection!.outcome, "hint");
  const changes = d.contests![0].problems[0].evidenceChanges.length;
  d = sync(d, [submission(2, 300000, "OK")]);
  assert.equal(d.contests![0].problems[0].evidenceChanges.length, changes);
  d = sync(d, [submission(2, 300000, "WRONG_ANSWER")]);
  assert.equal(d.contests![0].problems[0].evidence[0].verdict, "WRONG_ANSWER");
  validateData(d);
});
test("generator is deterministic, deduplicates canonical identity, and never silently relaxes filters", () => {
  const d = fixture(),
    catalogue = [
      {
        key: "contest:4:A",
        title: "A",
        code: "4A",
        url: p().url,
        rating: 1200,
        tags: [],
      },
      {
        key: "contest:5:A",
        title: "B",
        code: "5A",
        url: p("x", "5A").url,
        rating: null,
        tags: [],
      },
      {
        key: "duplicate",
        title: "Duplicate",
        code: "4A",
        url: p().url,
        rating: 1200,
        tags: [],
      },
    ];
  assert.deepEqual(
    generateContestProblems(
      d,
      [...catalogue].reverse(),
      1,
      null,
      null,
      false,
      false,
    ).map((v) => v.code),
    ["4A"],
  );
  assert.throws(
    () => generateContestProblems(d, catalogue, 2, 800, 1400, false, false),
    /Only 1/,
  );
  assert.throws(
    () => generateContestProblems(d, catalogue, 3, null, null, false, false),
    /Only 2/,
  );
  const accepted = sync(finished(), [submission(2, 300000)]);
  assert.deepEqual(
    generateContestProblems(
      accepted,
      catalogue,
      1,
      null,
      null,
      true,
      false,
    ).map((v) => v.code),
    ["5A"],
  );
});
test("generator scopes accepted exclusions to current profile and practiced contest statuses", () => {
  const d = sync(finished(), [submission(2, 300000)]),
    catalogue = [
      {
        key: "contest:4:A",
        title: "A",
        code: "4A",
        url: p().url,
        rating: 1200,
        tags: [],
      },
    ];
  assert.throws(
    () => generateContestProblems(d, catalogue, 1, null, null, true, false),
    /Only 0/,
  );
  const switched = connectProfile(
    d,
    { handle: "other_user", rating: null, rank: null },
    after(1300000),
  );
  assert.equal(
    generateContestProblems(switched, catalogue, 1, null, null, true, true)
      .length,
    1,
  );
  const worked = editContest(finished(), "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({ ...p, status: "working" })),
  }));
  assert.throws(
    () =>
      generateContestProblems(worked, catalogue, 1, null, null, false, true),
    /Only 0/,
  );
});
test("queue addition keeps coding and recall schedules independent and respects all eligibility exclusions", () => {
  const base = queued();
  assert.equal(base.problems[0].reviewAt, null);
  assert.equal(eligibleUpsolves(base, after(800000)).length, 1);
  for (const extra of [
    { reviewAt: "2026-10-20" },
    { archived: true },
    { deferredUntil: "2026-10-20" },
    { skippedOn: "2026-10-08" },
  ]) {
    const d = {
      ...base,
      problems: base.problems.map((p) => ({ ...p, ...extra })),
    };
    assert.equal(eligibleUpsolves(d, after(800000)).length, 0);
    assert.equal(
      practiceCandidates(d, after(800000)).some((c) =>
        c.key.startsWith("upsolve:"),
      ),
      false,
    );
  }
  assert.equal(
    eligibleUpsolves(
      queueUpsolve(
        base,
        "contest",
        "contest:0",
        "high",
        "2026-10-20",
        after(800000),
      ),
      after(900000),
    ).length,
    0,
  );
});
test("planner explains eligible upsolve and real later practice completes queue without rewriting original result", () => {
  let d = queued();
  const candidate = practiceCandidates(d, after(800000)).find((c) =>
    c.key.startsWith("upsolve:"),
  );
  assert.match(candidate!.reason, /Boundary contest/);
  d = withPracticeSession(d, p(), 30, after(800000).getTime(), "later-session");
  assert.equal(d.contests![0].problems[0].upsolve!.sessionId, "later-session");
  assert.equal(d.contests![0].problems[0].upsolve!.completionId, undefined);
  const a: Attempt = {
    id: "later-session",
    problemId: "p",
    startedAt: after(800000).toISOString(),
    completedAt: after(900000).toISOString(),
    elapsedMs: 100000,
    outcome: "independent",
    difficulty: null,
    notes: "Later notes",
    takeaway: "Now independent",
  };
  d = reconcileContests({ ...d, session: null, attempts: [a] }, after(900000));
  assert.equal(d.contests![0].problems[0].upsolve!.completionId, a.id);
  assert.equal(d.contests![0].problems[0].reflection!.outcome, "hint");
  assert.equal(d.contests![0].endedAt, after(600000).toISOString());
  assert.equal(eligibleUpsolves(d, after(900000)).length, 0);
  validateData(reconcilePracticePlan(d, after(900000)));
});
test("administrative removal never fabricates completion and profile switches hide queue candidates", () => {
  const d = queued();
  const removed = editContest(d, "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({
      ...p,
      upsolve: {
        ...p.upsolve!,
        state: "removed",
        removedAt: after(900000).toISOString(),
      },
    })),
  }));
  assert.equal(eligibleUpsolves(removed, after(900000)).length, 0);
  assert.equal(removed.attempts.length, 0);
  const switched = connectProfile(
    d,
    { handle: "other_user", rating: null, rank: null },
    after(900000),
  );
  assert.equal(eligibleUpsolves(switched, after(900000)).length, 0);
});
test("malformed contest data is rejected before exposure, including forged acceptance and completion", () => {
  const d = queued();
  for (const mutate of [
    (c: PracticeContest) => {
      c.durationMinutes = 0;
    },
    (c: PracticeContest) => {
      c.problems.push(c.problems[0]);
    },
    (c: PracticeContest) => {
      c.problems[0].snapshot.url = "javascript:alert(1)";
    },
    (c: PracticeContest) => {
      c.problems[0].upsolve!.completionId = "nonexistent";
    },
    (c: PracticeContest) => {
      c.problems[0].evidence = [
        { id: 99, submittedAt: after(300000).toISOString(), verdict: "OK" },
      ];
    },
  ]) {
    const bad = structuredClone(d);
    mutate(bad.contests![0]);
    assert.throws(() => validateData(bad));
  }
});
test("competing tabs cannot merge two active contests or overlap measured regular practice", () => {
  const base = fixture(),
    first = startContest(base, "contest", now);
  const other = createContest(
      base,
      "other",
      "Other",
      30,
      [p()],
      false,
      "manual",
      now,
    ),
    second = startContest(other, "other", now);
  const merged = mergeWorkspaces(base, first, second);
  assert.ok(merged.conflicts.length);
  assert.deepEqual(merged.data, validateData(second));
  const regular = withPracticeSession(base, p(), 30, now.getTime(), "regular");
  assert.ok(mergeWorkspaces(base, first, regular).conflicts.length);
});
test("disjoint notes merge, competing same-note edits retain recovery conflict", () => {
  const base = startContest(fixture(), "contest", now);
  const set = (d: Data, n: string) =>
    editContest(d, "contest", (c) => ({
      ...c,
      problems: c.problems.map((p) => ({ ...p, notes: n })),
    }));
  assert.ok(
    mergeWorkspaces(base, set(base, "Left"), set(base, "Right")).conflicts
      .length,
  );
  const status = editContest(base, "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({ ...p, status: "working" })),
  }));
  const merged = mergeWorkspaces(base, set(base, "Left"), status);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.data.contests![0].problems[0].notes, "Left");
  assert.equal(merged.data.contests![0].problems[0].status, "working");
});
test("contest references protect identity while historical metadata remains snapshotted", () => {
  const d = fixture();
  assert.throws(() =>
    assertSafeProblemEdit(d, d.problems[0], {
      ...p(),
      url: p("x", "5A").url,
      problemCode: "5A",
    }),
  );
  const renamed = { ...p(), title: "Renamed", tags: ["new"] };
  assertSafeProblemEdit(d, d.problems[0], renamed);
  assert.equal(
    validateData({ ...d, problems: [renamed] }).contests![0].problems[0]
      .snapshot.title,
    "Problem 4A",
  );
});

test("unfinished later practice stays in queue; saved review drafts are separate from reflections", () => {
  let d = queued();
  d = withPracticeSession(
    d,
    p(),
    30,
    after(800000).getTime(),
    "unfinished-session",
  );
  const attempt: Attempt = {
    id: "unfinished-session",
    problemId: "p",
    startedAt: after(800000).toISOString(),
    completedAt: after(900000).toISOString(),
    elapsedMs: 100000,
    outcome: "unsolved",
    difficulty: "approach",
    notes: "Still working",
    takeaway: "Try again",
  };
  d = reconcileContests(
    { ...d, session: null, attempts: [attempt] },
    after(900000),
  );
  assert.equal(d.contests![0].problems[0].upsolve!.completionId, undefined);
  assert.equal(eligibleUpsolves(d, after(900000)).length, 1);
  d = editContest(d, "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({
      ...p,
      reflectionDraft: { ...p.reflection!, takeaway: "Unconfirmed draft" },
    })),
  }));
  const restored = decodeBackup(encodeBackup(d));
  assert.equal(
    restored.contests![0].problems[0].reflectionDraft!.takeaway,
    "Unconfirmed draft",
  );
  assert.equal(
    restored.contests![0].problems[0].reflection!.takeaway,
    "Keep the right endpoint.",
  );
});
test("a deliberately future upsolve cannot sneak into Today as a generic collection choice", () => {
  const d = queueUpsolve(
    queued(),
    "contest",
    "contest:0",
    "high",
    "2026-10-20",
    after(800000),
  );
  assert.equal(
    practiceCandidates(d, after(900000)).filter(
      (c) => c.activity === "coding" && c.identity === "contest:4:A",
    ).length,
    0,
  );
});

test("setup can be revised before start and stays locked afterwards", () => {
  const d = reviseContestSetup(
    fixture(),
    "contest",
    "Revised",
    45,
    [p()],
    true,
    "manual",
    after(1000),
  );
  assert.equal(d.contests![0].durationMinutes, 45);
  assert.equal(d.contests![0].createdAt, now.toISOString());
  assert.throws(() =>
    reviseContestSetup(
      startContest(d, "contest", after(2000)),
      "contest",
      "Changed",
      60,
      [p()],
      false,
      "manual",
      after(3000),
    ),
  );
});
test("late pre-start edits in another tab cannot silently replace a running contest set", () => {
  const base = fixture(),
    started = startContest(base, "contest", now),
    revised = reviseContestSetup(
      base,
      "contest",
      "New set",
      30,
      [p("second", "5A")],
      false,
      "manual",
      after(1000),
    );
  for (const [local, remote] of [
    [started, revised],
    [revised, started],
  ]) {
    const merged = mergeWorkspaces(base, local, remote);
    assert.ok(merged.conflicts.some((c) => c.includes("locked setup")));
    assert.deepEqual(merged.data.contests, validateData(remote).contests);
  }
});
test("domain mutations cannot alter locked set, duration, or reveal policy after start", () => {
  const d = startContest(fixture(), "contest", now);
  assert.throws(
    () => editContest(d, "contest", (c) => ({ ...c, revealHints: true })),
    /locked/,
  );
  assert.throws(
    () =>
      editContest(d, "contest", (c) => ({
        ...c,
        durationMinutes: 45,
        deadline: after(2700000).toISOString(),
      })),
    /locked/,
  );
});
test("a device-clock rollback cannot retain out-of-window acceptance or destroy observed evidence history", () => {
  let d = startContest(fixture(), "contest", now);
  d = sync(d, [submission(2, 300000)], after(400000));
  d = reconcileContests(
    endContest(d, "contest", "early", after(100000)),
    after(100000),
  );
  assert.equal(d.contests![0].problems[0].evidence.length, 0);
  assert.equal(d.contests![0].problems[0].evidenceChanges.length, 1);
  validateData(d);
});
