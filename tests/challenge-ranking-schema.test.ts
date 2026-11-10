import assert from "node:assert/strict";
import { test } from "node:test";
import { challengeRankingFeatures, readChallengeRankingDataset } from "../packages/tutor/challenge-ranking";

const candidate = {
  id: "case-1", input: "4 5\r\n", expectedOutput: "", reason: "The bounds are adjacent.",
};

const practice = {
  format: "forma-challenge-ranking", version: 1, source: "practice",
  groups: [{
    id: "challenge-one", problemKey: "problem-one", split: null,
    cases: [{
      id: candidate.id, ...challengeRankingFeatures(candidate),
      runs: [{ outcome: "mismatch", expectedSource: "user" }], feedback: null, targetedMismatch: null,
    }],
  }],
};

test("ranking features describe input shape without copying its contents", () => {
  assert.deepEqual(challengeRankingFeatures(candidate), {
    inputChars: 5, inputLines: 2, inputTokens: 2, reasonChars: candidate.reason.length, hasSuggestedOutput: true,
  });
  assert.deepEqual(readChallengeRankingDataset(practice), practice);
  const withPrivateField = structuredClone(practice);
  Object.assign(withPrivateField.groups[0].cases[0], { input: candidate.input });
  assert.throws(() => readChallengeRankingDataset(withPrivateField), /invalid fields/);
});

test("practice outcomes cannot become benchmark targets or cross a problem split", () => {
  const mislabeled = structuredClone(practice);
  Object.assign(mislabeled.groups[0].cases[0], { targetedMismatch: true });
  assert.throws(() => readChallengeRankingDataset(mislabeled), /invalid fields/);
  const benchmark = {
    ...practice, source: "benchmark", groups: [
      { id: "run-one", problemKey: "same-problem", split: "development", cases: [] },
      { id: "run-two", problemKey: "same-problem", split: "holdout", cases: [] },
    ],
  };
  assert.throws(() => readChallengeRankingDataset(benchmark), /both challenge ranking splits/);
});
