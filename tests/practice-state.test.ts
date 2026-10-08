import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  suggestion,
  completeRevisit,
  rescheduleProblem,
  skipRecommendation,
  deferProblem,
  reviewQueue,
  type Data,
} from "../src/lib/model";
import {
  importTrack,
  nextTrackEntry,
  trackEntryProgress,
  trackProblem,
} from "../src/lib/tracks";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import { todayPractice } from "../src/lib/today-practice";
import { sharedPracticeState, revisitItems } from "../src/lib/practice-state";
import { withPracticeSession } from "../src/lib/practice-session";
import { linkLearningAttempts } from "../src/lib/learning";
import type { TrackImportDraft } from "../src/lib/tracks-types";
const now = new Date("2026-10-07T12:00:00Z");
const draft: TrackImportDraft = {
  id: "sheet",
  title: "Two pointers",
  sourceName: "sheet.docx",
  sourceFingerprint: "source",
  stages: [
    {
      id: "stage",
      title: "Foundation",
      description: "",
      suggestedTime: "",
      entries: [
        {
          id: "entry",
          title: "Sereja and Dima",
          url: "",
          code: "381A",
          rating: 800,
          pattern: "",
        },
      ],
    },
  ],
};
function sync(data: Data, handle = "tourist") {
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
            id: 100,
            submittedAt: "2026-10-06T12:00:00Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              title: "Sereja and Dima",
              code: "381A",
              url: "https://codeforces.com/problemset/problem/381/A",
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
function reflected(sheetFirst: boolean): Data {
  let data = sheetFirst
    ? sync(importTrack(emptyData(), draft, { duplicates: "reject" }, now))
    : importTrack(sync(emptyData()), draft, { duplicates: "reject" }, now);
  const attempt = data.codeforces.practiceAttempts[0];
  data = saveQuickReflection(
    data,
    attempt.id,
    {
      outcome: "hint",
      difficulty: "approach",
      takeaway: "Watch the remaining interval",
      reviewAt: "2026-10-12",
      overrideSchedule: true,
    },
    now,
  );
  return { ...data, activeTrackId: "sheet" };
}
for (const sheetFirst of [true, false])
  test(`381A future schedule cannot be bypassed: sheet ${sheetFirst ? "before" : "after"} sync`, () => {
    const data = reflected(sheetFirst),
      entry = data.trackEntries![0];
    assert.equal(trackEntryProgress(data, entry, now).reviewAt, "2026-10-12");
    assert.equal(nextTrackEntry(data, "sheet", now), null);
    assert.equal(nextTrackEntry(data, "sheet", now, "stage"), null);
    assert.equal(todayPractice(data, now), null);
    assert.equal(suggestion(data, now), null);
    const due = new Date("2026-10-12T12:00:00Z");
    const next = nextTrackEntry(data, "sheet", due)!;
    assert.equal(next.entry.id, "entry");
    assert.equal(next.revisit, true);
    assert.equal(todayPractice(data, due)?.problem.id, next.problem.id);
    assert.equal(suggestion(data, due)?.problem.id, next.problem.id);
    const manual = trackProblem(data, entry, now);
    assert.equal(
      withPracticeSession(data, manual.problem, 15, now.getTime(), "manual")
        .session?.problemId,
      manual.problem.id,
    );
    assert.equal(data.codeforces.submissions.length, 1);
  });
test("shared skip and future deferral block all automatic coding sources", () => {
  let data = reflected(true);
  const personal = data.problems.find((p) => !p.cfHandle)!;
  data = rescheduleProblem(
    data,
    data.codeforces.practiceAttempts[0].problemId,
    "2026-10-07",
    now,
  );
  for (const blocked of [
    skipRecommendation(data, personal.id, now),
    deferProblem(data, personal.id, "2026-10-09"),
  ]) {
    assert.equal(nextTrackEntry(blocked, "sheet", now), null);
    assert.equal(todayPractice(blocked, now), null);
    assert.equal(suggestion(blocked, now), null);
  }
  const tomorrow = new Date("2026-10-08T12:00:00Z");
  assert.ok(
    nextTrackEntry(
      skipRecommendation(data, personal.id, now),
      "sheet",
      tomorrow,
    ),
  );
});
test("deliberate latest manual coding date and completion win without rewriting either record", () => {
  let data = reflected(true);
  const personal = data.problems.find((p) => !p.cfHandle)!;
  const original = data.problems.find((p) => p.cfHandle)!;
  data = rescheduleProblem(
    data,
    personal.id,
    "2026-10-14",
    new Date("2026-10-08T12:00:00Z"),
  );
  assert.equal(sharedPracticeState(data, original, now).codingAt, "2026-10-14");
  assert.equal(reviewQueue(data)[0].id, personal.id);
  data = completeRevisit(data, personal.id, new Date("2026-10-09T12:00:00Z"));
  assert.equal(sharedPracticeState(data, original, now).codingAt, null);
  assert.equal(
    data.problems.find((p) => p.id === original.id)?.reviewAt,
    "2026-10-12",
  );
});
test("profile switching excludes unrelated schedule and learning evidence", () => {
  const data = reflected(true);
  const switched = connectProfile(
    data,
    { handle: "second", rating: null, rank: null },
    now,
  );
  const entry = switched.trackEntries![0];
  assert.equal(trackEntryProgress(switched, entry, now).reflected, false);
  assert.equal(trackEntryProgress(switched, entry, now).reviewAt, null);
  assert.equal(nextTrackEntry(switched, "sheet", now)?.entry.id, entry.id);
  assert.equal(reviewQueue(switched).length, 0);
  assert.equal(nextTrackEntry(data, "sheet", now), null);
});
test("written recall due does not turn a future coding date into an early coding recommendation", () => {
  const data = reflected(true),
    problem = data.problems.find((p) => !p.cfHandle)!;
  data.revisions = [
    {
      id: "recall",
      problemId: problem.id,
      handle: "tourist",
      activity: "complexity",
      outcome: "cue",
      response: "O(n)",
      cue: "",
      completedAt: now.toISOString(),
      nextReviewAt: "2026-10-07",
    },
  ];
  assert.equal(nextTrackEntry(data, "sheet", now), null);
  assert.equal(todayPractice(data, now)?.activity, "complexity");
  assert.equal(revisitItems(data, now)[0].codingAt, "2026-10-12");
  assert.equal(revisitItems(data, now)[0].recallAt, "2026-10-07");
  assert.equal(suggestion(data, now), null);
});
test("a linked personal timed schedule follows its profile while later notebook choices stay personal", () => {
  let data = sync(
    importTrack(emptyData(), draft, { duplicates: "reject" }, now),
  );
  const personal = data.problems.find((p) => !p.cfHandle)!;
  data = {
    ...data,
    activeTrackId: "sheet",
    problems: data.problems.map((p) =>
      p.id === personal.id
        ? {
            ...p,
            reviewAt: "2026-10-12",
            reviewUpdatedAt: now.toISOString(),
            reviewManual: false,
          }
        : p,
    ),
    attempts: [
      {
        id: "personal-timed",
        problemId: personal.id,
        startedAt: "2026-10-07T11:50:00.000Z",
        completedAt: now.toISOString(),
        elapsedMs: 600000,
        outcome: "hint",
        difficulty: null,
        takeaway: "",
        notes: "",
      },
    ],
  };
  data = linkLearningAttempts(
    data,
    "personal-timed",
    data.codeforces.practiceAttempts[0].id,
    "timed",
    now,
  );
  assert.equal(sharedPracticeState(data, personal, now).codingAt, "2026-10-12");
  assert.equal(nextTrackEntry(data, "sheet", now), null);
  let second = connectProfile(
    data,
    { handle: "second", rating: null, rank: null },
    now,
  );
  assert.equal(sharedPracticeState(second, personal, now).codingAt, null);
  assert.equal(
    trackEntryProgress(second, second.trackEntries![0], now).reflected,
    false,
  );
  assert.equal(reviewQueue(second).length, 0);
  assert.equal(suggestion(second, now)?.problem.reviewAt, null);
  assert.equal(todayPractice(second, now)?.problem.id, personal.id);
  second = rescheduleProblem(
    second,
    personal.id,
    "2026-10-15",
    new Date("2026-10-08T12:00:00Z"),
  );
  assert.equal(
    sharedPracticeState(second, personal, now).codingAt,
    "2026-10-15",
  );
  assert.equal(nextTrackEntry(second, "sheet", now), null);
});
