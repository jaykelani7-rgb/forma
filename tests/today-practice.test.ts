import test from "node:test";
import assert from "node:assert/strict";
import { emptyData, localDate, validateData } from "../src/lib/model";
import type { Data, Problem } from "../src/lib/model";
import { importTrack, trackContextForEntry } from "../src/lib/tracks";
import { todayPractice } from "../src/lib/today-practice";
import { withPracticeSession } from "../src/lib/practice-session";
import { connectProfile, mergeActivity } from "../src/lib/codeforces";

const now = new Date("2026-10-07T12:00:00.000Z");
const manual = (id: string): Problem => ({
  id,
  title: id,
  platform: "LeetCode",
  url: "",
  problemCode: "",
  tags: ["arrays"],
  rating: null,
  createdAt: now.toISOString(),
  reviewAt: null,
  reviewCount: 0,
});
function track(base = emptyData()): Data {
  return importTrack(
    base,
    {
      id: "active-track",
      title: "Two Pointers",
      sourceName: "practice.docx",
      sourceFingerprint: "today-sheet",
      stages: [
        {
          id: "foundation",
          title: "Foundation",
          description: "Build invariants.",
          suggestedTime: "20 minutes",
          entries: ["4A", "5A"].map((code, index) => ({
            id: `entry-${index}`,
            title: `Track problem ${index + 1}`,
            url: "",
            code,
            rating: 1200,
            pattern: "Hidden hint",
          })),
        },
      ],
    },
    undefined,
    now,
  );
}
function complete(
  data: Data,
  problemId: string,
  outcome: "independent" | "hint" = "independent",
): Data {
  return {
    ...data,
    attempts: [
      ...data.attempts,
      {
        id: `timed-${data.attempts.length}`,
        problemId,
        startedAt: "2026-10-07T11:30:00.000Z",
        completedAt: now.toISOString(),
        elapsedMs: 1800000,
        outcome,
        difficulty: null,
        takeaway: "Maintain the invariant.",
        notes: "",
      },
    ],
  };
}

test("an active session takes priority over due revisits and active track ordering, with its original context", () => {
  const due = { ...manual("due"), reviewAt: localDate(now) };
  const data = track({ ...emptyData(), problems: [due] });
  const entry = data.trackEntries![1];
  const context = trackContextForEntry(data, entry.id)!;
  const focused = withPracticeSession(
    data,
    data.problems.find((problem) => problem.id === entry.problemId)!,
    30,
    now.getTime(),
    "active",
    false,
    context,
  );
  const recommendation = todayPractice(focused, now)!;
  assert.equal(recommendation.problem.id, entry.problemId);
  assert.deepEqual(recommendation.trackContext, context);
  assert.deepEqual(recommendation.position, { index: 2, total: 2 });
});

test("an eligible relevant global revisit precedes untouched active-track work", () => {
  const due = { ...manual("due-outside-track"), reviewAt: "2026-10-06" };
  const data = track({ ...emptyData(), problems: [due] });
  assert.equal(todayPractice(data, now)?.problem.id, due.id);
  assert.equal(todayPractice(data, now)?.revisit, true);
});

test("a due problem belonging to the active track includes stage position and keeps the existing schedule", () => {
  let data = track();
  const entry = data.trackEntries![1];
  data = complete(data, entry.problemId);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === entry.problemId
        ? { ...problem, reviewAt: localDate(now) }
        : problem,
    ),
  };
  const recommendation = todayPractice(data, now)!;
  assert.equal(recommendation.problem.id, entry.problemId);
  assert.equal(recommendation.trackContext!.entryId, entry.id);
  assert.deepEqual(recommendation.position, { index: 2, total: 2 });
  assert.equal(recommendation.problem.reviewAt, localDate(now));
});

test("active track order precedes unrelated fresh manual work and never exposes the hidden pattern hint", () => {
  const other = manual("manual-other-choice");
  const data = track({ ...emptyData(), problems: [other] });
  const recommendation = todayPractice(data, now)!;
  assert.equal(recommendation.problem.id, data.trackEntries![0].problemId);
  assert.equal(recommendation.trackContext!.trackTitle, "Two Pointers");
  assert.deepEqual(recommendation.position, { index: 1, total: 2 });
  assert.equal(recommendation.reason.includes("Hidden hint"), false);
});

test("finished active-track work does not repeat through generic recommendations, while manual choice remains", () => {
  let data = track();
  for (const entry of data.trackEntries!)
    data = complete(data, entry.problemId);
  assert.equal(todayPractice(data, now), null);
  const other = manual("unrelated-manual");
  const withOther = { ...data, problems: [...data.problems, other] };
  assert.equal(todayPractice(withOther, now)?.problem.id, other.id);
});

test("assisted solves remain next; future schedules, deferrals, same-day skips, and archives remain ineligible", () => {
  let data = track();
  const first = data.trackEntries![0].problemId;
  const second = data.trackEntries![1].problemId;
  data = complete(data, first, "hint");
  assert.equal(todayPractice(data, now)?.problem.id, first);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === first ? { ...problem, reviewAt: "2026-10-09" } : problem,
    ),
  };
  assert.equal(todayPractice(data, now)?.problem.id, second);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === second
        ? { ...problem, deferredUntil: "2026-10-08" }
        : problem,
    ),
  };
  assert.equal(todayPractice(data, now), null);
  data = {
    ...data,
    problems: data.problems.map((problem) => ({
      ...problem,
      reviewAt: null,
      deferredUntil: null,
      skippedOn: localDate(now),
    })),
  };
  assert.equal(todayPractice(data, now), null);
  data = {
    ...data,
    problems: data.problems.map((problem) => ({
      ...problem,
      skippedOn: null,
      archived: true,
    })),
  };
  assert.equal(todayPractice(data, now), null);
});

test("Today retains focus relevance when a due revisit is outside the current focus", () => {
  const nonmatching = {
    ...manual("cp-only-due"),
    tags: ["math"],
    reviewAt: localDate(now),
  };
  const matching = manual("matching-manual");
  const data = track({
    ...emptyData(),
    problems: [nonmatching, matching],
    settings: { ...emptyData().settings, focus: "placement" },
  });
  assert.equal(todayPractice(data, now)?.trackContext?.trackId, "active-track");
  assert.notEqual(todayPractice(data, now)?.problem.id, nonmatching.id);
});

test("switching Codeforces handles does not turn the previous profile's acceptance into Today completion", () => {
  const connected = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  const imported = mergeActivity(
    connected,
    "alpha",
    [
      {
        handle: "alpha",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 1,
            submittedAt: "2026-10-06T12:00:00.000Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:4:A",
              title: "Watermelon",
              code: "4A",
              url: "https://codeforces.com/problemset/problem/4/A",
              rating: 800,
              tags: ["math"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  const data = connectProfile(
    track(imported),
    { handle: "beta", rating: null, rank: null },
    now,
  );
  const recommendation = todayPractice(data, now)!;
  assert.equal(recommendation.fresh, true);
  assert.equal(recommendation.problem.cfHandle, undefined);
  assert.equal(recommendation.trackContext!.entryId, "entry-0");
  const focused = withPracticeSession(
    data,
    recommendation.problem,
    30,
    now.getTime(),
    "beta-practice",
    true,
    recommendation.trackContext,
  );
  assert.equal(focused.session!.trackContext!.entryId, "entry-0");
  assert.equal(
    focused.problems.find(
      (problem) => problem.id === focused.session!.problemId,
    )!.cfHandle,
    undefined,
  );
  assert.deepEqual(validateData(focused), focused);
});

test("track sessions take fresh title snapshots, reject mismatched entries, and survive later removal", () => {
  const data = track();
  const context = trackContextForEntry(data, "entry-0")!;
  const problem = data.problems.find(
    (problem) => problem.id === data.trackEntries![0].problemId,
  )!;
  const focused = withPracticeSession(
    data,
    problem,
    30,
    now.getTime(),
    "snapshot",
    false,
    { ...context, trackTitle: "Stale title", stageTitle: "Stale stage" },
  );
  assert.equal(focused.session!.trackContext!.trackTitle, "Two Pointers");
  assert.equal(focused.session!.trackContext!.stageTitle, "Foundation");
  assert.throws(
    () =>
      withPracticeSession(
        data,
        data.problems.find(
          (problem) => problem.id === data.trackEntries![1].problemId,
        )!,
        30,
        now.getTime(),
        "wrong",
        false,
        context,
      ),
    /track entry has changed/,
  );
  const removed = {
    ...focused,
    tracks: [],
    trackStages: [],
    trackEntries: [],
    activeTrackId: null,
  };
  assert.deepEqual(
    todayPractice(validateData(removed), now)!.trackContext,
    focused.session!.trackContext,
  );
});

test("track context validates against the stored problem rather than an incompatible same-id payload", () => {
  const data = track();
  const entry = data.trackEntries![0];
  const context = trackContextForEntry(data, entry.id)!;
  const saved = data.problems.find(
    (problem) => problem.id === entry.problemId,
  )!;
  const changed = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === saved.id
        ? {
            ...problem,
            url: "https://codeforces.com/problemset/problem/10/A",
            problemCode: "10A",
          }
        : problem,
    ),
  };
  assert.throws(
    () =>
      withPracticeSession(
        changed,
        saved,
        30,
        now.getTime(),
        "stale-id",
        false,
        context,
      ),
    /track entry has changed/,
  );
});
