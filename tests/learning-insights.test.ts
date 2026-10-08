import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  localDate,
  type Attempt,
  type Data,
  type Problem,
} from "../src/lib/model";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import { linkLearningAttempts } from "../src/lib/learning";
import {
  learningEvidenceHref,
  learningEvidenceProfile,
  learningInsights,
  memoryRecordAnchor,
} from "../src/lib/learning-insights";
import type { RevisionRecord } from "../src/lib/memory-types";

const now = new Date(2026, 9, 8, 12);
const problem = (
  id = "personal",
  code = "381A",
  overrides: Partial<Problem> = {},
): Problem => ({
  id,
  title: `Problem ${code}`,
  platform: "Codeforces",
  url: `https://codeforces.com/problemset/problem/${code.match(/^\d+/)?.[0]}/${code.replace(/^\d+/, "")}`,
  problemCode: code,
  tags: [],
  rating: null,
  createdAt: new Date(2026, 9, 1, 12).toISOString(),
  reviewAt: null,
  reviewCount: 0,
  ...overrides,
});
const attempt = (
  id: string,
  outcome: Attempt["outcome"],
  day = 7,
  overrides: Partial<Attempt> = {},
): Attempt => ({
  id,
  problemId: "personal",
  startedAt: new Date(2026, 9, day, 12).toISOString(),
  completedAt: new Date(2026, 9, day, 12, 10).toISOString(),
  elapsedMs: 600000,
  outcome,
  difficulty: null,
  takeaway: "",
  notes: "",
  ...overrides,
});
const revision = (
  id: string,
  nextReviewAt = "2026-10-08",
  overrides: Partial<RevisionRecord> = {},
): RevisionRecord => ({
  id,
  problemId: "personal",
  handle: null,
  activity: "explain",
  outcome: "cue",
  response: "Keep a shrinking interval.",
  cue: "Which choices remain?",
  completedAt: new Date(2026, 9, 7, 13).toISOString(),
  nextReviewAt,
  ...overrides,
});
function imported(data: Data, handle = "jay", id = 1) {
  return mergeActivity(
    connectProfile(data, { handle, rating: null, rank: null }, now),
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id,
            submittedAt: new Date(2026, 9, 6, 12).toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              title: "Sereja and Dima",
              code: "381A",
              url: problem().url,
              rating: 800,
              tags: ["dp", "dynamic programming"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
}

test("sparse learning evidence does not become a weakness or invented outcome", () => {
  const fresh = learningInsights(
    emptyData(),
    "2026-10-01",
    "2026-10-08",
    {},
    now,
  );
  assert.deepEqual(fresh.history, []);
  assert.deepEqual(fresh.mistakes, []);
  assert.deepEqual(fresh.transitions, []);
  assert.deepEqual(fresh.limitedTopics, []);
  assert.deepEqual(fresh.dueCoding, []);
  assert.deepEqual(fresh.dueRecall, []);
  const tagged = learningInsights(
    {
      ...emptyData(),
      problems: [
        problem("personal", "381A", { tags: ["dp", "dynamic programming"] }),
      ],
    },
    "2026-10-01",
    "2026-10-08",
    {},
    now,
  );
  assert.equal(tagged.limitedTopics.length, 1);
  assert.equal(tagged.limitedTopics[0].topic, "dynamic programming");
  assert.equal(tagged.limitedTopics[0].records.length, 0);
  assert.equal(tagged.limitedTopics[0].problems.length, 1);
});

test("repeated mistakes require two explicit reflected coding records within the selected local dates", () => {
  const data = {
    ...emptyData(),
    problems: [problem()],
    attempts: [
      attempt("first", "hint", 6, { mistakes: ["edges"] }),
      attempt("second", "unsolved", 7, { mistakes: ["edges", "indexing"] }),
      attempt("outside", "hint", 1, { mistakes: ["indexing"] }),
    ],
  };
  const observations = learningInsights(
    data,
    "2026-10-06",
    "2026-10-07",
    {},
    now,
  );
  assert.deepEqual(
    observations.mistakes.map((item) => [item.category, item.records.length]),
    [["edges", 2]],
  );
  assert.equal(
    learningInsights(data, "2026-10-07", "2026-10-07", {}, now).mistakes.length,
    0,
  );
});

test("explicit linked sources receive one mistake credit and one normalized tagged coding event", () => {
  let data = imported({
    ...emptyData(),
    problems: [problem("personal", "381A", { tags: ["graphs"] })],
    attempts: [attempt("timed", "hint", 6, { mistakes: ["edges"] })],
  });
  const activity = data.codeforces.practiceAttempts[0];
  data = saveQuickReflection(
    data,
    activity.id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "",
      mistakes: ["edges"],
      reviewAt: null,
      overrideSchedule: false,
    },
    now,
  );
  data = linkLearningAttempts(data, "timed", activity.id, "timed", now);
  const insights = learningInsights(data, "2026-10-01", "2026-10-08", {}, now);
  assert.equal(insights.history.length, 1);
  assert.equal(insights.mistakes.length, 0);
  assert.deepEqual(
    insights.limitedTopics.map(({ topic, records }) => [topic, records.length]),
    [
      ["dynamic programming", 1],
      ["graphs", 1],
    ],
  );
  assert.equal(insights.limitedTopics[0].records[0].source, "linked");
});

test("independent-after-assistance links actual earlier assistance even outside the range, never acceptance or an unsolved record", () => {
  const data = {
    ...emptyData(),
    problems: [problem()],
    attempts: [
      attempt("assisted", "editorial", 1),
      attempt("independent", "independent", 7),
    ],
  };
  const insights = learningInsights(data, "2026-10-07", "2026-10-08", {}, now);
  assert.equal(insights.transitions.length, 1);
  assert.equal(insights.transitions[0].assisted.id, "timed:assisted");
  assert.equal(insights.transitions[0].independent.id, "timed:independent");
  assert.equal(insights.history.length, 1);
  assert.equal(
    learningInsights(
      {
        ...data,
        attempts: [
          attempt("unsolved", "unsolved", 1),
          attempt("independent", "independent", 7),
        ],
      },
      "2026-10-07",
      "2026-10-08",
      {},
      now,
    ).transitions.length,
    0,
  );
  const accepted = imported(emptyData());
  const pending = learningInsights(
    accepted,
    "2026-10-01",
    "2026-10-08",
    {},
    now,
  );
  assert.equal(pending.history[0].accepted, true);
  assert.equal(pending.history[0].outcome, null);
  assert.equal(pending.transitions.length, 0);
});

test("due coding and recall use separate shared dates and skip, defer, archive and current-profile boundaries", () => {
  let data = imported(
    imported(
      { ...emptyData(), problems: [problem()], revisions: [revision("due")] },
      "alex",
      2,
    ),
    "jay",
  );
  data = {
    ...data,
    problems: data.problems.map((item) =>
      item.cfHandle === "jay"
        ? {
            ...item,
            reviewAt: "2026-10-12",
            reviewManual: true,
            reviewUpdatedAt: now.toISOString(),
          }
        : item,
    ),
  };
  let insights = learningInsights(data, "2026-10-01", "2026-10-08", {}, now);
  assert.equal(insights.dueCoding.length, 0);
  assert.equal(insights.dueRecall.length, 1);
  const both = {
    ...data,
    problems: data.problems.map((item) =>
      item.cfHandle === "jay" ? { ...item, reviewAt: "2026-10-08" } : item,
    ),
  };
  insights = learningInsights(both, "2026-10-01", "2026-10-08", {}, now);
  assert.equal(insights.dueCoding.length, 1);
  assert.equal(insights.dueRecall.length, 1);
  assert.equal(insights.dueCoding[0].identity, insights.dueRecall[0].identity);
  assert.equal(insights.dueCoding[0].problem.cfHandle, "jay");
  for (const restriction of [
    { skippedOn: "2026-10-08" },
    { deferredUntil: "2026-10-09" },
    { archived: true },
  ]) {
    const blocked = {
      ...both,
      problems: both.problems.map((item) =>
        item.id === "personal" ? { ...item, ...restriction } : item,
      ),
    };
    const excluded = learningInsights(
      blocked,
      "2026-10-01",
      "2026-10-08",
      {},
      now,
    );
    assert.equal(excluded.dueCoding.length, 0);
    assert.equal(excluded.dueRecall.length, 0);
  }
  assert.equal(
    learningInsights(both, "2026-10-01", "2026-10-08", { handle: null }, now)
      .dueCoding.length,
    0,
  );
});

test("recall outcomes remain separate, scope archived profiles explicitly, and add no coding time or attempt", () => {
  let data = imported(
    imported({ ...emptyData(), problems: [problem()] }, "alex", 2),
    "jay",
  );
  data = {
    ...data,
    revisions: [
      revision("alex-check", "2026-10-08", {
        handle: "alex",
        outcome: "independent",
      }),
      revision("jay-check", "2026-10-10", {
        handle: "jay",
        outcome: "unrecalled",
      }),
    ],
  };
  const snapshot = JSON.stringify(data);
  const current = learningInsights(data, "2026-10-07", "2026-10-08", {}, now);
  assert.equal(current.history.length, 0);
  assert.equal(current.revisions.length, 1);
  assert.deepEqual(current.recallOutcomes, {
    independent: 0,
    cue: 0,
    unrecalled: 1,
  });
  assert.equal(current.dueRecall.length, 0);
  const archived = learningInsights(
    data,
    "2026-10-07",
    "2026-10-08",
    { handle: "alex" },
    now,
  );
  assert.deepEqual(archived.recallOutcomes, {
    independent: 1,
    cue: 0,
    unrecalled: 0,
  });
  assert.equal(archived.dueRecall.length, 1);
  assert.equal(JSON.stringify(data), snapshot);
});

test("history ranges include both local calendar days while due schedules use the distinct as-of date", () => {
  const data = {
    ...emptyData(),
    problems: [
      problem("personal", "381A", {
        reviewAt: "2026-10-08",
        reviewManual: true,
      }),
    ],
    attempts: [
      attempt("midnight", "hint", 7, {
        completedAt: new Date(2026, 9, 7, 0, 0).toISOString(),
      }),
      attempt("end", "unsolved", 7, {
        completedAt: new Date(2026, 9, 7, 23, 59).toISOString(),
      }),
    ],
  };
  const insights = learningInsights(data, "2026-10-07", "2026-10-07", {}, now);
  assert.equal(insights.history.length, 2);
  assert.equal(insights.asOf, localDate(now));
  assert.equal(insights.dueCoding.length, 1);
});

test("same-time revision evidence uses the shared schedule's stable ID tie-break", () => {
  const revisions = [revision("Z-check"), revision("a-check")];
  const data = { ...emptyData(), problems: [problem()], revisions };
  const insights = learningInsights(data, "2026-10-07", "2026-10-08", {}, now);
  assert.equal(insights.dueRecall.length, 1);
  assert.equal(
    insights.dueRecall[0].record?.id,
    [...revisions].sort((a, b) => a.id.localeCompare(b.id))[0].id,
  );
});

test("evidence links preserve exact IDs and validate explicit profile views without selecting a connected profile", () => {
  const data = imported(emptyData(), "Jay");
  assert.deepEqual(learningEvidenceProfile(data, "JAY"), {
    valid: true,
    handle: "Jay",
  });
  assert.deepEqual(learningEvidenceProfile(data, ""), {
    valid: true,
    handle: null,
  });
  assert.deepEqual(learningEvidenceProfile(data, "//unknown"), {
    valid: false,
    handle: undefined,
  });
  const id = "timed:original / % record";
  const href = new URL(
    learningEvidenceHref("problem / %", "practice", id, "Jay"),
    "https://forma.local",
  );
  assert.equal(
    decodeURIComponent(href.pathname.split("/").at(-1)!),
    "problem / %",
  );
  assert.equal(href.searchParams.get("profile"), "Jay");
  assert.equal(
    decodeURIComponent(href.hash.slice(1)),
    memoryRecordAnchor("practice", id),
  );
  assert.equal(data.codeforces.connectedHandle, "Jay");
});
