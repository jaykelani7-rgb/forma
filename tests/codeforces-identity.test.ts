import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalProblemIdentity,
  normalizeCodeforcesIdentity,
} from "../src/lib/codeforces-identity";
import {
  practiceIdentity,
  sharedPracticeState,
} from "../src/lib/practice-state";
import { emptyData, validateData, type Problem } from "../src/lib/model";
import { connectProfile } from "../src/lib/codeforces";

test("Codeforces formats preserve A, A1, A2 and explicit Gym namespace", () => {
  const identities = ["100A", "100A1", "100A2", "Gym 100A"].map(
    normalizeCodeforcesIdentity,
  );
  assert.deepEqual(
    identities.map((value) => value?.key),
    ["contest:100:A", "contest:100:A1", "contest:100:A2", "gym:100:A"],
  );
  assert.equal(
    normalizeCodeforcesIdentity("https://codeforces.com/gym/100/problem/A")
      ?.key,
    "gym:100:A",
  );
  assert.equal(
    normalizeCodeforcesIdentity("https://codeforces.com/contest/100/problem/A")
      ?.key,
    "contest:100:A",
  );
  assert.equal(
    normalizeCodeforcesIdentity(
      "https://codeforces.com/problemset/problem/100/A",
    )?.key,
    "contest:100:A",
  );
  assert.equal(normalizeCodeforcesIdentity("38IA"), null);
  assert.equal(normalizeCodeforcesIdentity("38lA"), null);
});

test("legacy Gym provenance remains valid without rewriting keys or sharing contest schedules", () => {
  const data = connectProfile(emptyData(), {
    handle: "jay",
    rating: null,
    rank: null,
  });
  const gym: Problem = {
    id: "legacy-gym",
    title: "A Gym problem",
    platform: "Codeforces",
    url: "https://codeforces.com/gym/100/problem/A",
    problemCode: "100A",
    tags: [],
    rating: null,
    createdAt: "2026-10-01T00:00:00Z",
    reviewAt: "2026-10-12",
    reviewCount: 0,
    cfHandle: "jay",
    cfKey: "contest:100:A",
    reviewManual: true,
  };
  const contest: Problem = {
    ...gym,
    id: "contest",
    url: "https://codeforces.com/problemset/problem/100/A",
    cfHandle: undefined,
    cfKey: undefined,
    reviewAt: null,
    reviewManual: undefined,
  };
  data.problems = [gym, contest];
  // Canonical resolution is derived; the original cfKey remains exportable.
  const before = JSON.stringify(data);
  assert.equal(canonicalProblemIdentity(gym), "gym:100:A");
  assert.equal(practiceIdentity(gym), "gym:100:A");
  assert.equal(practiceIdentity(contest), "contest:100:A");
  assert.equal(
    sharedPracticeState(data, contest, new Date("2026-10-07T00:00:00Z"))
      .codingAt,
    null,
  );
  assert.equal(JSON.stringify(data), before);
  assert.equal(
    validateData(JSON.parse(before)).problems[0].cfKey,
    "contest:100:A",
  );
  assert.equal(
    canonicalProblemIdentity({ ...gym, cfKey: "contest:189:A" }),
    undefined,
  );
});
