import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  localDate,
  validateData,
  type Data,
  type Problem,
} from "../src/lib/model";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import {
  createContest,
  startContest,
  endContest,
  editContest,
  reconcileContests,
} from "../src/lib/contest-lab";
import {
  learningHistory,
  learningStats,
  learningParticipationDays,
  linkLearningAttempts,
} from "../src/lib/learning";
import { problemMemory, memoryPeriod, saveRevision } from "../src/lib/memory";
import {
  learningInsights,
  learningEvidenceHref,
  memoryRecordAnchor,
} from "../src/lib/learning-insights";
import { practiceCandidates, practicePlanView } from "../src/lib/practice-plan";
import { importTrack, trackEntryProgress } from "../src/lib/tracks";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";
import type { SubmissionInput } from "../src/lib/codeforces-types";

const start = new Date("2026-10-08T06:30:00.000Z");
const end = new Date("2026-10-08T06:40:00.000Z");
function problem(code = "4A"): Problem {
  return {
    id: `personal-${code}`,
    title: `Problem ${code}`,
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/4/${code.slice(1)}`,
    problemCode: code,
    rating: 800,
    tags: ["implementation"],
    createdAt: "2026-09-01T06:30:00.000Z",
    reviewAt: null,
    reviewCount: 0,
  };
}
function finished(
  data: Data = { ...emptyData(), problems: [problem(), problem("4B")] },
  id = "learning-contest",
  at = start,
): Data {
  return endContest(
    startContest(
      createContest(
        data,
        id,
        "Evidence contest",
        30,
        data.problems.filter((item) => !item.cfHandle),
        false,
        "manual",
        at,
      ),
      id,
      at,
    ),
    id,
    "early",
    new Date(at.getTime() + 600000),
  );
}
function confirmed(
  data = finished(),
  savedAt = new Date(end.getTime() + 60000),
): Data {
  return editContest(data, data.contests!.at(-1)!.id, (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      reflection: {
        outcome: "independent",
        difficulty: "edges",
        mistakes: ["edges"],
        takeaway: "Keep the boundary explicit.",
        savedAt: savedAt.toISOString(),
      },
    })),
  }));
}

function imported(
  data: Data,
  submissions: Pick<SubmissionInput, "id" | "submittedAt" | "verdict">[],
): Data {
  const handle = data.codeforces.connectedHandle!;
  return mergeActivity(
    data,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: submissions.map((submission) => ({
          ...submission,
          language: "GNU C++20",
          problem: {
            key: "contest:4:A",
            code: "4A",
            title: "Problem 4A",
            url: problem().url,
            rating: 800,
            tags: ["implementation"],
          },
        })),
      },
    ],
    "refresh",
    end,
  );
}
function quick(data: Data): Data {
  return saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "independent",
      difficulty: "edges",
      mistakes: ["edges"],
      takeaway: "Imported reflection.",
      reviewAt: null,
      overrideSchedule: false,
    },
    new Date(end.getTime() + 300000),
  );
}

test("confirmed contest-only reflections enter shared Memory and Progress without fabricating regular attempts or minutes", () => {
  const data = confirmed();
  const records = learningHistory(data);
  assert.equal(records.length, 2);
  assert.equal(records[0].source, "contest");
  assert.equal(records[0].outcome, "independent");
  assert.equal(records[0].elapsedMs, null);
  assert.equal(records[0].timedAttemptId, null);
  assert.equal(
    problemMemory(data, problem().id).summary.latestReflection?.outcome,
    "independent",
  );
  const stats = learningStats(data);
  assert.equal(stats.independent, 2);
  assert.equal(stats.measuredMinutes, 0);
  assert.equal(stats.timedSessions, 0);
  assert.equal(data.attempts.length, 0);
  assert.deepEqual(records[0].contestSource, {
    contestId: data.contests![0].id,
    problemId: data.contests![0].problems[0].id,
    name: "Evidence contest",
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    importedAttemptIds: [],
  });
  const event = problemMemory(data, problem().id).timeline[0];
  assert.equal(event.id, records[0].id);
  const href = learningEvidenceHref(
    problem().id,
    "practice",
    records[0].id,
    null,
  );
  assert.equal(
    decodeURIComponent(new URL(href, "https://forma.test").hash.slice(1)),
    memoryRecordAnchor("practice", records[0].id),
  );
});

test("the same explicit label on two confirmed contest reflections supports one repeated-label observation", () => {
  const data = confirmed();
  const insights = learningInsights(data, "2026-10-08", "2026-10-08", {}, end);
  assert.deepEqual(
    insights.mistakes.map((item) => [item.category, item.records.length]),
    [["edges", 2]],
  );
  assert.deepEqual(memoryPeriod(data, "2026-10-08", "2026-10-08").mistakes, [
    { category: "edges", count: 2 },
  ]);
});

test("unfinished drafts and a solved status record participation without claiming independent understanding", () => {
  const data = editContest(finished(), "learning-contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row, index) =>
      index === 0
        ? {
            ...row,
            status: "marked-solved",
            reflectionDraft: {
              outcome: "independent",
              difficulty: null,
              takeaway: "Unconfirmed text",
              mistakes: ["edges"],
              savedAt: new Date(end.getTime() + 60000).toISOString(),
            },
          }
        : row,
    ),
  }));
  const records = learningHistory(data);
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, null);
  assert.equal(learningStats(data).independent, 0);
  assert.equal(
    problemMemory(data, problem().id).summary.latestReflection,
    null,
  );
  assert.deepEqual(memoryPeriod(data, "2026-10-08", "2026-10-08").mistakes, []);
});

test("fully overlapping imported contest submissions support one shared event while original imported records remain", () => {
  let data = confirmed(
    finished(
      connectProfile(
        { ...emptyData(), problems: [problem(), problem("4B")] },
        { handle: "evidence_user", rating: null, rank: null },
        start,
      ),
    ),
  );
  data = reconcileContests(
    mergeActivity(
      data,
      "evidence_user",
      [
        {
          handle: "evidence_user",
          from: 1,
          count: 50,
          submissions: [
            {
              id: 1,
              submittedAt: "2026-10-08T06:35:00.000Z",
              verdict: "OK",
              language: "GNU C++20",
              problem: {
                key: "contest:4:A",
                code: "4A",
                title: "Problem 4A",
                url: problem().url,
                rating: 800,
                tags: ["implementation"],
              },
            },
          ],
        },
      ],
      "refresh",
      end,
    ),
    end,
  );
  const records = learningHistory(data);
  assert.equal(records.length, 2);
  assert.equal(
    records.filter((record) => record.source === "codeforces").length,
    0,
  );
  assert.equal(records.filter((record) => record.accepted === true).length, 1);
  assert.equal(data.codeforces.practiceAttempts.length, 1);
  assert.equal(data.codeforces.submissions.length, 1);
  assert.equal(data.attempts.length, 0);
  const period = memoryPeriod(data, "2026-10-08", "2026-10-08");
  assert.equal(period.contestEvents, 2);
  assert.equal(period.importedActivity, 0);
  assert.equal(period.measuredMinutes, 0);
  assert.deepEqual(
    records.flatMap((record) => record.submissionIds),
    [1],
  );
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
  validateData(data);
});

test("old contest reflection edits do not become new practice while current and archived contest scopes stay separate", () => {
  const oldStart = new Date("2026-09-28T06:30:00.000Z");
  let data = confirmed(
    finished(
      connectProfile(
        { ...emptyData(), problems: [problem(), problem("4B")] },
        { handle: "older_user", rating: null, rank: null },
        oldStart,
      ),
      "old-contest",
      oldStart,
    ),
    end,
  );
  data = connectProfile(
    data,
    { handle: "current_user", rating: null, rank: null },
    start,
  );
  assert.equal(learningHistory(data).length, 0);
  assert.equal(learningHistory(data, { handle: "older_user" }).length, 2);
  assert.equal(
    memoryPeriod(data, "2026-10-08", "2026-10-08", { handle: "older_user" })
      .history.length,
    0,
  );
  assert.deepEqual(learningStats(data, { handle: "older_user" }).practiceDays, [
    "2026-09-28",
  ]);
  data = confirmed(finished(data, "today-contest"));
  assert.deepEqual(learningStats(data).practiceDays, ["2026-10-08"]);
});

test("Today describes confirmed contest practice as familiar and links the exact source, while retaining independent coding and recall schedules", () => {
  let data = confirmed();
  data = {
    ...data,
    problems: data.problems.map((row) => ({ ...row, reviewAt: "2026-10-08" })),
  };
  data = saveRevision(data, {
    id: "real-recall",
    problemId: problem().id,
    handle: null,
    activity: "explain",
    outcome: "cue",
    response: "Remember the invariant.",
    cue: "Boundary.",
    completedAt: "2026-10-07T06:30:00.000Z",
    nextReviewAt: "2026-10-08",
  });
  const candidates = practiceCandidates(data, end);
  const coding = candidates.find(
    (candidate) =>
      candidate.problem.id === problem().id && candidate.kind === "coding",
  )!;
  assert.ok(coding);
  assert.equal(coding.relatedRecallAt, "2026-10-08");
  assert.equal(
    coding.evidence.find((evidence) => evidence.type === "contest")?.recordId,
    learningHistory(data).find((record) => record.problemId === problem().id)!
      .id,
  );
  assert.equal(
    coding.evidence.find((evidence) => evidence.type === "contest")?.day,
    "2026-10-08",
  );
  assert.ok(candidates.some((candidate) => candidate.kind === "recall"));
  const unscheduled = {
    ...data,
    problems: data.problems.map((row) => ({ ...row, reviewAt: null })),
    revisions: [],
  };
  const collection = practiceCandidates(unscheduled, end).find(
    (candidate) => candidate.problem.id === problem().id,
  )!;
  assert.match(collection.reason, /familiar/i);
  assert.doesNotMatch(collection.reason, /untouched/i);
});

test("actual contest participation today removes a stale return-after-break prompt, but editing an old contest reflection does not", () => {
  const oldStart = new Date("2026-09-28T06:30:00.000Z");
  const old = confirmed(finished(undefined, "old-practice", oldStart), end);
  assert.equal(practicePlanView(old, end).restart?.days, 10);
  const today = finished(old, "today-participation");
  assert.equal(
    learningHistory(today).length,
    2,
    "untouched rows do not invent problem attempts",
  );
  assert.equal(practicePlanView(today, end).restart, null);
  assert.deepEqual(learningParticipationDays(today), [
    "2026-09-28",
    "2026-10-08",
  ]);
});

test("draft-only contest rows remain unconfirmed and automatic expiry never invents a next-day return", () => {
  const at = new Date(2026, 9, 7, 23, 50);
  let data = startContest(
    createContest(
      { ...emptyData(), problems: [problem()] },
      "expired",
      "Late start",
      30,
      [problem()],
      false,
      "manual",
      at,
    ),
    "expired",
    at,
  );
  data = editContest(data, "expired", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({ ...row, status: "working" })),
  }));
  data = reconcileContests(data, new Date(at.getTime() + 2 * 86400000));
  const record = learningHistory(data)[0];
  assert.equal(record.completedAt, at.toISOString());
  assert.equal(record.outcome, null);
  assert.deepEqual(learningParticipationDays(data), [localDate(at)]);
  const draft = editContest(finished(), "learning-contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      reflectionDraft: {
        outcome: "independent",
        difficulty: null,
        takeaway: "Unconfirmed",
        savedAt: end.toISOString(),
      },
    })),
  }));
  assert.deepEqual(learningHistory(draft), []);
  assert.equal(
    problemMemory(draft, problem().id).summary.latestReflection,
    null,
  );
});

test("an import group spanning the contest preserves later outside activity and its original reflection without counting any submission twice", () => {
  let data = confirmed(
    finished(
      connectProfile(
        { ...emptyData(), problems: [problem(), problem("4B")] },
        { handle: "evidence_user", rating: null, rank: null },
        start,
      ),
    ),
  );
  data = quick(
    imported(data, [
      {
        id: 1,
        submittedAt: "2026-10-08T06:29:00.000Z",
        verdict: "WRONG_ANSWER",
      },
      {
        id: 2,
        submittedAt: "2026-10-08T06:35:00.000Z",
        verdict: "WRONG_ANSWER",
      },
      { id: 3, submittedAt: "2026-10-08T06:42:00.000Z", verdict: "OK" },
    ]),
  );
  assert.equal(data.codeforces.practiceAttempts.length, 1);
  const records = learningHistory(data);
  const outside = records.find((record) => record.source === "codeforces")!;
  const contest = records.find(
    (record) =>
      record.source === "contest" && record.problemId === problem().id,
  )!;
  assert.deepEqual(outside.submissionIds, [1, 3]);
  assert.equal(outside.completedAt, "2026-10-08T06:42:00.000Z");
  assert.equal(outside.takeaway, "Imported reflection.");
  assert.deepEqual(contest.submissionIds, [2]);
  assert.equal(contest.takeaway, "Keep the boundary explicit.");
  assert.deepEqual(
    records.flatMap((record) => record.submissionIds).sort(),
    [1, 2, 3],
  );
  assert.deepEqual(
    data.codeforces.practiceAttempts[0].submissionIds,
    [1, 2, 3],
  );
  assert.equal(
    memoryPeriod(data, "2026-10-08", "2026-10-08").importedActivity,
    1,
  );
});

test("an imported quick reflection follows its final submission into the contest, leaving earlier outside failures unassessed", () => {
  let data = finished(
    connectProfile(
      { ...emptyData(), problems: [problem()] },
      { handle: "evidence_user", rating: null, rank: null },
      start,
    ),
  );
  data = quick(
    imported(data, [
      {
        id: 1,
        submittedAt: "2026-10-08T06:29:00.000Z",
        verdict: "WRONG_ANSWER",
      },
      { id: 2, submittedAt: "2026-10-08T06:35:00.000Z", verdict: "OK" },
    ]),
  );
  const records = learningHistory(data);
  const outside = records.find((record) => record.source === "codeforces")!;
  const contest = records.find((record) => record.source === "contest")!;
  assert.deepEqual(outside.submissionIds, [1]);
  assert.equal(outside.outcome, null);
  assert.equal(outside.accepted, false);
  assert.equal(outside.mistakes, undefined);
  assert.equal(contest.outcome, "independent");
  assert.equal(contest.reflectionSource, "codeforces");
  assert.equal(learningStats(data).independent, 1);
  assert.deepEqual(memoryPeriod(data, "2026-10-08", "2026-10-08").mistakes, [
    { category: "edges", count: 1 },
  ]);
});

test("explicit timed-import links preserve their selected reflection and real measured time alongside separate native contest reflection", () => {
  let data = confirmed(
    finished(
      connectProfile(
        { ...emptyData(), problems: [problem()] },
        { handle: "evidence_user", rating: null, rank: null },
        start,
      ),
    ),
  );
  data = imported(data, [
    { id: 1, submittedAt: "2026-10-08T06:35:00.000Z", verdict: "OK" },
  ]);
  data = {
    ...data,
    attempts: [
      {
        id: "real-timed",
        problemId: problem().id,
        startedAt: start.toISOString(),
        completedAt: "2026-10-08T06:35:00.000Z",
        elapsedMs: 300000,
        outcome: "editorial",
        difficulty: "approach",
        takeaway: "Explicit timed source wins.",
        notes: "Real timer.",
      },
    ],
  };
  data = linkLearningAttempts(
    data,
    "real-timed",
    data.codeforces.practiceAttempts[0].id,
    "timed",
    end,
  );
  const records = learningHistory(data);
  const linked = records.find((record) => record.source === "linked")!;
  const contest = records.find((record) => record.source === "contest")!;
  assert.equal(linked.outcome, "editorial");
  assert.equal(linked.elapsedMs, 300000);
  assert.deepEqual(linked.submissionIds, [1]);
  assert.deepEqual(contest.submissionIds, []);
  assert.equal(contest.accepted, null);
  assert.equal(contest.reflectionSource, "contest");
  assert.equal(learningStats(data).measuredMinutes, 5);
  validateData(decodeBackup(encodeBackup(data)));
});

test("track progress recognizes confirmed contest understanding but keeps a solved checkbox separate", () => {
  const data = importTrack(
    confirmed(),
    {
      id: "contest-track",
      title: "Contest practice",
      sourceName: "manual",
      sourceFingerprint: "contest-learning",
      stages: [
        {
          id: "contest-stage",
          title: "Foundation",
          description: "",
          suggestedTime: "",
          entries: [
            {
              id: "contest-entry",
              title: "Problem 4A",
              code: "4A",
              url: problem().url,
              rating: 800,
              pattern: "",
            },
          ],
        },
      ],
    },
    undefined,
    end,
  );
  const entry = data.trackEntries![0];
  const progress = trackEntryProgress(data, entry, end);
  assert.equal(progress.attempted, true);
  assert.equal(progress.independent, true);
  assert.equal(progress.accepted, false);
  assert.equal(progress.measuredMinutes, 0);
  const pending = editContest(data, "learning-contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      reflection: undefined,
      status: "marked-solved",
    })),
  }));
  assert.equal(trackEntryProgress(pending, entry, end).attempted, true);
  assert.equal(trackEntryProgress(pending, entry, end).independent, false);
  assert.equal(trackEntryProgress(pending, entry, end).reflected, false);
});
