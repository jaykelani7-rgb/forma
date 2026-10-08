import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  emptyData,
  validateData,
  type Data,
  type Attempt,
  type Problem,
} from "../src/lib/model";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import {
  learningHistory,
  learningStats,
  linkLearningAttempts,
} from "../src/lib/learning";
import {
  memoryPeriod,
  memorySummary,
  problemMemory,
  recallDueForProblem,
  revisionCueForProblem,
  revisionHandle,
  saveRevision,
  suggestedRecallDate,
} from "../src/lib/memory";
import {
  type RevisionRecord,
  validateReflectionMemory,
} from "../src/lib/memory-types";
import {
  encodeBackup,
  decodeBackup,
  mergeWorkspaces,
} from "../src/lib/concurrency";
import {
  commitWorkspace,
  loadWorkspace,
  recoveriesFor,
} from "../src/lib/storage";

const now = new Date("2026-10-07T12:00:00.000Z");
const personal = (): Problem => ({
  id: "sheet-381A",
  title: "Sereja and Dima",
  platform: "Codeforces",
  url: "https://codeforces.com/problemset/problem/381/A",
  problemCode: "381A",
  tags: [],
  rating: 800,
  createdAt: "2026-10-01T12:00:00.000Z",
  reviewAt: null,
  reviewCount: 0,
});
function timed(
  id: string,
  outcome: Attempt["outcome"],
  completedAt = "2026-10-03T12:30:00.000Z",
): Attempt {
  return {
    id,
    problemId: "sheet-381A",
    startedAt: new Date(Date.parse(completedAt) - 1800000).toISOString(),
    completedAt,
    elapsedMs: 1800000,
    outcome,
    difficulty: null,
    takeaway: "Notice that only the ends are available.",
    notes: "Worked through the invariant on paper.",
  };
}
function activity(
  data: Data,
  handle: string,
  id: number,
  verdict = "OK",
): Data {
  const connected = connectProfile(
    data,
    { handle, rating: null, rank: null },
    now,
  );
  return mergeActivity(
    connected,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id,
            submittedAt: "2026-10-04T12:00:00.000Z",
            verdict,
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              title: "Sereja and Dima",
              code: "381A",
              url: personal().url,
              rating: 800,
              tags: ["two pointers"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
}
function fixture(): Data {
  return activity(
    {
      ...emptyData(),
      problems: [personal()],
      attempts: [timed("timed-a", "hint")],
    },
    "jay",
    1,
  );
}
function revision(
  id = "recall-a",
  overrides: Partial<RevisionRecord> = {},
): RevisionRecord {
  return {
    id,
    problemId: "sheet-381A",
    handle: "jay",
    activity: "explain",
    outcome: "cue",
    response:
      "The two remaining ends are the only choices; move exactly one pointer.",
    cue: "What is still available?",
    completedAt: now.toISOString(),
    nextReviewAt: "2026-10-10",
    ...overrides,
  };
}

test("old schema workspaces gain optional empty memory without invented labels, and new fields round trip", () => {
  const old = fixture() as Data;
  delete old.revisions;
  delete old.settings.recallDays;
  const clean = validateData(old);
  assert.deepEqual(clean.revisions, []);
  assert.deepEqual(clean.settings.recallDays, {
    independent: 7,
    cue: 3,
    unrecalled: 1,
  });
  assert.equal(clean.attempts[0].mistakes, undefined);
  const updated = saveRevision(clean, revision());
  updated.attempts[0] = {
    ...updated.attempts[0],
    mistakes: ["indexing", "edges"],
    mistakeNote: "Used the wrong right boundary.",
    approach: "Compared both ends.",
  };
  updated.problems[0].reviewUpdatedAt = now.toISOString();
  assert.deepEqual(decodeBackup(encodeBackup(updated)), updated);
  const legacy = {
    ...emptyData(),
    schemaVersion: 1,
    problems: [personal()],
    attempts: [timed("legacy", "unsolved")],
  };
  delete (legacy as Partial<Data>).revisions;
  assert.equal(validateData(legacy).schemaVersion, 2);
  assert.equal(
    memorySummary(validateData(legacy), "sheet-381A").mistakes.length,
    0,
  );
});

test("optional memory rejects unknown or duplicate labels and bounded text instead of inferring verdict mistakes", () => {
  assert.throws(
    () => validateReflectionMemory({ mistakes: ["indexing", "indexing"] }),
    /unique/,
  );
  assert.throws(
    () => validateReflectionMemory({ mistakes: ["Wrong Answer"] }),
    /recognised/,
  );
  assert.throws(
    () => validateReflectionMemory({ approach: "x".repeat(2001) }),
    /2,000/,
  );
  const data = activity(
    { ...emptyData(), problems: [personal()] },
    "jay",
    1,
    "TIME_LIMIT_EXCEEDED",
  );
  const summary = memorySummary(data, "sheet-381A");
  assert.equal(summary.latestReflection, null);
  assert.deepEqual(summary.mistakes, []);
  assert.equal(summary.latestTakeaway, "");
  assert.equal(problemMemory(data, "sheet-381A").history[0].elapsedMs, null);
});

test("matching track-created and imported problems share current-profile memory with archived history explicitly scoped", () => {
  let data = fixture();
  const imported = data.codeforces.practiceAttempts[0];
  data = saveQuickReflection(
    data,
    imported.id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Use two ends.",
      mistakes: ["indexing"],
      reviewAt: "2026-10-12",
      overrideSchedule: true,
    },
    now,
  );
  const first = problemMemory(data, "sheet-381A");
  assert.equal(first.history.length, 2);
  assert.equal(first.problems.length, 2);
  assert.equal(first.summary.assistance.length, 2);
  data = activity(data, "alex", 2);
  const current = problemMemory(data, "sheet-381A");
  assert.equal(current.history.length, 2);
  assert.ok(
    current.history.every(
      (record) => record.handle === null || record.handle === "alex",
    ),
  );
  assert.deepEqual(current.summary.mistakes, []);
  assert.equal(
    problemMemory(data, imported.problemId, { handle: "jay" }).history.length,
    2,
  );
  assert.equal(
    problemMemory(data, imported.problemId, { handle: "jay" }).summary
      .mistakes[0].category,
    "indexing",
  );
});

test("linked events select one reflection's mistake evidence while retaining original source records and measured time", () => {
  let data = fixture();
  data.attempts[0] = {
    ...data.attempts[0],
    mistakes: ["edges"],
    approach: "Tried taking turns.",
    mistakeNote: "Forgot equal values.",
  };
  const imported = data.codeforces.practiceAttempts[0];
  data = saveQuickReflection(
    data,
    imported.id,
    {
      outcome: "independent",
      difficulty: null,
      takeaway: "Greedily choose the larger end.",
      mistakes: ["indexing"],
      approach: "Compared both ends.",
      reviewAt: null,
      overrideSchedule: false,
    },
    now,
  );
  data = linkLearningAttempts(data, "timed-a", imported.id, "codeforces", now);
  const memory = problemMemory(data, "sheet-381A");
  assert.equal(memory.history.length, 1);
  assert.equal(memory.history[0].source, "linked");
  assert.deepEqual(memory.history[0].mistakes, ["indexing"]);
  assert.equal(memory.history[0].approach, "Compared both ends.");
  assert.equal(memory.history[0].notes, data.attempts[0].notes);
  assert.equal(memory.history[0].elapsedMs, 1800000);
  assert.deepEqual(data.attempts[0].mistakes, ["edges"]);
  assert.deepEqual(memory.summary.mistakes, [
    { category: "indexing", count: 1 },
  ]);
  const period = memoryPeriod(data, "2026-10-01", "2026-10-07");
  assert.equal(period.history.length, 1);
  assert.equal(period.timedSessions, 1);
  assert.equal(period.importedActivity, 1);
  assert.equal(period.linkedEvents, 1);
  assert.equal(period.measuredMinutes, 30);
});

test("reflection labels can be explicitly removed without deleting or reattributing an imported event", () => {
  let data = fixture();
  const id = data.codeforces.practiceAttempts[0].id;
  data = saveQuickReflection(
    data,
    id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Keep the endpoints straight.",
      mistakes: ["indexing", "edges"],
      mistakeNote: "Off by one.",
      approach: "Greedy.",
      reviewAt: "2026-10-12",
      overrideSchedule: true,
    },
    now,
  );
  data = saveQuickReflection(
    data,
    id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Changed only the basic reflection.",
      reviewAt: "2026-10-12",
      overrideSchedule: false,
    },
    now,
  );
  assert.deepEqual(data.codeforces.reflections[0].mistakes, [
    "indexing",
    "edges",
  ]);
  assert.equal(data.codeforces.reflections[0].mistakeNote, "Off by one.");
  assert.equal(data.codeforces.reflections[0].approach, "Greedy.");
  data = saveQuickReflection(
    data,
    id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Keep the endpoints straight.",
      mistakes: [],
      mistakeNote: "",
      approach: "",
      reviewAt: "2026-10-12",
      overrideSchedule: false,
    },
    new Date("2026-10-08T12:00:00Z"),
  );
  const restored = decodeBackup(encodeBackup(data));
  assert.deepEqual(restored.codeforces.reflections[0].mistakes, []);
  assert.equal(restored.codeforces.reflections[0].mistakeNote, "");
  assert.equal(restored.codeforces.practiceAttempts.length, 1);
  assert.deepEqual(memorySummary(restored, "sheet-381A").mistakes, []);
});

test("summaries count actual repeated labels and select the most recently edited reflection with sparse evidence", () => {
  let data = fixture();
  data.attempts[0] = {
    ...data.attempts[0],
    mistakes: ["indexing"],
    takeaway: "The old note.",
  };
  const id = data.codeforces.practiceAttempts[0].id;
  data = saveQuickReflection(
    data,
    id,
    {
      outcome: "editorial",
      difficulty: null,
      takeaway: "A newer recorded takeaway.",
      mistakes: ["indexing", "edges"],
      reviewAt: null,
      overrideSchedule: false,
    },
    now,
  );
  const summary = memorySummary(data, "sheet-381A");
  assert.equal(summary.latestReflection?.importedAttemptId, id);
  assert.equal(summary.latestTakeaway, "A newer recorded takeaway.");
  assert.deepEqual(summary.mistakes, [
    { category: "indexing", count: 2 },
    { category: "edges", count: 1 },
  ]);
  assert.equal(summary.latestRevision, null);
});

test("a personal timed event linked to an archived handle stays out of the new profile's shared memory", () => {
  let data = fixture();
  data.attempts[0].mistakes = ["invariant"];
  const imported = data.codeforces.practiceAttempts[0];
  data = linkLearningAttempts(data, "timed-a", imported.id, "timed", now);
  assert.equal(problemMemory(data, "sheet-381A").history.length, 1);
  data = activity(data, "alex", 2);
  const memory = problemMemory(data, "sheet-381A");
  assert.equal(memory.history.length, 1);
  assert.equal(memory.history[0].handle, "alex");
  assert.deepEqual(memory.summary.mistakes, []);
  const archived = problemMemory(data, imported.problemId, { handle: "jay" });
  assert.equal(archived.history.length, 1);
  assert.equal(archived.history[0].source, "linked");
  assert.deepEqual(archived.history[0].mistakes, ["invariant"]);
});

test("written revision remains separate from acceptance, attempts, and measured time and keeps a coding revisit", () => {
  let data = fixture();
  data.problems[0] = {
    ...data.problems[0],
    reviewAt: "2026-10-12",
    reviewManual: true,
  };
  const baseline = learningStats(data);
  data = saveRevision(data, revision());
  assert.equal(data.problems[0].reviewAt, "2026-10-12");
  assert.deepEqual(learningStats(data), baseline);
  assert.equal(data.attempts.length, 1);
  assert.equal(data.codeforces.submissions.length, 1);
  assert.equal(problemMemory(data, "sheet-381A").timeline.length, 3);
  const period = memoryPeriod(data, "2026-10-07", "2026-10-07");
  assert.equal(period.revisions.length, 1);
  assert.equal(period.measuredMinutes, 0);
  assert.deepEqual(period.outcomes, { independent: 0, cue: 1, unrecalled: 0 });
});

test("recall defaults and deliberate overrides use the latest written check without erasing coding schedules", () => {
  let data = fixture();
  assert.equal(suggestedRecallDate(data, "independent", now), "2026-10-14");
  assert.equal(suggestedRecallDate(data, "cue", now), "2026-10-10");
  assert.equal(suggestedRecallDate(data, "unrecalled", now), "2026-10-08");
  data.settings.recallDays = { independent: 14, cue: 5, unrecalled: 2 };
  assert.equal(suggestedRecallDate(data, "cue", now), "2026-10-12");
  data.problems[0].reviewAt = "2026-10-12";
  data = saveRevision(data, revision("first", { nextReviewAt: "2026-10-20" }));
  data = saveRevision(
    data,
    revision("next", {
      activity: "complexity",
      outcome: "independent",
      completedAt: "2026-10-08T12:00:00Z",
      nextReviewAt: null,
    }),
  );
  assert.equal(recallDueForProblem(data, "sheet-381A"), null);
  assert.equal(data.problems[0].reviewAt, "2026-10-12");
  assert.throws(
    () =>
      validateData({
        ...data,
        settings: {
          ...data.settings,
          recallDays: { independent: 0, cue: 3, unrecalled: 1 },
        },
      }),
    /Recall defaults/,
  );
});

test("revision retries upsert stable IDs, preserve profile provenance, and keep scoped cues isolated", () => {
  let data = fixture();
  assert.equal(revisionHandle(data, "sheet-381A"), "jay");
  data = saveRevision(data, revision());
  data = saveRevision(data, revision());
  assert.equal(data.revisions?.length, 1);
  assert.equal(
    revisionCueForProblem(data, "sheet-381A"),
    "What is still available?",
  );
  assert.equal(data.problems[0].revisionCue, undefined);
  data = activity(data, "alex", 2);
  assert.equal(recallDueForProblem(data, "sheet-381A"), null);
  assert.equal(revisionCueForProblem(data, "sheet-381A"), "");
  assert.equal(
    revisionCueForProblem(data, "sheet-381A", { handle: "jay" }),
    "What is still available?",
  );
  assert.throws(
    () => saveRevision(data, revision("recall-a", { handle: "alex" })),
    /cannot be reassigned/,
  );
  const jayProblem = data.problems.find(
    (problem) => problem.cfHandle === "jay",
  )!;
  assert.throws(
    () =>
      saveRevision(
        data,
        revision("wrong-source", { problemId: jayProblem.id, handle: "alex" }),
      ),
    /different Codeforces profile/,
  );
  assert.throws(
    () => validateData({ ...data, revisions: [revision(), revision()] }),
    /duplicate IDs/,
  );
});

test("period evidence sees earlier assistance outside the period, excludes unsolved-only claims, and respects profile scope", () => {
  let data = fixture();
  data.attempts.push(
    timed("timed-win", "independent", "2026-10-07T13:00:00.000Z"),
  );
  data.attempts.push({
    ...timed("another", "unsolved"),
    problemId: "sheet-381A",
  });
  data = saveRevision(data, revision());
  const period = memoryPeriod(data, "2026-10-07", "2026-10-07");
  assert.equal(period.independentAfterAssistance.length, 1);
  assert.equal(
    period.independentAfterAssistance[0].attempt.id,
    "timed:timed-win",
  );
  assert.equal(period.measuredMinutes, 30);
  assert.equal(period.importedActivity, 0);
  assert.equal(period.outcomes.cue, 1);
  data = activity(data, "alex", 2);
  assert.equal(memoryPeriod(data, "2026-10-07", "2026-10-07").outcomes.cue, 0);
  const noAssistance = {
    ...emptyData(),
    problems: [personal()],
    attempts: [
      timed("unsolved", "unsolved"),
      timed("win", "independent", "2026-10-07T13:00:00Z"),
    ],
  };
  assert.equal(
    memoryPeriod(noAssistance, "2026-10-07", "2026-10-07")
      .independentAfterAssistance.length,
    0,
  );
});

test("concurrent revision identities merge and conflicting recall decisions remain explicit", () => {
  const base = fixture();
  const left = saveRevision(base, revision("left"));
  const right = saveRevision(
    base,
    revision("right", { activity: "complexity" }),
  );
  const combined = mergeWorkspaces(base, left, right);
  assert.deepEqual(combined.conflicts, []);
  assert.equal(combined.data.revisions?.length, 2);
  const scheduled = saveRevision(base, revision());
  const conflict = mergeWorkspaces(
    scheduled,
    saveRevision(
      scheduled,
      revision("recall-a", { nextReviewAt: "2026-10-14" }),
    ),
    saveRevision(scheduled, revision("recall-a", { nextReviewAt: null })),
  );
  assert.ok(conflict.conflicts.some((path) => path.endsWith(".nextReviewAt")));
  assert.equal(conflict.data.revisions?.[0].nextReviewAt, null);
});

test("revision storage persists stable retries, account isolation, and recoverable conflicting drafts", async () => {
  const base = await loadWorkspace("account:memory-jay", fixture());
  const draft = revision();
  const saved = await commitWorkspace(
    base.key,
    base,
    saveRevision(base.data, draft),
  );
  const retry = await commitWorkspace(
    base.key,
    saved.record,
    saveRevision(saved.record.data, draft),
  );
  assert.equal((await loadWorkspace(base.key)).data.revisions?.length, 1);
  assert.equal(
    (await loadWorkspace("account:memory-alex")).data.revisions?.length,
    0,
  );
  const current = await commitWorkspace(
    base.key,
    retry.record,
    saveRevision(retry.record.data, { ...draft, nextReviewAt: "2026-10-14" }),
  );
  const failed = await commitWorkspace(
    base.key,
    retry.record,
    saveRevision(retry.record.data, {
      ...draft,
      nextReviewAt: null,
      response: "A retained losing revision draft.",
    }),
  );
  assert.ok(failed.conflicts.length);
  assert.equal(
    failed.record.data.revisions?.[0].nextReviewAt,
    current.record.data.revisions?.[0].nextReviewAt,
  );
  const recovery = (await recoveriesFor(base.key))[0];
  assert.equal(
    recovery.data.revisions?.[0].response,
    "A retained losing revision draft.",
  );
  assert.equal(decodeBackup(encodeBackup(recovery.data)).revisions?.length, 1);
  assert.equal(learningHistory(failed.record.data).length, 2);
});
