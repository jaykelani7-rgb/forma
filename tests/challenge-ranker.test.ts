import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChallengeRankingDataset, ChallengeRankingGroup } from "../packages/tutor/challenge-ranking";
import { compareChallengeRanking, mergeChallengeRankingDatasets, splitChallengeRanking } from "../scripts/tutor/challenge-ranker";

function challenge(id: string, split: ChallengeRankingGroup["split"], usefulFirst: boolean): ChallengeRankingGroup {
  return {
    id, problemKey: `problem-${id}`, split,
    cases: [usefulFirst, !usefulFirst].map((targetedMismatch, position) => ({
      id: `case-${position + 1}`, inputChars: targetedMismatch ? 18 : 4, inputLines: 1,
      inputTokens: targetedMismatch ? 6 : 2, reasonChars: 23, hasSuggestedOutput: true,
      runs: [], feedback: null, targetedMismatch: split ? targetedMismatch : null,
    })),
  };
}

const benchmark: ChallengeRankingDataset = {
  format: "forma-challenge-ranking", version: 1, source: "benchmark",
  groups: [
    challenge("a", "development", true), challenge("b", "development", false),
    challenge("c", "development", true), challenge("d", "development", false),
    challenge("e", "holdout", false), challenge("f", "holdout", true),
    { id: "g", problemKey: "problem-g", split: "holdout", cases: [] },
  ],
};

test("training learns within challenges and never reads holdout labels", () => {
  const report = compareChallengeRanking(benchmark, "targeted");
  assert.equal(report.training.status, "trained");
  assert.equal(report.split.trainingPairs, 4);
  assert.equal(report.methods.original.positiveFirst, 1);
  assert.equal(report.methods.shortestFirst.positiveFirst, 0);
  assert.equal(report.methods.trained?.positiveFirst, 2);
  assert.equal(report.methods.trained?.firstCaseTargetedMismatchRate, 2 / 3);
  assert.equal(report.methods.trained?.noCandidate, 1);
  assert.equal(report.challengesWithPositiveCase, 2);

  const relabeled = structuredClone(benchmark);
  for (const group of relabeled.groups.filter(group => group.split === "holdout")) {
    for (const candidate of group.cases) candidate.targetedMismatch = !candidate.targetedMismatch;
  }
  const rerun = compareChallengeRanking(relabeled, "targeted");
  assert.deepEqual(rerun.training, report.training);
  assert.equal(rerun.methods.trained?.positiveFirst, 0);
});

test("practice splits keep repeated problems together and run results do not fill missing feedback", () => {
  const practice: ChallengeRankingDataset = {
    ...benchmark, source: "practice",
    groups: Array.from({ length: 6 }, (_, index) => challenge(String(index), null, false)),
  };
  const original = practice.groups[0];
  practice.groups.push({ ...structuredClone(original), id: "same-problem-retry" });
  for (const group of practice.groups) {
    group.cases[0].runs = [{ outcome: "mismatch", expectedSource: "statement-sample" }];
  }
  const split = splitChallengeRanking(practice);
  assert.equal(split.developmentProblems + split.holdoutProblems, 6);
  const trainingKeys = new Set(split.development.map(group => group.problemKey));
  assert.ok(split.holdout.every(group => !trainingKeys.has(group.problemKey)));
  assert.deepEqual(splitChallengeRanking({ ...practice, groups: [...practice.groups].reverse() }).holdout.map(group => group.id).sort(),
    split.holdout.map(group => group.id).sort());
  const report = compareChallengeRanking(practice, "feedback");
  assert.equal(report.training.status, "insufficient-labels");
  assert.equal(report.methods.trained, null);
  assert.equal(report.methods.original.unlabeledFirst, split.holdout.length);
  assert.equal(report.methods.original.positiveRateAmongLabeledFirst, null);
  assert.throws(() => compareChallengeRanking(practice, "targeted"), /explicit feedback/);
});

test("repeat exports deduplicate identical challenges and reject conflicts or mixed sources", () => {
  assert.deepEqual(mergeChallengeRankingDatasets([benchmark, structuredClone(benchmark)]), benchmark);
  const conflicting = structuredClone(benchmark);
  conflicting.groups[0].cases[0].targetedMismatch = false;
  assert.throws(() => mergeChallengeRankingDatasets([benchmark, conflicting]), /different versions/);
  assert.throws(() => mergeChallengeRankingDatasets([benchmark, { ...benchmark, source: "practice", groups: [] }]), /separate runs/);
  const crossSplit = { ...benchmark, groups: [{ ...benchmark.groups[0], id: "moved", split: "holdout" as const }] };
  assert.throws(() => compareChallengeRanking(mergeChallengeRankingDatasets([benchmark, crossSplit]), "targeted"), /more than one ranking split/);
});
