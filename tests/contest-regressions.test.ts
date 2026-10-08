import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  localDate,
  validateData,
  type Data,
  type Problem,
  type Attempt,
} from "../src/lib/model";
import {
  createContest,
  startContest,
  endContest,
  contestEvidence,
  reconcileContests,
  queueUpsolve,
  eligibleUpsolves,
} from "../src/lib/contest-lab";
import { connectProfile } from "../src/lib/codeforces";
import type { PlatformSubmission } from "../src/lib/codeforces-types";
import {
  currentPracticePlan,
  reconcilePracticePlan,
} from "../src/lib/practice-plan";
import { withPlannedPracticeSession } from "../src/lib/practice-plan-session";
import { withPracticeSession } from "../src/lib/practice-session";

const now = new Date("2026-10-08T06:30:00Z");
const after = (ms: number) => new Date(now.getTime() + ms);
function problem(id: string, index = "A", gym = false): Problem {
  return {
    id,
    title: `Problem 4${index}`,
    platform: "Codeforces",
    url: gym
      ? `https://codeforces.com/gym/4/problem/${index}`
      : `https://codeforces.com/problemset/problem/4/${index}`,
    problemCode: `4${index}`,
    rating: 1200,
    tags: [],
    createdAt: now.toISOString(),
    reviewAt: null,
    reviewCount: 0,
  };
}
function notebook(): Data {
  return connectProfile(
    { ...emptyData(), problems: [problem("personal")] },
    { handle: "fixture_user", rating: 1400, rank: "specialist" },
    now,
  );
}
function finished(data = notebook(), id = "contest", start = now) {
  return endContest(
    startContest(
      createContest(
        data,
        id,
        id,
        30,
        [data.problems[0]],
        false,
        "manual",
        start,
      ),
      id,
      start,
    ),
    id,
    "early",
    new Date(start.getTime() + 600000),
  );
}
function submission(
  id: number,
  at: number,
  problemId = "imported",
  handle = "fixture_user",
  verdict: string | null = "OK",
): PlatformSubmission {
  return {
    id,
    handle,
    problemId,
    submittedAt: after(at).toISOString(),
    verdict,
    language: "GNU C++20",
  };
}

test("indexed contest evidence preserves canonical aliases, profile isolation, inclusive frozen windows and submission ID order", () => {
  let data = connectProfile(
    finished(),
    { handle: "other_user", rating: null, rank: null },
    after(700000),
  );
  data = {
    ...data,
    problems: [
      ...data.problems,
      {
        ...problem("imported"),
        url: "https://codeforces.com/contest/4/problem/A",
        cfHandle: "fixture_user",
        cfKey: "contest:4:A",
      },
      { ...problem("other"), cfHandle: "other_user", cfKey: "contest:4:A" },
      {
        ...problem("a1", "A1"),
        cfHandle: "fixture_user",
        cfKey: "contest:4:A1",
      },
      {
        ...problem("gym", "A", true),
        cfHandle: "fixture_user",
        cfKey: "gym:4:A",
      },
    ],
    codeforces: {
      ...data.codeforces,
      submissions: [
        submission(30, 600000),
        submission(10, 0),
        submission(20, 300000, "imported", "FIXTURE_USER", "WRONG_ANSWER"),
        submission(40, -1),
        submission(50, 600001),
        submission(60, 300000, "other", "other_user"),
        submission(70, 300000, "a1"),
        submission(80, 300000, "gym"),
      ],
    },
  };
  data.codeforces.practiceAttempts = data.codeforces.submissions.map((s) => ({
    id: `observed:${s.id}`,
    handle: s.handle,
    problemId: s.problemId,
    submissionIds: [s.id],
    firstSubmittedAt: s.submittedAt,
    lastSubmittedAt: s.submittedAt,
    inbox: false,
    skipped: false,
    wasRevisit: false,
  }));
  const contest = data.contests![0],
    row = contest.problems[0];
  const evidence = contestEvidence(data, contest, row);
  assert.deepEqual(
    evidence.map((e) => e.id),
    [10, 20, 30],
  );
  assert.equal(evidence[1].verdict, "WRONG_ANSWER");
  // Callers receive their own result objects, never mutable cached evidence.
  evidence[0].verdict = "WRONG_ANSWER";
  assert.equal(contestEvidence(data, contest, row)[0].verdict, "OK");
  const reconciled = reconcileContests(data, after(1200000));
  assert.deepEqual(
    reconciled.contests![0].problems[0].evidence.map((e) => e.id),
    [10, 20, 30],
  );
  validateData(reconciled);

  const rejudged: Data = {
    ...reconciled,
    codeforces: {
      ...reconciled.codeforces,
      submissions: reconciled.codeforces.submissions.map((s) =>
        s.id === 10 ? { ...s, verdict: "WRONG_ANSWER" } : s,
      ),
    },
  };
  assert.equal(
    contestEvidence(rejudged, contest, row)[0].verdict,
    "WRONG_ANSWER",
  );
  const updated = reconcileContests(rejudged, after(1300000));
  assert.ok(
    updated.contests![0].problems[0].evidenceChanges.some(
      (e) =>
        e.submissionId === 10 &&
        e.before === "OK" &&
        e.after === "WRONG_ANSWER",
    ),
  );
  validateData(updated);
});

test("historical reconciliation reads each platform timestamp once rather than once per contest row", () => {
  let data = finished();
  const first = data.contests![0];
  const imported: Problem = {
    ...problem("imported"),
    cfHandle: "fixture_user",
    cfKey: "contest:4:A",
  };
  let timestampReads = 0;
  const submissions = Array.from({ length: 1000 }, (_, i) => {
    const value = submission(i + 1, -86400000 - i * 60000),
      timestamp = value.submittedAt;
    Object.defineProperty(value, "submittedAt", {
      enumerable: true,
      get: () => {
        timestampReads++;
        return timestamp;
      },
    });
    return value;
  });
  data = {
    ...data,
    problems: [...data.problems, imported],
    codeforces: { ...data.codeforces, submissions },
    contests: Array.from({ length: 50 }, (_, i) => ({
      ...first,
      id: `history-${i}`,
      problems: first.problems.map((p) => ({ ...p, id: `history-${i}:0` })),
    })),
  };
  assert.equal(reconcileContests(data, after(1200000)), data);
  assert.equal(reconcileContests(data, after(1300000)), data);
  assert.equal(timestampReads, submissions.length);
});

test("starting a planned upsolve binds and completes the queue entry named by the plan", () => {
  let data = finished();
  data = finished(data, "earlier", after(700000));
  data = queueUpsolve(
    data,
    "contest",
    "contest:0",
    "high",
    localDate(now),
    after(1400000),
  );
  data = queueUpsolve(
    data,
    "earlier",
    "earlier:0",
    "normal",
    localDate(new Date(now.getTime() - 86400000)),
    after(1400000),
  );
  const at = after(1500000);
  assert.equal(eligibleUpsolves(data, at)[0].contest.id, "contest");
  data = reconcilePracticePlan(data, at);
  const item = currentPracticePlan(data, at)!.items.find(
    (p) => p.status === "pending",
  )!;
  assert.equal(item.candidateKey, "upsolve:earlier:0");
  assert.match(item.reason, /earlier/);

  const generic = withPracticeSession(
    data,
    data.problems[0],
    30,
    at.getTime(),
    "generic-session",
  );
  assert.equal(
    generic.contests![0].problems[0].upsolve!.sessionId,
    "generic-session",
  );
  assert.equal(generic.contests![1].problems[0].upsolve!.sessionId, undefined);

  const planned = withPlannedPracticeSession(
    data,
    item.id,
    at.getTime(),
    "planned-session",
  );
  assert.equal(planned.contests![0].problems[0].upsolve!.sessionId, undefined);
  assert.equal(
    planned.contests![1].problems[0].upsolve!.sessionId,
    "planned-session",
  );
  const attempt: Attempt = {
    id: "planned-session",
    problemId: planned.session!.problemId,
    startedAt: at.toISOString(),
    completedAt: after(1560000).toISOString(),
    elapsedMs: 60000,
    outcome: "independent",
    difficulty: null,
    notes: "A later, separately measured practice attempt.",
    takeaway: "The original contest is preserved.",
  };
  const completed = reconcileContests(
    { ...planned, session: null, attempts: [attempt] },
    after(1560000),
  );
  assert.equal(
    completed.contests![0].problems[0].upsolve!.completionId,
    undefined,
  );
  assert.equal(
    completed.contests![1].problems[0].upsolve!.completionId,
    attempt.id,
  );
  assert.equal(completed.contests![1].endedAt, after(1300000).toISOString());
  validateData(completed);
});
