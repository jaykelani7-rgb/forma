import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/lib/model";
import { connectProfile, mergeActivity } from "../src/lib/codeforces";
import { createCodeforcesAdapter } from "../src/lib/codeforces-api";
import {
  createCatalogueCache,
  parseProblemCatalogue,
} from "../src/lib/catalogue";
import {
  catalogueProblemToSaved,
  catalogueTopics,
  composePractice,
  defaultDiscovery,
  dismissFreshSuggestion,
  knownAcceptedKeys,
  normalizeTopic,
  retainFreshSelection,
  selectFreshProblem,
  validateCatalogue,
  validateDiscovery,
} from "../src/lib/discovery";
import type { CatalogueProblem, ProblemCatalogue } from "../src/lib/discovery";
import type { ActivityPage } from "../src/lib/codeforces-types";

const now = new Date(2026, 9, 4, 12);
const problem = (
  id: number,
  rating: number | null = 1200,
  tags = ["dp"],
): CatalogueProblem => ({
  key: `contest:${id}:A`,
  title: `Problem ${id}`,
  code: `${id}A`,
  url: `https://codeforces.com/problemset/problem/${id}/A`,
  rating,
  tags,
});
const catalogue = (
  problems = [problem(1), problem(2), problem(3)],
): ProblemCatalogue => ({
  problems,
  fetchedAt: now.toISOString(),
  stale: false,
});
const rawCatalogue = () => ({
  problems: [
    {
      contestId: 4,
      index: "a",
      name: "Watermelon",
      type: "PROGRAMMING",
      tags: ["math", "brute force"],
    },
    {
      contestId: 5,
      index: "B",
      name: "Code",
      type: "PROGRAMMING",
      rating: 1200,
      tags: ["dp"],
    },
  ],
  problemStatistics: [{ contestId: 4, index: "A", solvedCount: 2 }],
});

test("catalogue validation retains original tags and missing ratings without inventing metadata", () => {
  const parsed = parseProblemCatalogue(rawCatalogue());
  assert.equal(parsed[0].rating, null);
  assert.equal(parsed[0].key, "contest:4:A");
  assert.deepEqual(parsed[0].tags, ["math", "brute force"]);
  assert.equal(parsed[1].rating, 1200);
  assert.equal(normalizeTopic("  DP "), "dynamic programming");
  assert.equal(normalizeTopic("Dynamic-programming"), "dynamic programming");
  assert.deepEqual(
    catalogueTopics(
      catalogue([
        problem(1, 1200, ["dp", "Dynamic programming", "two pointers"]),
      ]),
    ),
    ["dynamic programming", "two pointers"],
  );
  assert.deepEqual(validateCatalogue(catalogue()), catalogue());
  assert.throws(
    () =>
      parseProblemCatalogue({
        ...rawCatalogue(),
        problems: [...rawCatalogue().problems, rawCatalogue().problems[0]],
      }),
    /safely/,
  );
  assert.throws(
    () =>
      validateCatalogue(
        catalogue([{ ...problem(1), url: "https://example.com/problem" }]),
      ),
    /invalid link/,
  );
});

test("cache coalesces concurrent loads, reuses fresh data, and keeps a stale copy on upstream failure", async () => {
  let time = now.getTime();
  let calls = 0;
  let fail = false;
  const cache = createCatalogueCache({
    now: () => time,
    ttl: 1000,
    retryAfter: 100,
    load: async () => {
      calls++;
      if (fail) throw new Error("upstream unavailable");
      return rawCatalogue();
    },
  });
  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  await cache.get();
  assert.equal(calls, 1);
  time += 1001;
  fail = true;
  const stale = await cache.get();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.deepEqual(stale.problems, first.problems);
  await cache.get();
  assert.equal(calls, 2);
  time += 101;
  fail = false;
  const refreshed = await cache.get();
  assert.equal(refreshed.stale, false);
  assert.equal(calls, 3);
});

test("a failed empty cache retries conservatively and never caches a partial malformed catalogue", async () => {
  let calls = 0;
  let time = now.getTime();
  const cache = createCatalogueCache({
    now: () => time,
    retryAfter: 100,
    load: async () => {
      calls++;
      return {
        ...rawCatalogue(),
        problems: [...rawCatalogue().problems, { index: "A" }],
      };
    },
  });
  await assert.rejects(cache.get(), /safely/);
  await assert.rejects(cache.get(), /safely/);
  assert.equal(calls, 1);
  time += 101;
  await assert.rejects(cache.get(), /safely/);
  assert.equal(calls, 2);
});

test("catalogue and profile requests use the same documented upstream pacing", async () => {
  let time = now.getTime();
  const starts: number[] = [];
  const adapter = createCodeforcesAdapter({
    now: () => time,
    wait: async (milliseconds) => {
      time += milliseconds;
    },
    fetcher: async (url) => {
      starts.push(time);
      return Response.json({
        status: "OK",
        result: new URL(url).pathname.endsWith("problemset.problems")
          ? rawCatalogue()
          : [{ handle: "jay" }],
      });
    },
  });
  await Promise.all([adapter.profile("jay"), adapter.catalogue()]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 2100);
});

test("fresh selection is stable through ordinary refreshes and catalogue additions", () => {
  const data = emptyData();
  const preferences = defaultDiscovery();
  const first = selectFreshProblem(catalogue(), data, preferences, now);
  assert.ok(first.recommendation);
  const retained = retainFreshSelection(
    preferences,
    first.recommendation.problem.key,
    now,
  );
  const refreshed = selectFreshProblem(
    catalogue([
      ...catalogue().problems,
      ...Array.from({ length: 100 }, (_, i) => problem(100 + i)),
    ]),
    data,
    retained,
    now,
  );
  assert.equal(
    refreshed.recommendation?.problem.key,
    first.recommendation.problem.key,
  );
  assert.equal(refreshed.recommendation?.personalized, false);
  assert.match(refreshed.recommendation?.reason ?? "", /Generic match/);
  assert.match(refreshed.coverageNotice, /No Codeforces profile/);
});

test("fresh discovery excludes accepted and saved future revisits while preserving handle isolation", () => {
  const data = connectProfile(
    emptyData(),
    { handle: "jay", rating: null, rank: null },
    now,
  );
  const page: ActivityPage = {
    handle: "jay",
    from: 1,
    count: 50,
    submissions: [
      {
        id: 1,
        submittedAt: now.toISOString(),
        verdict: "OK",
        language: "C++",
        problem: { ...problem(1) },
      },
    ],
  };
  const synced = mergeActivity(data, "jay", [page], "refresh", now);
  synced.codeforces.profiles[0].historyComplete = false;
  const saved = catalogueProblemToSaved(problem(2), "saved-future", now);
  saved.reviewAt = "2026-11-04";
  synced.problems.push(saved);
  assert.deepEqual([...knownAcceptedKeys(synced)], ["contest:1:A"]);
  const result = selectFreshProblem(
    catalogue(),
    synced,
    defaultDiscovery(),
    now,
  );
  assert.equal(result.recommendation?.problem.key, "contest:3:A");
  assert.match(result.coverageNotice, /incomplete/);
  assert.doesNotMatch(result.coverageNotice, /never solved/i);
  const other = connectProfile(
    synced,
    { handle: "other", rating: null, rank: null },
    now,
  );
  assert.equal(knownAcceptedKeys(other).size, 0);
  assert.equal(
    selectFreshProblem(catalogue([problem(1)]), other, defaultDiscovery(), now)
      .recommendation?.problem.key,
    "contest:1:A",
  );
});

test("topic aliases, missing ratings and insufficient candidates produce an honest empty result", () => {
  const preferences = { ...defaultDiscovery(), topic: "dynamic programming" };
  const result = selectFreshProblem(
    catalogue([
      problem(1, null),
      problem(2, 1900),
      problem(3, 1000, ["graphs"]),
    ]),
    emptyData(),
    preferences,
    now,
  );
  assert.equal(result.recommendation, null);
  assert.equal(result.unratedCount, 1);
  assert.equal(result.candidateCount, 0);
  assert.equal(
    selectFreshProblem(
      catalogue([problem(4, 1300)]),
      emptyData(),
      preferences,
      now,
    ).recommendation?.problem.key,
    "contest:4:A",
  );
});

test("dismissal actions stay distinct and do not repeatedly resurface recently declined problems", () => {
  const preferences = defaultDiscovery();
  const notToday = dismissFreshSuggestion(
    preferences,
    "contest:1:A",
    "not_today",
    now,
  );
  assert.equal(
    selectFreshProblem(catalogue([problem(1)]), emptyData(), notToday, now)
      .recommendation,
    null,
  );
  assert.ok(
    selectFreshProblem(
      catalogue([problem(1)]),
      emptyData(),
      notToday,
      new Date(2026, 9, 5, 12),
    ).recommendation,
  );
  const difficult = dismissFreshSuggestion(
    preferences,
    "contest:1:A",
    "difficult",
    now,
  );
  assert.equal(
    selectFreshProblem(
      catalogue([problem(1)]),
      emptyData(),
      difficult,
      new Date(2026, 9, 10, 12),
    ).recommendation,
    null,
  );
  assert.equal(difficult.minRating, preferences.minRating);
  assert.equal(difficult.maxRating, preferences.maxRating);
  const another = dismissFreshSuggestion(
    preferences,
    "contest:1:A",
    "another",
    now,
  );
  assert.equal(
    selectFreshProblem(
      catalogue([problem(1), problem(2)]),
      emptyData(),
      another,
      now,
    ).recommendation?.problem.key,
    "contest:2:A",
  );
  assert.deepEqual(validateDiscovery(notToday), notToday);
  assert.throws(
    () =>
      validateDiscovery({ ...preferences, minRating: 2000, maxRating: 1000 }),
    /preferences/,
  );
});

test("duration changes session composition without inventing completion-time estimates", () => {
  const revisit = catalogueProblemToSaved(problem(1), "revisit", now);
  const fresh = selectFreshProblem(
    catalogue([problem(2)]),
    emptyData(),
    defaultDiscovery(),
    now,
  ).recommendation;
  assert.deepEqual(composePractice(15, revisit, fresh).kinds, ["revisit"]);
  assert.deepEqual(composePractice(30, revisit, fresh).kinds, ["fresh"]);
  assert.deepEqual(composePractice(60, revisit, fresh).kinds, [
    "revisit",
    "fresh",
  ]);
  assert.match(
    composePractice(15, null, fresh).explanation,
    /not enough personal timing/,
  );
  assert.match(
    composePractice(60, revisit, fresh).explanation,
    /No rating guarantees/,
  );
});
