import test from "node:test";
import assert from "node:assert/strict";
import {
  Attempt,
  Data,
  emptyData,
  latestReflection,
  localDate,
  validateData,
} from "../src/lib/model";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import { ActivityPage } from "../src/lib/codeforces-types";
import { mergeWorkspaces } from "../src/lib/concurrency";
import {
  learningBreakthroughs,
  learningByProblem,
  learningHistory,
  learningStats,
  linkLearningAttempts,
  normalizedTopic,
  possibleImportedLearningLinks,
  possibleLearningLinks,
  problemLearningHistory,
  problemPracticeState,
  unlinkLearningAttempts,
} from "../src/lib/learning";

const now = new Date("2026-10-04T12:00:00.000Z");
function activity(handle = "jay"): Data {
  const connected = connectProfile(
    emptyData(),
    { handle, rating: null, rank: null },
    now,
  );
  const page: ActivityPage = {
    handle,
    from: 1,
    count: 50,
    submissions: [
      {
        id: 1,
        submittedAt: "2026-10-02T12:00:00.000Z",
        verdict: "OK",
        language: "GNU C++20",
        problem: {
          key: "contest:189:A",
          title: "Cut Ribbon",
          code: "189A",
          url: "https://codeforces.com/problemset/problem/189/A",
          rating: 1300,
          tags: ["dp", "Dynamic programming"],
        },
      },
    ],
  };
  return mergeActivity(connected, handle, [page], "refresh", now);
}
function reflection(
  data: Data,
  outcome: "hint" | "independent" = "hint",
): Data {
  return saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome,
      difficulty: "coding",
      takeaway: "Define dp[length] before writing the loops.",
      reviewAt: "2026-10-07",
      overrideSchedule: true,
    },
    now,
  );
}
function timed(
  data: Data,
  outcome: Attempt["outcome"] = "independent",
  id = "timed-1",
): Data {
  return {
    ...data,
    attempts: [
      ...data.attempts,
      {
        id,
        problemId: data.problems[0].id,
        startedAt: "2026-10-03T12:00:00.000Z",
        completedAt: "2026-10-03T12:30:00.000Z",
        elapsedMs: 1800000,
        outcome,
        difficulty: null,
        takeaway: "Unreachable states need a sentinel.",
        notes: "Kept the recurrence separate from initialization.",
      },
    ],
  };
}

test("imported-only progress reflects actual learning without granting acceptance independent credit", () => {
  const pending = activity();
  const pendingStats = learningStats(pending);
  assert.equal(pendingStats.practiceAttempts, 1);
  assert.equal(pendingStats.pending, 1);
  assert.equal(pendingStats.independent, 0);
  assert.equal(pendingStats.timedSessions, 0);
  assert.equal(pendingStats.measuredMinutes, 0);
  assert.equal(
    problemPracticeState(pending, pending.problems[0].id),
    "pending",
  );
  assert.equal(latestReflection(pending, pending.problems[0].id), undefined);
  assert.equal(learningHistory(pending)[0].accepted, true);
  assert.equal(learningHistory(pending)[0].reflectionPending, true);
  const data = reflection(pending);
  const stats = learningStats(data);
  assert.equal(stats.reflected, 1);
  assert.equal(stats.assisted, 1);
  assert.equal(stats.pending, 0);
  assert.deepEqual(stats.difficulties, [{ difficulty: "coding", count: 1 }]);
  assert.deepEqual(stats.topics, [
    { topic: "dynamic programming", count: 1, reflected: 1 },
  ]);
  assert.equal(
    latestReflection(data, data.problems[0].id)?.takeaway,
    data.codeforces.reflections[0].takeaway,
  );
  assert.deepEqual(stats.practiceDays, ["2026-10-02"]);
});

test("independent timed practice after imported assistance creates a breakthrough with sourced history", () => {
  const data = timed(reflection(activity()));
  const stats = learningStats(data);
  assert.equal(stats.independent, 1);
  assert.equal(stats.assisted, 1);
  assert.equal(stats.timedSessions, 1);
  assert.equal(stats.measuredMinutes, 30);
  assert.equal(learningBreakthroughs(data).length, 1);
  assert.equal(learningBreakthroughs(data)[0].attempt.source, "timed");
  assert.deepEqual(
    problemLearningHistory(data, data.problems[0].id).map(
      (record) => record.source,
    ),
    ["timed", "codeforces"],
  );
  assert.equal(problemPracticeState(data, data.problems[0].id), "independent");
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});

test("handles remain scoped and a solve on another handle cannot create a breakthrough", () => {
  let data = reflection(activity("jay"));
  data = connectProfile(
    data,
    { handle: "other", rating: null, rank: null },
    now,
  );
  data = mergeActivity(
    data,
    "other",
    [
      {
        handle: "other",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 1,
            submittedAt: "2026-10-03T12:00:00.000Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:189:A",
              title: "Cut Ribbon",
              code: "189A",
              url: "https://codeforces.com/problemset/problem/189/A",
              rating: 1300,
              tags: ["dp"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  const imported = data.codeforces.practiceAttempts.find(
    (attempt) => attempt.handle === "other",
  )!;
  data = saveQuickReflection(
    data,
    imported.id,
    {
      outcome: "independent",
      difficulty: null,
      takeaway: "",
      reviewAt: null,
      overrideSchedule: true,
    },
    now,
  );
  assert.equal(learningStats(data).assisted, 0);
  assert.equal(learningStats(data).independent, 1);
  assert.equal(learningStats(data, { handle: "jay" }).assisted, 1);
  assert.equal(learningBreakthroughs(data, { allProfiles: true }).length, 0);
  assert.equal(learningHistory(data, { allProfiles: true }).length, 2);
});

test("explicit linking deduplicates learning credit while preserving notes, time and platform provenance", () => {
  const original = timed(reflection(activity()));
  const imported = original.codeforces.practiceAttempts[0];
  assert.equal(possibleLearningLinks(original, imported.id).length, 1);
  const data = linkLearningAttempts(
    original,
    original.attempts[0].id,
    imported.id,
    "timed",
    now,
  );
  const history = learningHistory(data);
  assert.equal(history.length, 1);
  assert.equal(history[0].source, "linked");
  assert.equal(history[0].outcome, "independent");
  assert.equal(history[0].timedAttemptId, "timed-1");
  assert.equal(history[0].importedAttemptId, imported.id);
  assert.deepEqual(history[0].submissionIds, [1]);
  assert.equal(history[0].notes, original.attempts[0].notes);
  assert.equal(learningStats(data).measuredMinutes, 30);
  assert.equal(learningStats(data).assisted, 0);
  assert.equal(data.codeforces.reflections[0].outcome, "hint");
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
  assert.equal(
    learningHistory(unlinkLearningAttempts(data, "timed-1")).length,
    2,
  );
  const chooseImported = linkLearningAttempts(
    original,
    "timed-1",
    imported.id,
    "codeforces",
    now,
  );
  assert.equal(learningStats(chooseImported).assisted, 1);
  assert.equal(learningStats(chooseImported).independent, 0);
});

test("link validation rejects duplicate credit, mismatched problems, missing reflections and cross-profile links", () => {
  const original = timed(reflection(activity()));
  const imported = original.codeforces.practiceAttempts[0];
  const linked = linkLearningAttempts(
    original,
    "timed-1",
    imported.id,
    "timed",
    now,
  );
  assert.throws(
    () => linkLearningAttempts(linked, "timed-1", imported.id),
    /duplicate credit/,
  );
  assert.throws(
    () =>
      validateData({
        ...linked,
        learningLinks: [{ ...linked.learningLinks![0], handle: "other" }],
      }),
    /profile identities/,
  );
  assert.throws(
    () =>
      linkLearningAttempts(
        timed(activity()),
        "timed-1",
        imported.id,
        "codeforces",
      ),
    /Learning links/,
  );
  const other = {
    ...original,
    problems: [
      {
        ...original.problems[0],
        cfKey: "contest:4:A",
        url: "https://codeforces.com/problemset/problem/4/A",
      },
    ],
    attempts: original.attempts,
  };
  // A second personal record with another platform identity cannot be linked.
  const mismatch: Data = {
    ...original,
    problems: [
      ...original.problems,
      {
        ...other.problems[0],
        id: "other",
        cfHandle: undefined,
        cfKey: undefined,
      },
    ],
    attempts: original.attempts.map((attempt) => ({
      ...attempt,
      problemId: "other",
    })),
  };
  assert.throws(
    () => linkLearningAttempts(mismatch, "timed-1", imported.id),
    /identities/,
  );
  const malicious = {
    ...linked,
    learningLinks: [{ ...linked.learningLinks![0], linkedAt: "yesterday" }],
  };
  assert.throws(() => validateData(malicious), /Learning links/);
});

test("explicit link candidates recognize a personal Codeforces record and its imported duplicate by platform identity", () => {
  let data = timed(reflection(activity()));
  const importedProblem = data.problems[0];
  data = {
    ...data,
    problems: [
      ...data.problems,
      {
        ...importedProblem,
        id: "personal-ribbon",
        cfHandle: undefined,
        cfKey: undefined,
        reviewAttemptId: undefined,
        reviewAt: null,
        reviewManual: false,
        url: "https://codeforces.com/contest/189/problem/A",
      },
    ],
    attempts: data.attempts.map((attempt) => ({
      ...attempt,
      problemId: "personal-ribbon",
    })),
  };
  const imported = data.codeforces.practiceAttempts[0];
  assert.equal(
    possibleImportedLearningLinks(data, "timed-1")[0].id,
    imported.id,
  );
  assert.equal(possibleLearningLinks(data, imported.id)[0].id, "timed-1");
  const linked = linkLearningAttempts(
    data,
    "timed-1",
    imported.id,
    "timed",
    now,
  );
  assert.equal(learningStats(linked).practiceAttempts, 1);
  assert.deepEqual(learningHistory(linked)[0].problemIds, [
    "personal-ribbon",
    importedProblem.id,
  ]);
  assert.equal(
    problemLearningHistory(linked, importedProblem.id)[0].timedAttemptId,
    "timed-1",
  );
  assert.equal(
    problemLearningHistory(linked, "personal-ribbon")[0].importedAttemptId,
    imported.id,
  );
  assert.deepEqual(
    validateData(JSON.parse(JSON.stringify(linked))),
    validateData(linked),
  );
});

test("two tabs can link different attempts on the same handle without collapsing their identities", () => {
  let base = timed(
    timed(reflection(activity()), "hint", "timed-1"),
    "independent",
    "timed-2",
  );
  base = mergeActivity(
    base,
    "jay",
    [
      {
        handle: "jay",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 2,
            submittedAt: "2026-10-03T11:00:00.000Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:189:A",
              title: "Cut Ribbon",
              code: "189A",
              url: "https://codeforces.com/problemset/problem/189/A",
              rating: 1300,
              tags: ["dp"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  const first = base.codeforces.practiceAttempts.find((attempt) =>
    attempt.submissionIds.includes(1),
  )!;
  const second = base.codeforces.practiceAttempts.find((attempt) =>
    attempt.submissionIds.includes(2),
  )!;
  const left = linkLearningAttempts(base, "timed-1", first.id, "timed", now);
  const right = linkLearningAttempts(base, "timed-2", second.id, "timed", now);
  const merged = mergeWorkspaces(base, left, right);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data.learningLinks?.length, 2);
  assert.deepEqual(
    new Set(merged.data.learningLinks?.map((link) => link.timedAttemptId)),
    new Set(["timed-1", "timed-2"]),
  );
  assert.equal(learningStats(merged.data).practiceAttempts, 2);
  assert.equal(learningStats(merged.data).measuredMinutes, 60);
  assert.equal(merged.data.codeforces.submissions.length, 2);
});

test("pending latest activity stays distinct from an older reflection and untouched platform topic metadata", () => {
  let data = reflection(activity());
  data = mergeActivity(
    data,
    "jay",
    [
      {
        handle: "jay",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 2,
            submittedAt: "2026-10-04T12:00:00.000Z",
            verdict: "WRONG_ANSWER",
            language: "GNU C++20",
            problem: {
              key: "contest:189:A",
              title: "Cut Ribbon",
              code: "189A",
              url: "https://codeforces.com/problemset/problem/189/A",
              rating: 1300,
              tags: ["dp", "Dynamic programming"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  assert.equal(problemPracticeState(data, data.problems[0].id), "pending");
  assert.equal(latestReflection(data, data.problems[0].id)?.outcome, "hint");
  assert.equal(problemLearningHistory(data, data.problems[0].id).length, 2);
  assert.equal(learningBreakthroughs(data).length, 0);
  assert.deepEqual(data.problems[0].tags, ["dp", "Dynamic programming"]);
  assert.equal(normalizedTopic(" DP "), "dynamic programming");
  assert.equal(normalizedTopic("Array"), "arrays");
});

test("a growing multi-year imported notebook keeps complete counts, day consistency and source identities", () => {
  const data = activity();
  const problemId = data.problems[0].id;
  const start = Date.parse("2012-01-01T06:00:00.000Z");
  // Ten thousand independently recorded activity groups across nearly fourteen
  // years. Repeated topic aliases and many attempts at one problem exercise the
  // aggregation paths without a machine-dependent timing assertion.
  data.codeforces.submissions = Array.from({ length: 10000 }, (_, index) => ({
    id: index + 1,
    handle: "jay",
    problemId,
    submittedAt: new Date(start + index * 12 * 3600000).toISOString(),
    verdict: "OK",
    language: "GNU C++20",
  }));
  data.codeforces.practiceAttempts = data.codeforces.submissions.map(
    (submission) => ({
      id: `cf-attempt:jay:${submission.id}`,
      handle: "jay",
      problemId,
      submissionIds: [submission.id],
      firstSubmittedAt: submission.submittedAt,
      lastSubmittedAt: submission.submittedAt,
      inbox: false,
      skipped: false,
      wasRevisit: false,
    }),
  );
  data.codeforces.reflections = data.codeforces.practiceAttempts.flatMap(
    (attempt, index) =>
      index % 4 < 2
        ? [
            {
              attemptId: attempt.id,
              outcome:
                index % 4 === 0 ? ("hint" as const) : ("independent" as const),
              difficulty: index % 4 === 0 ? ("coding" as const) : null,
              takeaway: "Keep boundary initialization separate.",
              savedAt: attempt.lastSubmittedAt,
            },
          ]
        : [],
  );
  const validated = validateData(data);
  const stats = learningStats(validated);
  assert.equal(stats.practiceAttempts, 10000);
  assert.equal(stats.reflected, 5000);
  assert.equal(stats.pending, 5000);
  assert.equal(stats.independent, 2500);
  assert.equal(stats.assisted, 2500);
  assert.equal(stats.timedSessions, 0);
  assert.equal(stats.measuredMinutes, 0);
  assert.deepEqual(stats.topics, [
    { topic: "dynamic programming", count: 10000, reflected: 5000 },
  ]);
  assert.deepEqual(stats.difficulties, [{ difficulty: "coding", count: 2500 }]);
  assert.deepEqual(
    stats.practiceDays,
    [
      ...new Set(
        validated.codeforces.submissions.map((submission) =>
          localDate(new Date(submission.submittedAt)),
        ),
      ),
    ].sort(),
  );
  assert.equal(
    new Set(stats.history.map((record) => record.importedAttemptId)).size,
    10000,
  );
  assert.equal(learningBreakthroughs(validated).length, 1);
  const index = learningByProblem(validated).get(problemId)!;
  assert.equal(index.history.length, 10000);
  assert.equal(index.state, "pending");
  assert.equal(index.latestReflection?.outcome, "independent");
});
