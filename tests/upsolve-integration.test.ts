import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
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
  queueUpsolve,
  reconcileContests,
  eligibleUpsolves,
  editContest,
} from "../src/lib/contest-lab";
import { withPracticeSession } from "../src/lib/practice-session";
import {
  currentPracticePlan,
  practiceCandidates,
  reconcilePracticePlan,
  setPracticePreferences,
  setPlanTimebox,
  endPracticePlan,
} from "../src/lib/practice-plan";
import { validateWorkspaceProposal } from "../src/lib/workspace-proposal";
import { encodeBackup, decodeBackup } from "../src/lib/concurrency";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import {
  linkLearningAttempts,
  unlinkLearningAttempts,
} from "../src/lib/learning";
import {
  loadWorkspace,
  commitWorkspace,
  recoveriesFor,
} from "../src/lib/storage";
import { withPlannedPracticeSession } from "../src/lib/practice-plan-session";

const now = new Date("2026-10-10T06:30:00Z");
const after = (minutes: number) => new Date(now.getTime() + minutes * 60000);
function problem(index: string): Problem {
  return {
    id: `p-${index}`,
    title: `Problem 4${index}`,
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/4/${index}`,
    problemCode: `4${index}`,
    rating: 1200,
    tags: [],
    createdAt: now.toISOString(),
    reviewAt: null,
    reviewCount: 0,
  };
}
function queued(two = false, handle?: string): Data {
  const problems = [problem("A"), ...(two ? [problem("B")] : [])];
  const base = handle
    ? connectProfile(
        { ...emptyData(), problems },
        { handle, rating: null, rank: null },
        now,
      )
    : { ...emptyData(), problems };
  let data = endContest(
    startContest(
      createContest(
        base,
        "contest",
        "Practice corrections",
        30,
        problems,
        false,
        "manual",
        now,
      ),
      "contest",
      now,
    ),
    "contest",
    "early",
    after(0.5),
  );
  data = queueUpsolve(data, "contest", "contest:0", "normal", null, after(1));
  if (two)
    data = queueUpsolve(data, "contest", "contest:1", "high", null, after(1));
  return data;
}
function completed(data = queued()): Data {
  data = withPracticeSession(
    data,
    data.problems[0],
    15,
    after(2).getTime(),
    "upsolve-session",
  );
  const attempt: Attempt = {
    id: "upsolve-session",
    problemId: data.session!.problemId,
    startedAt: after(2).toISOString(),
    completedAt: after(3).toISOString(),
    elapsedMs: 60000,
    outcome: "independent",
    difficulty: null,
    notes: "The original practice record.",
    takeaway: "Keep the boundary invariant.",
  };
  return reconcileContests(
    { ...data, session: null, attempts: [attempt] },
    after(3),
  );
}

test("completed upsolve allows its actual timed outcome to be corrected to unsolved", () => {
  const data = completed();
  assert.equal(
    data.contests![0].problems[0].upsolve!.completionId,
    "upsolve-session",
  );
  const corrected = {
    ...data,
    attempts: data.attempts.map((a) => ({
      ...a,
      outcome: "unsolved" as const,
    })),
  };
  const reconciled = reconcileContests(corrected, after(4));
  assert.doesNotThrow(() => validateWorkspaceProposal(reconciled));
  assert.equal(
    reconciled.contests![0].problems[0].upsolve!.completionId,
    undefined,
  );
});

test("solved/unsolved corrections preserve originals and queue dates, reopen eligibility, round-trip and reconcile idempotently", () => {
  let data = completed();
  const originalContest = data.contests![0],
    originalAttempt = data.attempts[0],
    originalQueue = originalContest.problems[0].upsolve!;
  data = reconcileContests(
    { ...data, attempts: [{ ...originalAttempt, outcome: "unsolved" }] },
    after(4),
  );
  const queue = data.contests![0].problems[0].upsolve!;
  const expectedQueue = { ...originalQueue };
  delete expectedQueue.completionId;
  assert.deepEqual(queue, expectedQueue);
  assert.equal(data.contests![0].endedAt, originalContest.endedAt);
  assert.equal(data.contests![0].problems[0].status, "not-started");
  assert.equal(data.attempts[0].id, originalAttempt.id);
  assert.equal(data.attempts[0].notes, originalAttempt.notes);
  assert.equal(eligibleUpsolves(data, after(4)).length, 1);
  assert.equal(reconcileContests(data, after(4)), data);
  const reloaded = decodeBackup(encodeBackup(data));
  assert.equal(reconcileContests(reloaded, after(4)), reloaded);
  const solved = reconcileContests(
    {
      ...reloaded,
      attempts: [{ ...reloaded.attempts[0], outcome: "editorial" }],
    },
    after(5),
  );
  assert.equal(
    solved.contests![0].problems[0].upsolve!.completionId,
    originalAttempt.id,
  );
  assert.equal(
    solved.contests![0].problems[0].upsolve!.sessionId,
    originalAttempt.id,
  );
  validateData(solved);

  const future = localDate(after(60 * 24));
  const scheduled = {
    ...solved,
    problems: solved.problems.map((p) => ({
      ...p,
      reviewAt: future,
      reviewManual: true,
    })),
    attempts: solved.attempts.map((a) => ({
      ...a,
      outcome: "unsolved" as const,
    })),
  };
  const reopened = reconcileContests(scheduled, after(6));
  assert.equal(reopened.problems[0].reviewAt, future);
  assert.equal(eligibleUpsolves(reopened, after(6)).length, 0);
});

test("outcome corrections never reactivate an administratively removed queue entry", () => {
  let data = completed();
  data = editContest(data, "contest", (c) => ({
    ...c,
    problems: c.problems.map((p) => ({
      ...p,
      upsolve: {
        ...p.upsolve!,
        state: "removed",
        removedAt: after(4).toISOString(),
      },
    })),
  }));
  data = reconcileContests(
    {
      ...data,
      attempts: data.attempts.map((a) => ({ ...a, outcome: "unsolved" })),
    },
    after(5),
  );
  assert.equal(data.contests![0].problems[0].upsolve!.completionId, undefined);
  const restoredOutcome = reconcileContests(
    {
      ...data,
      attempts: data.attempts.map((a) => ({ ...a, outcome: "independent" })),
    },
    after(6),
  );
  assert.equal(
    restoredOutcome.contests![0].problems[0].upsolve!.state,
    "removed",
  );
  assert.equal(
    restoredOutcome.contests![0].problems[0].upsolve!.removedAt,
    after(4).toISOString(),
  );
  assert.equal(
    restoredOutcome.contests![0].problems[0].upsolve!.completionId,
    undefined,
  );
  assert.equal(eligibleUpsolves(restoredOutcome, after(6)).length, 0);
  assert.equal(reconcileContests(restoredOutcome, after(6)), restoredOutcome);
  decodeBackup(encodeBackup(restoredOutcome));
});

function imported(data: Data, handle: string) {
  data = connectProfile(data, { handle, rating: null, rank: null }, after(4));
  return mergeActivity(
    data,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id: 501,
            submittedAt: after(2.5).toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:4:A",
              title: "Problem 4A",
              code: "4A",
              url: problem("A").url,
              rating: 1200,
              tags: [],
            },
          },
        ],
      },
    ],
    "refresh",
    after(4),
  );
}
test("current profile switches retain old completion while explicit foreign provenance invalidates it without reattribution", () => {
  const original = completed(queued(false, "original_user"));
  const switched = imported(original, "other_user");
  assert.equal(
    reconcileContests(switched, after(4)).contests![0].problems[0].upsolve!
      .completionId,
    "upsolve-session",
  );
  const activity = switched.codeforces.practiceAttempts.find(
    (a) => a.handle === "other_user",
  )!;
  const linked = linkLearningAttempts(
    switched,
    "upsolve-session",
    activity.id,
    "timed",
    after(4),
  );
  assert.throws(() => validateData(linked));
  const corrected = reconcileContests(linked, after(4));
  assert.equal(corrected.contests![0].handle, "original_user");
  assert.equal(
    corrected.contests![0].problems[0].upsolve!.completionId,
    undefined,
  );
  assert.equal(
    corrected.contests![0].problems[0].upsolve!.sessionId,
    "upsolve-session",
  );
  assert.equal(eligibleUpsolves(corrected, after(4)).length, 0);
  decodeBackup(encodeBackup(corrected));
  const unlinked = reconcileContests(
    unlinkLearningAttempts(corrected, "upsolve-session"),
    after(5),
  );
  assert.equal(
    unlinked.contests![0].problems[0].upsolve!.completionId,
    "upsolve-session",
  );
  validateData(unlinked);
});

test("completion follows the selected linked reflection source and keeps the original timed outcome intact", () => {
  let data = imported(
    completed(queued(false, "original_user")),
    "original_user",
  );
  const activity = data.codeforces.practiceAttempts[0];
  data = saveQuickReflection(
    data,
    activity.id,
    {
      outcome: "unsolved",
      difficulty: null,
      takeaway: "The chosen source needs correction.",
      reviewAt: null,
      overrideSchedule: false,
    },
    after(4),
  );
  data = linkLearningAttempts(
    data,
    "upsolve-session",
    activity.id,
    "codeforces",
    after(4),
  );
  assert.throws(() => validateData(data));
  data = reconcileContests(data, after(4));
  assert.equal(data.attempts[0].outcome, "independent");
  assert.equal(data.contests![0].problems[0].upsolve!.completionId, undefined);
  validateData(data);
  data = saveQuickReflection(
    data,
    activity.id,
    {
      outcome: "independent",
      difficulty: null,
      takeaway: "The selected reflection now records a solve.",
      reviewAt: null,
      overrideSchedule: false,
    },
    after(5),
  );
  data = reconcileContests(data, after(5));
  assert.equal(
    data.contests![0].problems[0].upsolve!.completionId,
    "upsolve-session",
  );
  decodeBackup(encodeBackup(data));
});

test("confirmed contest reflections with imported provenance never fabricate a quick-reflection completion of later upsolving", () => {
  let data = reconcilePracticePlan(
    fifteenMinutes(queued(false, "original_user")),
    after(2),
  );
  const planned = currentPracticePlan(data, after(2))!.items[0];
  data = mergeActivity(
    data,
    "original_user",
    [
      {
        handle: "original_user",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 601,
            submittedAt: after(0.25).toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:4:A",
              title: "Problem 4A",
              code: "4A",
              url: problem("A").url,
              rating: 1200,
              tags: [],
            },
          },
        ],
      },
    ],
    "refresh",
    after(3),
  );
  data = reconcileContests(data, after(3));
  data = editContest(data, "contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      reflection: {
        outcome: "independent",
        difficulty: null,
        takeaway: "Confirmed understanding from the original contest.",
        savedAt: after(4).toISOString(),
      },
    })),
  }));
  assert.equal(data.codeforces.reflections.length, 0);
  data = reconcilePracticePlan(data, after(4));
  assert.doesNotThrow(() => validateData(data));
  const retained = currentPracticePlan(data, after(4))!.items.find(
    (item) => item.id === planned.id,
  )!;
  assert.equal(retained.status, "pending");
  assert.equal(retained.completion, undefined);
  assert.equal(data.contests![0].problems[0].upsolve!.completionId, undefined);
  data = editContest(data, "contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => {
      const copy = { ...row };
      delete copy.reflection;
      return copy;
    }),
  }));
  const importedId = data.codeforces.practiceAttempts[0].id;
  data = saveQuickReflection(
    data,
    importedId,
    {
      outcome: "editorial",
      difficulty: null,
      takeaway: "A real imported quick reflection remains valid evidence.",
      reviewAt: null,
      overrideSchedule: false,
    },
    after(5),
  );
  data = reconcilePracticePlan(data, after(5));
  const reflected = currentPracticePlan(data, after(5))!.items.find(
    (item) => item.id === planned.id,
  )!;
  assert.equal(reflected.status, "completed");
  assert.deepEqual(reflected.completion, {
    type: "reflection",
    recordId: importedId,
    completedAt: after(5).toISOString(),
  });
  assert.equal(data.contests![0].problems[0].upsolve!.completionId, undefined);
  validateData(data);
});

test("removing supporting timed evidence clears completion while retaining queue relationships", () => {
  const data = completed();
  const removed = reconcileContests({ ...data, attempts: [] }, after(4));
  assert.equal(
    removed.contests![0].problems[0].upsolve!.completionId,
    undefined,
  );
  assert.equal(
    removed.contests![0].problems[0].upsolve!.sessionId,
    "upsolve-session",
  );
  validateData(removed);
});

test("failed outcome-correction writes retain durable completion, retry safely, isolate accounts and keep conflicting corrections recoverable", async () => {
  const key = "account:upsolve-correction-a" as const;
  const base = await loadWorkspace(key, completed());
  await loadWorkspace("account:upsolve-correction-b", emptyData());
  const corrected = reconcileContests(
    {
      ...base.data,
      attempts: base.data.attempts.map((a) => ({
        ...a,
        outcome: "unsolved" as const,
      })),
    },
    after(4),
  );
  const originalTransaction = IDBDatabase.prototype.transaction;
  let armed = true;
  IDBDatabase.prototype.transaction = function (names, mode, options) {
    const tx = originalTransaction.call(this, names, mode, options);
    if (armed && mode === "readwrite" && this.name === "forma-workspaces") {
      armed = false;
      tx.objectStore("workspaces").get("__abort_correction__").onsuccess = () =>
        tx.abort();
    }
    return tx;
  };
  try {
    await assert.rejects(commitWorkspace(key, base, corrected));
  } finally {
    IDBDatabase.prototype.transaction = originalTransaction;
  }
  assert.equal(
    (await loadWorkspace(key)).data.contests![0].problems[0].upsolve!
      .completionId,
    "upsolve-session",
  );
  const retried = await commitWorkspace(key, base, corrected);
  assert.equal(retried.conflicts.length, 0);
  assert.equal(
    (await loadWorkspace(key)).data.contests![0].problems[0].upsolve!
      .completionId,
    undefined,
  );
  assert.equal(
    (await loadWorkspace("account:upsolve-correction-b")).data.attempts.length,
    0,
  );
  const conflicting = reconcileContests(
    {
      ...base.data,
      attempts: base.data.attempts.map((a) => ({
        ...a,
        outcome: "hint" as const,
      })),
    },
    after(4),
  );
  const lost = await commitWorkspace(key, base, conflicting);
  assert.ok(lost.conflicts.length);
  assert.equal(lost.record.data.attempts[0].outcome, "unsolved");
  const copies = await recoveriesFor(key);
  assert.equal(copies[0].data.attempts[0].outcome, "hint");
  decodeBackup(encodeBackup(copies[0].data));
});

function fifteenMinutes(data: Data) {
  return setPracticePreferences(data, {
    dailyMinutes: 15,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  });
}
test("priority changes explicitly replace stale automatic choices and remain stable after backup reload", () => {
  let data = queueUpsolve(
    queued(true),
    "contest",
    "contest:1",
    "normal",
    null,
    after(2),
  );
  data = reconcilePracticePlan(fifteenMinutes(data), after(4));
  const original = currentPracticePlan(data, after(4))!.items[0];
  assert.equal(original.identity, "contest:4:A");
  data = queueUpsolve(data, "contest", "contest:1", "high", null, after(5));
  data = reconcilePracticePlan(data, after(5));
  const plan = currentPracticePlan(data, after(5))!;
  assert.equal(plan.items.find((p) => p.id === original.id)!.status, "stale");
  assert.match(
    plan.items.find((p) => p.id === original.id)!.changeReason!,
    /high-priority/,
  );
  const pending = plan.items.filter((p) => p.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].identity, "contest:4:B");
  assert.equal(pending[0].upsolvePriority, "high");
  assert.match(pending[0].reason, /priority: high/);
  assert.equal(reconcilePracticePlan(data, after(5)), data);
  const reloaded = decodeBackup(encodeBackup(data));
  assert.equal(
    currentPracticePlan(reloaded, after(5))!.items.find(
      (p) => p.status === "pending",
    )!.upsolvePriority,
    "high",
  );
  assert.equal(reconcilePracticePlan(reloaded, after(5)), reloaded);
});

test("deliberate, already-started and ended-plan choices stay selected when another upsolve gains priority", () => {
  const base = reconcilePracticePlan(
    fifteenMinutes(
      queueUpsolve(
        queued(true),
        "contest",
        "contest:1",
        "normal",
        null,
        after(2),
      ),
    ),
    after(4),
  );
  const item = currentPracticePlan(base, after(4))!.items[0];
  const deliberate = setPlanTimebox(base, item.id, 15, after(4));
  const started = withPlannedPracticeSession(
    base,
    item.id,
    after(4).getTime(),
    "chosen-session",
  );
  const ended = endPracticePlan(base, after(4));
  for (const saved of [deliberate, started, ended]) {
    const changed = reconcilePracticePlan(
      queueUpsolve(saved, "contest", "contest:1", "high", null, after(5)),
      after(5),
    );
    const selected = currentPracticePlan(changed, after(5))!.items.find(
      (p) => p.id === item.id,
    )!;
    assert.equal(selected.status, "pending");
    assert.equal(selected.identity, "contest:4:A");
    validateData(changed);
  }
});

test("multiple automatic selections reorder once after a priority change, without replacing them on each refresh", () => {
  let data = queueUpsolve(
    queued(true),
    "contest",
    "contest:1",
    "normal",
    null,
    after(2),
  );
  data = setPracticePreferences(data, {
    dailyMinutes: 60,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  });
  data = reconcilePracticePlan(data, after(4));
  const original = currentPracticePlan(data, after(4))!.items;
  assert.deepEqual(
    original.map((item) => item.identity),
    ["contest:4:A", "contest:4:B"],
  );
  data = reconcilePracticePlan(
    queueUpsolve(data, "contest", "contest:1", "high", null, after(5)),
    after(5),
  );
  const items = currentPracticePlan(data, after(5))!.items;
  assert.deepEqual(
    items
      .filter((item) => item.status === "pending")
      .map((item) => item.identity),
    ["contest:4:B", "contest:4:A"],
  );
  assert.ok(
    original.every(
      (saved) => items.find((item) => item.id === saved.id)!.status === "stale",
    ),
  );
  assert.equal(reconcilePracticePlan(data, after(6)), data);
  const reloaded = decodeBackup(encodeBackup(data));
  assert.equal(reconcilePracticePlan(reloaded, after(6)), reloaded);
});

test("lowering a selected automatic priority keeps the old evidence visible and restores deterministic selection", () => {
  let data = reconcilePracticePlan(fifteenMinutes(queued(true)), after(4));
  const original = currentPracticePlan(data, after(4))!.items[0];
  assert.equal(original.identity, "contest:4:B");
  data = reconcilePracticePlan(
    queueUpsolve(data, "contest", "contest:1", "normal", null, after(5)),
    after(5),
  );
  const items = currentPracticePlan(data, after(5))!.items;
  assert.equal(
    items.find((item) => item.id === original.id)!.upsolvePriority,
    "high",
  );
  assert.equal(items.find((item) => item.id === original.id)!.status, "stale");
  assert.match(
    items.find((item) => item.id === original.id)!.changeReason!,
    /priority changed/,
  );
  assert.equal(
    items.find((item) => item.status === "pending")!.identity,
    "contest:4:A",
  );
  assert.equal(reconcilePracticePlan(data, after(6)), data);
});

test("priority only breaks equal coding dates and preserves earlier schedules, deterministic ties and all exclusions", () => {
  const today = localDate(after(4)),
    yesterday = localDate(new Date(now.getTime() - 86400000));
  const earlier = queueUpsolve(
    queued(true),
    "contest",
    "contest:0",
    "normal",
    yesterday,
    after(2),
  );
  assert.equal(
    practiceCandidates(earlier, after(4))[0].identity,
    "contest:4:A",
  );
  const equalPriority = queueUpsolve(
    queued(true),
    "contest",
    "contest:0",
    "high",
    null,
    after(2),
  );
  assert.equal(
    practiceCandidates(equalPriority, after(4))[0].identity,
    "contest:4:A",
  );
  for (const exclusion of [
    { archived: true },
    { skippedOn: today },
    { deferredUntil: localDate(after(1440)) },
    { reviewAt: localDate(after(1440)), reviewManual: true },
  ]) {
    const data = {
      ...queued(true),
      problems: queued(true).problems.map((p) =>
        p.id === "p-B" ? { ...p, ...exclusion } : p,
      ),
    };
    assert.equal(
      practiceCandidates(data, after(4)).some(
        (p) => p.identity === "contest:4:B" && p.activity === "coding",
      ),
      false,
    );
  }
  const future = queueUpsolve(
    queued(true),
    "contest",
    "contest:1",
    "high",
    localDate(after(1440)),
    after(2),
  );
  assert.equal(practiceCandidates(future, after(4))[0].identity, "contest:4:A");
  const foreign = connectProfile(
    queued(true, "original_user"),
    { handle: "other_user", rating: null, rank: null },
    after(4),
  );
  assert.equal(
    practiceCandidates(foreign, after(4)).some(
      (p) => p.upsolvePriority !== undefined,
    ),
    false,
  );
  const active = withPracticeSession(
    queued(true),
    problem("A"),
    15,
    after(4).getTime(),
    "active-session",
  );
  assert.equal(practiceCandidates(active, after(4))[0].kind, "session");
});

test("priority metadata is optional for legacy plans and validated for upsolve snapshots", () => {
  const data = reconcilePracticePlan(fifteenMinutes(queued(true)), after(4));
  const legacy = structuredClone(data);
  delete legacy.practicePlans![0].items[0].upsolvePriority;
  assert.doesNotThrow(() => decodeBackup(encodeBackup(legacy)));
  const invalid = structuredClone(data);
  Object.assign(invalid.practicePlans![0].items[0], {
    upsolvePriority: "urgent",
  });
  assert.throws(() => validateData(invalid));
});

test("a fifteen-minute plan selects high-priority 4B over normal-priority 4A under equal scheduling conditions", () => {
  const data = setPracticePreferences(queued(true), {
    dailyMinutes: 15,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  });
  assert.equal(eligibleUpsolves(data, after(4))[0].row.identity, "contest:4:B");
  const candidates = practiceCandidates(data, after(4));
  assert.equal(candidates[0].identity, "contest:4:B");
  const planned = reconcilePracticePlan(data, after(4));
  const pending = currentPracticePlan(planned, after(4))!.items.filter(
    (item) => item.status === "pending",
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].identity, "contest:4:B");
});
