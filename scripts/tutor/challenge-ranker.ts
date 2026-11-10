import { createHash } from "node:crypto";
import { CHALLENGE_CASE_LIMIT } from "../../packages/tutor/challenge-run";
import {
  CHALLENGE_RANKING_GROUP_LIMIT,
  type ChallengeRankingCase,
  type ChallengeRankingDataset,
  type ChallengeRankingGroup,
} from "../../packages/tutor/challenge-ranking";

export type RankingLabel = "targeted" | "feedback";

const featureNames = ["position", "inputChars", "inputLines", "inputTokens", "reasonChars", "hasSuggestedOutput"] as const;
const minTrainingProblems = 3;
const minHoldoutProblems = 2;
const pairwiseIterations = 400;
const learningRate = 0.15;
const penalty = 0.05;

function labelFor(candidate: ChallengeRankingCase, label: RankingLabel): boolean | null {
  if (label === "targeted") return candidate.targetedMismatch;
  return candidate.feedback === null ? null : candidate.feedback === "helpful";
}

function featureVector(candidate: ChallengeRankingCase, position: number): number[] {
  return [
    position,
    Math.log1p(candidate.inputChars),
    Math.log1p(candidate.inputLines),
    Math.log1p(candidate.inputTokens),
    Math.log1p(candidate.reasonChars),
    Number(candidate.hasSuggestedOutput),
  ];
}

export function mergeChallengeRankingDatasets(datasets: ChallengeRankingDataset[]): ChallengeRankingDataset {
  const first = datasets[0];
  if (!first) throw new Error("Provide at least one ranking dataset.");
  const groups = new Map<string, ChallengeRankingGroup>();
  for (const dataset of datasets) {
    if (dataset.source !== first.source) throw new Error("Compare benchmark and practice datasets in separate runs.");
    for (const group of dataset.groups) {
      const existing = groups.get(group.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(group)) {
        throw new Error("Two datasets contain different versions of one challenge. Use a single version of that export.");
      }
      groups.set(group.id, group);
      if (groups.size > CHALLENGE_RANKING_GROUP_LIMIT) throw new Error("The combined dataset exceeds the challenge limit.");
    }
  }
  return { ...first, groups: [...groups.values()] };
}

function problemOrder(key: string) {
  return createHash("sha256").update(`forma-ranking-v1:${key}`).digest("hex");
}

export function splitChallengeRanking(dataset: ChallengeRankingDataset) {
  const problemSplits = new Map<string, ChallengeRankingGroup["split"]>();
  for (const group of dataset.groups) {
    if (problemSplits.has(group.problemKey) && problemSplits.get(group.problemKey) !== group.split) {
      throw new Error("One problem appears in more than one ranking split.");
    }
    problemSplits.set(group.problemKey, group.split);
  }
  const keys = [...problemSplits.keys()];
  if (dataset.source === "practice") {
    const ordered = keys.map(key => ({ key, hash: problemOrder(key) }))
      .sort((left, right) => left.hash.localeCompare(right.hash) || left.key.localeCompare(right.key));
    const holdoutCount = Math.max(0, Math.min(ordered.length - 1, Math.max(2, Math.round(ordered.length / 4))));
    const held = new Set(ordered.slice(0, holdoutCount).map(item => item.key));
    for (const key of keys) problemSplits.set(key, held.has(key) ? "holdout" : "development");
  } else if (keys.some(key => problemSplits.get(key) === null)) {
    throw new Error("Benchmark groups need explicit development or holdout splits.");
  }
  return {
    development: dataset.groups.filter(group => problemSplits.get(group.problemKey) === "development"),
    holdout: dataset.groups.filter(group => problemSplits.get(group.problemKey) === "holdout"),
    developmentProblems: keys.filter(key => problemSplits.get(key) === "development").length,
    holdoutProblems: keys.filter(key => problemSplits.get(key) === "holdout").length,
  };
}

function trainingPairs(groups: ChallengeRankingGroup[], label: RankingLabel) {
  const byProblem = new Map<string, number[][]>();
  for (const group of groups) {
    const positive: number[][] = [], negative: number[][] = [];
    group.cases.forEach((candidate, position) => {
      const target = labelFor(candidate, label);
      if (target !== null) (target ? positive : negative).push(featureVector(candidate, position));
    });
    if (!positive.length || !negative.length) continue;
    const problemPairs = byProblem.get(group.problemKey) ?? [];
    for (const better of positive) {
      for (const worse of negative) problemPairs.push(better.map((value, index) => value - worse[index]));
    }
    byProblem.set(group.problemKey, problemPairs);
  }
  const examples = [...byProblem.values()].flatMap(pairs =>
    pairs.map(delta => ({ delta, weight: 1 / (byProblem.size * pairs.length) })));
  return { examples, problems: byProblem.size };
}

function dot(left: readonly number[], right: readonly number[]) {
  return left.reduce((total, value, index) => total + value * right[index], 0);
}

function train(examples: ReturnType<typeof trainingPairs>["examples"]) {
  // Weight each problem equally, including problems with many repeated challenges.
  const scale = featureNames.map((_, index) => Math.sqrt(examples.reduce(
    (total, example) => total + example.weight * example.delta[index] ** 2, 0,
  )) || 1);
  const normalized = examples.map(({ delta, weight }) => ({ values: delta.map((value, index) => value / scale[index]), weight }));
  let weights = featureNames.map(() => 0);
  for (let iteration = 0; iteration < pairwiseIterations; iteration++) {
    const gradient = weights.map(weight => penalty * weight);
    for (const example of normalized) {
      const lossGradient = -example.weight / (1 + Math.exp(dot(weights, example.values)));
      example.values.forEach((value, index) => { gradient[index] += lossGradient * value; });
    }
    weights = weights.map((weight, index) => weight - learningRate * gradient[index]);
  }
  return weights.map((weight, index) => weight / scale[index]);
}

type OrderCases = (group: ChallengeRankingGroup) => ChallengeRankingCase[];

const original: OrderCases = group => group.cases;
const shortestFirst: OrderCases = group => [...group.cases].sort((left, right) => left.inputChars - right.inputChars);

function trainedOrder(weights: number[]): OrderCases {
  return group => group.cases.map((candidate, position) => ({ candidate, score: dot(weights, featureVector(candidate, position)) }))
    .sort((left, right) => right.score - left.score).map(({ candidate }) => candidate);
}

function measure(groups: ChallengeRankingGroup[], order: OrderCases, label: RankingLabel) {
  let noCandidate = 0, unlabeledFirst = 0, positiveFirst = 0, negativeFirst = 0;
  for (const group of groups) {
    const [first] = order(group);
    if (!first) { noCandidate++; continue; }
    const target = labelFor(first, label);
    if (target === null) unlabeledFirst++;
    else if (target) positiveFirst++;
    else negativeFirst++;
  }
  const labeledFirst = positiveFirst + negativeFirst;
  return {
    challenges: groups.length, noCandidate, unlabeledFirst, labeledFirst, positiveFirst, negativeFirst,
    positiveRateAmongLabeledFirst: labeledFirst ? positiveFirst / labeledFirst : null,
    firstCaseTargetedMismatchRate: label === "targeted" && !unlabeledFirst && groups.length
      ? positiveFirst / groups.length : null,
  };
}

function measureSearchEffort(groups: ChallengeRankingGroup[], order: OrderCases) {
  const firstMismatchAt = Array.from({ length: CHALLENGE_CASE_LIMIT }, () => 0);
  let found = 0, attemptsToFind = 0, attempts = 0;
  for (const group of groups) {
    const ordered = order(group);
    const index = ordered.findIndex(candidate => candidate.targetedMismatch === true);
    if (index === -1) {
      attempts += ordered.length;
      continue;
    }
    firstMismatchAt[index]++;
    found++;
    attemptsToFind += index + 1;
    attempts += index + 1;
  }
  return {
    found, exhausted: groups.length - found, firstMismatchAt,
    meanCasesUntilMismatch: found ? attemptsToFind / found : null,
    meanCasesAttempted: groups.length ? attempts / groups.length : null,
  };
}

export function compareChallengeRanking(dataset: ChallengeRankingDataset, label: RankingLabel) {
  if ((dataset.source === "benchmark") !== (label === "targeted")) {
    throw new Error("Use targeted mismatch labels for benchmarks and explicit feedback labels for practice exports.");
  }
  const split = splitChallengeRanking(dataset);
  const pairs = trainingPairs(split.development, label);
  const labeledHoldoutProblems = new Set(split.holdout.filter(group =>
    group.cases.some(candidate => labelFor(candidate, label) !== null),
  ).map(group => group.problemKey)).size;
  const reasons = [];
  if (pairs.problems < minTrainingProblems) reasons.push(`Need at least ${minTrainingProblems} development problems with both a positive and negative case in one challenge.`);
  if (labeledHoldoutProblems < minHoldoutProblems) reasons.push(`Need labels on at least ${minHoldoutProblems} separate held-out problems.`);

  const weights = reasons.length ? null : train(pairs.examples);
  const ranker = weights ? trainedOrder(weights) : null;
  const commonLabeled = split.holdout.filter(group => {
    const chosen = [original, shortestFirst, ...(ranker ? [ranker] : [])].map(order => order(group)[0]);
    return chosen.every(candidate => candidate && labelFor(candidate, label) !== null);
  });
  const challengesWithPositiveCase = split.holdout.filter(group =>
    group.cases.some(candidate => labelFor(candidate, label) === true),
  ).length;
  const fullyLabeled = split.holdout.filter(group => group.cases.every(candidate => candidate.targetedMismatch !== null));
  return {
    format: "forma-challenge-ranking-comparison" as const,
    version: 1 as const,
    source: dataset.source,
    label,
    split: {
      developmentProblems: split.developmentProblems, developmentChallenges: split.development.length,
      holdoutProblems: split.holdoutProblems, holdoutChallenges: split.holdout.length,
      informativeDevelopmentProblems: pairs.problems, trainingPairs: pairs.examples.length, labeledHoldoutProblems,
    },
    methods: {
      original: measure(split.holdout, original, label),
      shortestFirst: measure(split.holdout, shortestFirst, label),
      trained: ranker ? measure(split.holdout, ranker, label) : null,
    },
    commonLabeled: {
      challenges: commonLabeled.length,
      original: measure(commonLabeled, original, label).positiveRateAmongLabeledFirst,
      shortestFirst: measure(commonLabeled, shortestFirst, label).positiveRateAmongLabeledFirst,
      trained: ranker ? measure(commonLabeled, ranker, label).positiveRateAmongLabeledFirst : null,
    },
    challengesWithPositiveCase,
    searchEffort: label === "targeted" ? {
      scoredChallenges: fullyLabeled.length,
      unscoredChallenges: split.holdout.length - fullyLabeled.length,
      original: measureSearchEffort(fullyLabeled, original),
      shortestFirst: measureSearchEffort(fullyLabeled, shortestFirst),
      trained: ranker ? measureSearchEffort(fullyLabeled, ranker) : null,
    } : null,
    training: weights ? {
      status: "trained" as const,
      algorithm: "pairwise-logistic",
      weights: Object.fromEntries(featureNames.map((feature, index) => [feature, weights[index]])),
    } : { status: "insufficient-labels" as const, reasons },
  };
}
