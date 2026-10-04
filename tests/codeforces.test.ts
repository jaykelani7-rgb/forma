import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemo,
  completeRevisit,
  emptyData,
  localDate,
  reviewQueue,
  validateData,
  weekActivity,
} from "../src/lib/model";
import { ActivityPage, SubmissionInput } from "../src/lib/codeforces-types";
import {
  beginVisit,
  codeforcesIdentity,
  connectProfile,
  disconnectProfile,
  dailyReflectionBatch,
  dailyReflectionCounts,
  ensureDailyReflectionBatch,
  mergeActivity,
  mergeProfileMetadata,
  profileStats,
  proposedReview,
  saveQuickReflection,
  skipReflection,
  withCodeforcesDemo,
} from "../src/lib/codeforces";
import {
  collectProfileActivity,
  profileMetadataDue,
} from "../src/lib/codeforces-client";
import {
  createCodeforcesAdapter,
  fetchActivityTransaction,
  parsePublicProfile,
  parseSubmissions,
} from "../src/lib/codeforces-api";

const now = new Date("2026-10-04T20:30:00Z");
const connected = (handle = "jay") =>
  connectProfile(emptyData(), { handle, rating: null, rank: null }, now);
const sub = (
  id: number,
  verdict: string | null = "OK",
  minutes = 0,
  key = "contest:4:A",
): SubmissionInput => ({
  id,
  submittedAt: new Date(now.getTime() + minutes * 60000).toISOString(),
  verdict,
  language: "GNU C++20",
  problem: {
    key,
    title: "Watermelon",
    code: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
    rating: null,
    tags: [],
  },
});
const page = (
  submissions: SubmissionInput[],
  handle = "jay",
  from = 1,
  count = 50,
): ActivityPage => ({ handle, from, count, submissions });
const reflect = (
  data: ReturnType<typeof connected>,
  id: string,
  outcome: "hint" | "editorial" | "independent" | "unsolved",
  date: string | null = "2026-10-09",
  overrideSchedule = false,
) =>
  saveQuickReflection(
    data,
    id,
    {
      outcome,
      difficulty: "approach",
      takeaway: "Look for a complement.",
      reviewAt: date,
      overrideSchedule,
    },
    now,
  );

test("sync is idempotent, accepted problems are unique, and wrong answers group with acceptance", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1, "WRONG_ANSWER", -20), sub(2), sub(3, "OK", 180)])],
    "refresh",
    now,
  );
  assert.equal(data.problems.length, 1);
  assert.equal(data.codeforces.practiceAttempts.length, 2);
  assert.deepEqual(data.codeforces.practiceAttempts[0].submissionIds, [1, 2]);
  const original = data.codeforces.practiceAttempts.map((a) => a.id);
  data = mergeActivity(
    data,
    "JAY",
    [page([sub(3, "OK", 180), sub(2), sub(1, "WRONG_ANSWER", -20)], "JAY")],
    "refresh",
    now,
  );
  assert.equal(data.codeforces.submissions.length, 3);
  assert.equal(data.problems.length, 1);
  assert.deepEqual(
    data.codeforces.practiceAttempts.map((a) => a.id),
    original,
  );
  assert.equal(profileStats(data, "jay").accepted, 1);
  assert.equal(profileStats(data, "jay").independent, 0);
  assert.equal(data.attempts.length, 0);
  assert.equal(
    weekActivity(data, now).reduce((n, d) => n + d.count, 0),
    0,
  );
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});
test("pending verdicts update without moving membership or erasing a reflection", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1, "TESTING")])],
    "refresh",
    now,
  );
  const id = data.codeforces.practiceAttempts[0].id;
  data = reflect(data, id, "hint");
  const saved = data.codeforces.reflections[0];
  data = mergeActivity(data, "jay", [page([sub(1, "OK")])], "refresh", now);
  assert.equal(data.codeforces.submissions[0].verdict, "OK");
  assert.deepEqual(data.codeforces.reflections[0], saved);
  assert.equal(profileStats(data, "jay").independent, 0);
  assert.equal(profileStats(data, "jay").assisted, 1);
  assert.equal(reviewQueue(data).length, 1);
});
test("partial page failure leaves the previous transaction intact", async () => {
  const original = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  const before = JSON.stringify(original);
  await assert.rejects(
    fetchActivityTransaction("jay", 1, 1, false, async (_handle, from) => {
      if (from > 1) throw new Error("temporary page failure");
      return page(
        Array.from({ length: 50 }, (_, i) => sub(200 - i)),
        "jay",
        from,
      );
    }),
    /temporary page failure/,
  );
  assert.equal(JSON.stringify(original), before);
  assert.equal(original.codeforces.profiles[0].lastSyncAt, now.toISOString());
});
test("bounded import exposes a gap, older pages reconcile it and do not add inbox tasks", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  data = mergeActivity(
    data,
    "jay",
    [page(Array.from({ length: 50 }, (_, i) => sub(200 - i)))],
    "refresh",
    now,
  );
  assert.equal(data.codeforces.profiles[0].gapUntilId, 1);
  assert.equal(data.codeforces.profiles[0].historyComplete, false);
  const tasks = profileStats(data, "jay").pending;
  // Real overlapping pages must fill the missing window; fetching an unrelated
  // old page alone cannot prove coverage of submissions between the windows.
  for (const from of [41, 81, 121, 161]) {
    data = mergeActivity(
      data,
      "jay",
      [
        page(
          Array.from({ length: Math.min(50, 201 - from) }, (_, i) =>
            sub(201 - from - i),
          ),
          "jay",
          from,
        ),
      ],
      "older",
      now,
    );
  }
  assert.equal(data.codeforces.profiles[0].gapUntilId, null);
  assert.equal(data.codeforces.profiles[0].historyComplete, true);
  assert.equal(profileStats(data, "jay").pending, tasks);
});
test("one schedule per problem; reflection edits respect manual dates and newer attempts", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1), sub(2, "OK", 180)])],
    "refresh",
    now,
  );
  const [old, recent] = data.codeforces.practiceAttempts;
  data = reflect(data, old.id, "editorial", "2026-10-07");
  data = reflect(data, recent.id, "hint", "2026-10-09");
  assert.equal(reviewQueue(data).length, 1);
  data = reflect(data, old.id, "unsolved", "2026-10-05");
  assert.equal(data.problems[0].reviewAt, "2026-10-09");
  data = {
    ...data,
    problems: data.problems.map((p) => ({
      ...p,
      reviewManual: true,
      reviewAt: "2026-10-25",
    })),
  };
  data = reflect(data, recent.id, "editorial", "2026-10-07");
  assert.equal(data.problems[0].reviewAt, "2026-10-25");
  data = reflect(data, recent.id, "independent", null, true);
  assert.equal(reviewQueue(data).length, 0);
  assert.equal(profileStats(data, "jay").revisits, 1);
});
test("handle changes and disconnect retain scoped history, notes and schedules", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  data = reflect(data, data.codeforces.practiceAttempts[0].id, "hint");
  data = connectProfile(
    data,
    { handle: "other", rating: 1400, rank: "specialist" },
    now,
  );
  data = mergeActivity(
    data,
    "other",
    [page([sub(1)], "other")],
    "refresh",
    now,
  );
  assert.equal(data.problems.length, 2);
  assert.equal(profileStats(data, "jay").reflected, 1);
  assert.equal(profileStats(data, "other").reflected, 0);
  assert.equal(profileStats(data, "other").independent, 0);
  assert.equal(reviewQueue(data).length, 0);
  data = disconnectProfile(data);
  assert.equal(data.codeforces.submissions.length, 2);
  assert.equal(
    data.codeforces.reflections[0].takeaway,
    "Look for a complement.",
  );
  data = connectProfile(data, { handle: "Jay", rating: null, rank: null }, now);
  assert.equal(reviewQueue(data).length, 1);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});
test("older pagination prepends related failures without losing the saved attempt anchor", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(2)])],
    "refresh",
    now,
  );
  const id = data.codeforces.practiceAttempts[0].id;
  data = reflect(data, id, "hint");
  data = mergeActivity(
    data,
    "jay",
    [page([sub(1, "WRONG_ANSWER", -15)], "jay", 2)],
    "older",
    now,
  );
  assert.equal(data.codeforces.practiceAttempts.length, 1);
  assert.equal(data.codeforces.practiceAttempts[0].id, id);
  assert.deepEqual(data.codeforces.practiceAttempts[0].submissionIds, [1, 2]);
  assert.equal(data.codeforces.reflections[0].attemptId, id);
});
test("version one data migrates with timer, notes, history and deliberate dates preserved", () => {
  const old: Record<string, unknown> = JSON.parse(
    JSON.stringify(createDemo(now)),
  );
  old.schemaVersion = 1;
  delete old.codeforces;
  const settings = old.settings as Record<string, unknown>;
  delete settings.reviewDays;
  old.session = {
    id: "old-session",
    problemId: "diagonal",
    startedAt: now.toISOString(),
    runningSince: null,
    elapsedMs: 60000,
    targetMinutes: 30,
    notes: "An edge case to try.",
    timerVisible: false,
    phase: "focus",
  };
  const migrated = validateData(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.attempts, old.attempts);
  assert.deepEqual(migrated.session, old.session);
  assert.equal(migrated.codeforces.submissions.length, 0);
  assert.deepEqual(migrated.settings.reviewDays, {
    unsolved: 1,
    editorial: 3,
    hint: 5,
  });
  assert.ok(
    migrated.problems.filter((p) => p.reviewAt).every((p) => p.reviewManual),
  );
  assert.deepEqual(validateData(migrated), migrated);
  assert.equal(
    withCodeforcesDemo(emptyData(), now).codeforces.submissions.length,
    4,
  );
  assert.equal(emptyData().codeforces.submissions.length, 0);
});
test("backup validation rejects broken platform relationships and duplicate identities", () => {
  const data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        codeforces: {
          ...data.codeforces,
          submissions: [
            ...data.codeforces.submissions,
            ...data.codeforces.submissions,
          ],
        },
      }),
    /Codeforces/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        codeforces: {
          ...data.codeforces,
          reflections: [
            {
              attemptId: "missing",
              outcome: "independent",
              difficulty: null,
              takeaway: "",
              savedAt: now.toISOString(),
            },
          ],
        },
      }),
    /Codeforces/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        problems: [...data.problems, { ...data.problems[0], id: "duplicate" }],
      }),
    /duplicate platform/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        settings: {
          ...data.settings,
          reviewDays: { unsolved: 0, hint: 5, editorial: 3 },
        },
      }),
    /defaults/,
  );
});
test("local dates and visit cutoffs separate activity events from daily scheduling", () => {
  const date = new Date(2026, 9, 4, 23, 59);
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    date,
  );
  data = beginVisit(data, new Date(date.getTime() + 120000));
  assert.equal(data.codeforces.profiles[0].sinceAt, now.toISOString());
  assert.equal(localDate(new Date(2026, 9, 5, 0, 1)), "2026-10-05");
  assert.equal(
    proposedReview(data, data.problems[0], "unsolved", date),
    "2026-10-05",
  );
  assert.equal(
    proposedReview(data, data.problems[0], "hint", date),
    "2026-10-09",
  );
  assert.equal(
    proposedReview(data, data.problems[0], "independent", date),
    null,
  );
  assert.equal(
    proposedReview(
      data,
      data.problems[0],
      "unsolved",
      new Date(2026, 2, 7, 23, 59),
    ),
    "2026-03-08",
  );
});
test("an empty successful import does not mark a later bounded import as complete", () => {
  let data = mergeActivity(connected(), "jay", [page([])], "refresh", now);
  assert.equal(data.codeforces.profiles[0].historyComplete, true);
  data = mergeActivity(
    data,
    "jay",
    [page(Array.from({ length: 50 }, (_, i) => sub(100 - i)))],
    "refresh",
    now,
  );
  assert.equal(data.codeforces.profiles[0].historyComplete, false);
  assert.equal(profileStats(data, "jay").pending, 5);
});
test("API normalization preserves missing metadata and matches alternate URL formats", () => {
  const raw = {
    id: 3,
    creationTimeSeconds: 1791108000,
    problem: { contestId: 4, index: "A", name: "Watermelon", tags: [] },
    programmingLanguage: "GNU C++20",
  };
  const parsed = parseSubmissions([raw])[0];
  assert.equal(parsed.problem.rating, null);
  assert.equal(parsed.verdict, null);
  assert.deepEqual(
    parseSubmissions([
      { ...raw, problem: { ...raw.problem, tags: undefined } },
    ])[0].problem.tags,
    [],
  );
  assert.equal(
    parsed.problem.key,
    codeforcesIdentity("https://codeforces.com/contest/4/problem/A"),
  );
  assert.equal(
    parsed.problem.key,
    codeforcesIdentity("https://codeforces.com/problemset/problem/4/A"),
  );
  assert.equal(
    codeforcesIdentity("https://evil.com/contest/4/problem/A"),
    null,
  );
  assert.deepEqual(parsePublicProfile([{ handle: "jay" }]), {
    handle: "jay",
    rating: null,
    rank: null,
  });
  assert.throws(
    () =>
      parseSubmissions([
        raw,
        { ...raw, id: 4, problem: { index: "A", name: "Unknown", tags: [] } },
      ]),
    /incomplete/,
  );
});
test("adapter paces requests, retries only bounded transient failures, and restricts methods", async () => {
  let clock = 10000;
  const starts: number[] = [];
  const urls: string[] = [];
  let failures = 1;
  const adapter = createCodeforcesAdapter({
    now: () => clock,
    wait: async (ms) => {
      clock += ms;
    },
    fetcher: async (url) => {
      starts.push(clock);
      urls.push(url);
      if (failures-- > 0)
        return Response.json({
          status: "FAILED",
          comment: "Call limit exceeded",
        });
      return Response.json({ status: "OK", result: [{ handle: "jay" }] });
    },
  });
  await Promise.all([adapter.profile("jay"), adapter.profile("other")]);
  assert.equal(starts.length, 3);
  assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 2100));
  assert.ok(
    urls.every(
      (url) =>
        new URL(url).origin === "https://codeforces.com" &&
        new URL(url).pathname === "/api/user.info",
    ),
  );
  let calls = 0;
  const invalid = createCodeforcesAdapter({
    wait: async () => {},
    fetcher: async () => {
      calls++;
      return Response.json({
        status: "FAILED",
        comment: "handles: User with handle missing not found",
      });
    },
  });
  await assert.rejects(invalid.profile("missing"), /not found/);
  assert.equal(calls, 1);
});

test("route rejects arbitrary upstream parameters, invalid pagination and malformed handles", async () => {
  const { GET } = await import("../src/app/api/codeforces/route");
  for (const query of [
    "action=profile&handle=jay&url=https://example.com",
    "action=activity&handle=jay&from=0",
    "action=profile&handle=jay%3Bother",
    "action=other&handle=jay",
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/codeforces?${query}`),
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
});

test("repeated bounded recent refresh preserves the gap and historical cursor", async () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page(Array.from({ length: 50 }, (_, i) => sub(300 - i)))],
    "refresh",
    now,
  );
  const recentPages = [1, 51, 101].map((from) =>
    page(
      Array.from({ length: 50 }, (_, i) => sub(701 - from - i)),
      "jay",
      from,
    ),
  );
  data = mergeActivity(data, "jay", recentPages, "refresh", now);
  const first = data.codeforces.profiles[0];
  assert.equal(first.gapUntilId, 300);
  assert.equal(first.historyAnchorId, 251);
  assert.equal(first.nextFrom, 201);
  assert.equal(first.gapNextFrom, 151);
  data = mergeActivity(
    data,
    "jay",
    [recentPages[0]],
    "refresh",
    new Date(now.getTime() + 60000),
  );
  const repeated = data.codeforces.profiles[0];
  assert.equal(repeated.gapUntilId, 300);
  assert.equal(repeated.nextFrom, first.nextFrom);
  assert.equal(repeated.gapNextFrom, first.gapNextFrom);
  assert.equal(repeated.historyComplete, false);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});

test("new activity during older pagination leaves unfetched windows incomplete", async () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page(Array.from({ length: 50 }, (_, i) => sub(100 - i)))],
    "refresh",
    now,
  );
  const transaction = await collectProfileActivity(
    data.codeforces.profiles[0],
    100,
    true,
    undefined,
    {
      activity: async (_handle, from) =>
        page(
          Array.from({ length: Math.min(50, 181 - from) }, (_, i) =>
            sub(181 - from - i),
          ),
          "jay",
          from,
        ),
      profile: async () => {
        throw new Error("Older requests must not refresh metadata.");
      },
    },
    now,
  );
  assert.ok(transaction.pages.length <= 4);
  data = mergeActivity(data, "jay", transaction.pages, "older", now);
  assert.equal(data.codeforces.profiles[0].historyComplete, false);
  assert.ok(
    data.codeforces.profiles[0].coverage!.some((range) => range.oldestId <= 51),
  );
  // A later short page reaching the end joins the existing range and proves
  // completion only because it overlaps the stored anchor.
  data = mergeActivity(
    data,
    "jay",
    [
      page(
        Array.from({ length: 50 }, (_, i) => sub(60 - i)),
        "jay",
        121,
      ),
      page(
        Array.from({ length: 20 }, (_, i) => sub(20 - i)),
        "jay",
        161,
      ),
    ],
    "older",
    now,
  );
  assert.equal(data.codeforces.profiles[0].historyComplete, true);
});

test("profile-aware backfill is atomic on partial failure and retries preserve coverage", async () => {
  const data = mergeActivity(
    connected(),
    "jay",
    [page(Array.from({ length: 50 }, (_, i) => sub(100 - i)))],
    "refresh",
    now,
  );
  const before = JSON.stringify(data);
  let calls = 0;
  await assert.rejects(
    collectProfileActivity(
      data.codeforces.profiles[0],
      100,
      true,
      undefined,
      {
        activity: async (_handle, from) => {
          calls++;
          if (calls === 2) throw new Error("Backfill page failed.");
          return page(
            Array.from({ length: 50 }, (_, i) => sub(300 - from - i)),
            "jay",
            from,
          );
        },
        profile: async () => ({
          handle: "jay",
          rating: 1500,
          rank: "specialist",
        }),
      },
      now,
    ),
    /Backfill page failed/,
  );
  assert.equal(JSON.stringify(data), before);
  const retry = await collectProfileActivity(
    data.codeforces.profiles[0],
    100,
    true,
    undefined,
    {
      activity: async (_handle, from) =>
        page(
          Array.from({ length: Math.min(50, 101 - from) }, (_, i) =>
            sub(101 - from - i),
          ),
          "jay",
          from,
        ),
      profile: async () => ({
        handle: "jay",
        rating: 1500,
        rank: "specialist",
      }),
    },
    now,
  );
  const merged = mergeActivity(data, "jay", retry.pages, "older", now);
  assert.equal(merged.codeforces.submissions.length, 90);
  assert.equal(merged.codeforces.profiles[0].historyComplete, false);
});

test("activity imports do not impersonate profile freshness; metadata failure remains recoverable", async () => {
  const initial = connected();
  const initialProfile = initial.codeforces.profiles[0];
  assert.equal(profileMetadataDue(initialProfile, now), false);
  const tomorrow = new Date(now.getTime() + 86400000);
  assert.equal(profileMetadataDue(initialProfile, tomorrow), true);
  const result = await collectProfileActivity(
    initialProfile,
    0,
    false,
    undefined,
    {
      activity: async (_handle, from) => page([sub(1)], "jay", from),
      profile: async () => {
        throw new Error("Metadata unavailable.");
      },
    },
    tomorrow,
  );
  assert.match(result.profileWarning!, /previous profile check/);
  let data = mergeActivity(initial, "jay", result.pages, "refresh", tomorrow);
  assert.equal(data.codeforces.profiles[0].profileUpdatedAt, now.toISOString());
  assert.equal(data.codeforces.profiles[0].lastSyncAt, tomorrow.toISOString());
  data = mergeProfileMetadata(
    data,
    { handle: "jay", rating: 1530, rank: "specialist" },
    tomorrow,
  );
  assert.equal(data.codeforces.profiles[0].rating, 1530);
  assert.equal(
    data.codeforces.profiles[0].profileUpdatedAt,
    tomorrow.toISOString(),
  );
});

test("the daily reflection batch stays bounded and stable through refresh, save and skip", () => {
  const unique = (id: number) => sub(id, "OK", id, `contest:${id}:A`);
  let data = mergeActivity(
    connected(),
    "jay",
    [page(Array.from({ length: 12 }, (_, i) => unique(i + 1)))],
    "refresh",
    now,
  );
  const initial = dailyReflectionBatch(data, "jay", now).map(
    (attempt) => attempt.id,
  );
  assert.equal(initial.length, 5);
  data = skipReflection(data, initial[0]);
  data = reflect(data, initial[1], "hint");
  data = mergeActivity(
    data,
    "jay",
    [page(Array.from({ length: 12 }, (_, i) => unique(i + 13)))],
    "refresh",
    now,
  );
  assert.deepEqual(
    dailyReflectionBatch(data, "jay", now).map((attempt) => attempt.id),
    initial.slice(2),
  );
  assert.deepEqual(dailyReflectionCounts(data, "jay", now), {
    total: 5,
    pending: 3,
    unreflected: 23,
  });
  assert.equal(profileStats(data, "jay").pending, 3);
  const tomorrow = new Date(now.getTime() + 86400000);
  data = ensureDailyReflectionBatch(data, tomorrow);
  assert.equal(dailyReflectionBatch(data, "jay", tomorrow).length, 5);
  assert.ok(
    !dailyReflectionBatch(data, "jay", tomorrow).some(
      (attempt) => attempt.id === initial[0],
    ),
  );
  assert.equal(data.codeforces.practiceAttempts.length, 24);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});

test("a completed daily batch never creates five more obligations on the next refresh", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [
      page(
        Array.from({ length: 6 }, (_, i) =>
          sub(i + 1, "OK", i, `contest:${i + 1}:A`),
        ),
      ),
    ],
    "refresh",
    now,
  );
  for (const attempt of dailyReflectionBatch(data, "jay", now))
    data = skipReflection(data, attempt.id);
  data = mergeActivity(
    data,
    "jay",
    [page([sub(7, "OK", 7, "contest:7:A")])],
    "refresh",
    now,
  );
  assert.equal(dailyReflectionBatch(data, "jay", now).length, 0);
  assert.equal(dailyReflectionCounts(data, "jay", now).total, 5);
  assert.equal(data.codeforces.practiceAttempts.length, 7);
});

test("legacy unbounded inbox flags migrate to five daily tasks without deleting history", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [
      page(
        Array.from({ length: 10 }, (_, i) =>
          sub(i + 1, "OK", i, `contest:${i + 1}:A`),
        ),
      ),
    ],
    "refresh",
    now,
  );
  data = {
    ...data,
    codeforces: {
      ...data.codeforces,
      practiceAttempts: data.codeforces.practiceAttempts.map((attempt) => {
        const { batchDate, ...legacy } = attempt;
        void batchDate;
        return { ...legacy, inbox: true };
      }),
    },
  };
  data = ensureDailyReflectionBatch(validateData(data), now);
  assert.equal(dailyReflectionBatch(data, "jay", now).length, 5);
  assert.equal(data.codeforces.practiceAttempts.length, 10);
  assert.equal(
    data.codeforces.practiceAttempts.filter((attempt) => attempt.inbox).length,
    5,
  );
});

test("completing a revisit blocks old reflection edits but permits new assisted practice", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  const old = data.codeforces.practiceAttempts[0];
  data = reflect(data, old.id, "hint");
  const completedAt = new Date(now.getTime() + 60000);
  data = completeRevisit(data, old.problemId, completedAt);
  data = reflect(data, old.id, "editorial", "2026-10-07");
  assert.equal(data.problems[0].reviewAt, null);
  data = mergeActivity(
    data,
    "jay",
    [page([sub(2, "OK", 180)])],
    "refresh",
    new Date(now.getTime() + 180 * 60000),
  );
  const fresh = data.codeforces.practiceAttempts.find((attempt) =>
    attempt.submissionIds.includes(2),
  )!;
  data = reflect(data, fresh.id, "hint", "2026-10-09");
  assert.equal(data.problems[0].reviewAt, "2026-10-09");
  assert.equal(data.problems[0].reviewManual, false);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
});

test("an old imported reflection cannot reset a newer timed session's schedule", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [page([sub(1)])],
    "refresh",
    now,
  );
  const imported = data.codeforces.practiceAttempts[0];
  const timed = {
    id: "newer-timed",
    problemId: imported.problemId,
    startedAt: now.toISOString(),
    completedAt: new Date(now.getTime() + 3600000).toISOString(),
    elapsedMs: 60000,
    outcome: "independent" as const,
    difficulty: null,
    takeaway: "",
    notes: "",
  };
  data = {
    ...data,
    attempts: [timed],
    problems: data.problems.map((problem) => ({
      ...problem,
      reviewAt: "2026-10-18",
      reviewManual: false,
    })),
  };
  data = reflect(data, imported.id, "editorial", "2026-10-07");
  assert.equal(data.problems[0].reviewAt, "2026-10-18");
  // Only an explicit link identifies these two source records as one attempt.
  data = {
    ...data,
    learningLinks: [
      {
        timedAttemptId: timed.id,
        importedAttemptId: imported.id,
        handle: "jay",
        linkedAt: now.toISOString(),
        reflectionSource: "codeforces",
      },
    ],
  };
  data = reflect(data, imported.id, "hint", "2026-10-09");
  assert.equal(data.problems[0].reviewAt, "2026-10-09");
});

test("an explicitly linked timed reflection completes its daily slot without duplicate obligation", () => {
  let data = mergeActivity(
    connected(),
    "jay",
    [
      page(
        Array.from({ length: 6 }, (_, i) =>
          sub(i + 1, "OK", i, `contest:${i + 1}:A`),
        ),
      ),
    ],
    "refresh",
    now,
  );
  const activity = dailyReflectionBatch(data, "jay", now)[0];
  const timed = {
    id: "linked-timed",
    problemId: activity.problemId,
    startedAt: now.toISOString(),
    completedAt: new Date(now.getTime() + 3600000).toISOString(),
    elapsedMs: 60000,
    outcome: "independent" as const,
    difficulty: null,
    takeaway: "",
    notes: "",
  };
  data = {
    ...data,
    attempts: [timed],
    learningLinks: [
      {
        timedAttemptId: timed.id,
        importedAttemptId: activity.id,
        handle: "jay",
        linkedAt: now.toISOString(),
        reflectionSource: "timed",
      },
    ],
  };
  data = ensureDailyReflectionBatch(data, now);
  assert.equal(dailyReflectionCounts(data, "jay", now).total, 5);
  assert.equal(dailyReflectionBatch(data, "jay", now).length, 4);
  assert.equal(profileStats(data, "jay").independent, 1);
  assert.equal(data.codeforces.reflections.length, 0);
});

test("backup validation rejects an oversized persisted daily batch", () => {
  const data = mergeActivity(
    connected(),
    "jay",
    [
      page(
        Array.from({ length: 6 }, (_, i) =>
          sub(i + 1, "OK", i, `contest:${i + 1}:A`),
        ),
      ),
    ],
    "refresh",
    now,
  );
  const invalid = {
    ...data,
    codeforces: {
      ...data.codeforces,
      practiceAttempts: data.codeforces.practiceAttempts.map((attempt) => ({
        ...attempt,
        batchDate: localDate(now),
        inbox: true,
      })),
    },
  };
  assert.throws(() => validateData(invalid), /Codeforces/);
});
