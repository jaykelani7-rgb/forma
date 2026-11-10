import {
  CHALLENGE_CASE_LIMIT, CHALLENGE_RUN_LIMIT, CHALLENGE_RUN_LIMITS,
  readChallengeCaseId, readChallengeFeedbackLabel,
  type ChallengeFeedbackLabel, type ChallengeRunReceipt,
} from "./challenge-run";
import { IDEA_LIMITS } from "./idea";
import type { IdeaChallengeCase } from "./types";

export const CHALLENGE_RANKING_GROUP_LIMIT = 40_000;

type RankingRun = Pick<ChallengeRunReceipt, "outcome" | "expectedSource">;

export interface ChallengeRankingCase {
  id: string;
  inputChars: number;
  inputLines: number;
  inputTokens: number;
  reasonChars: number;
  hasSuggestedOutput: boolean;
  runs: RankingRun[];
  feedback: ChallengeFeedbackLabel | null;
  targetedMismatch: boolean | null;
}

export interface ChallengeRankingGroup {
  id: string;
  problemKey: string;
  split: "development" | "holdout" | null;
  cases: ChallengeRankingCase[];
}

export interface ChallengeRankingDataset {
  format: "forma-challenge-ranking";
  version: 1;
  source: "practice" | "benchmark";
  groups: ChallengeRankingGroup[];
}

export function challengeRankingFeatures(candidate: Pick<IdeaChallengeCase, "input" | "reason" | "expectedOutput">) {
  const { input, reason, expectedOutput } = candidate;
  const words = input.trim();
  return {
    inputChars: input.length,
    inputLines: input ? input.split(/\r\n|[\r\n]/).length : 0,
    inputTokens: words ? words.split(/\s+/u).length : 0,
    reasonChars: reason.length,
    hasSuggestedOutput: expectedOutput !== null,
  };
}

function invalid(): never {
  throw new Error("The challenge ranking dataset has invalid fields.");
}

function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) return invalid();
  return input as Record<string, unknown>;
}

function key(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(input)) return invalid();
  return input;
}

function count(input: unknown, limit: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0 || input > limit) return invalid();
  return input;
}

function readRun(input: unknown): RankingRun {
  const { outcome, expectedSource } = fields(input, ["outcome", "expectedSource"]);
  if (outcome !== "match" && outcome !== "mismatch" && outcome !== "compile-error" &&
    outcome !== "runtime-error" && outcome !== "timeout" && outcome !== "output-limit") return invalid();
  if (expectedSource !== "statement-sample" && expectedSource !== "user" && expectedSource !== "reference") return invalid();
  return { outcome, expectedSource };
}

function readCase(input: unknown, index: number, source: ChallengeRankingDataset["source"]): ChallengeRankingCase {
  const value = fields(input, [
    "id", "inputChars", "inputLines", "inputTokens", "reasonChars", "hasSuggestedOutput", "runs", "feedback", "targetedMismatch",
  ]);
  const id = readChallengeCaseId(value.id);
  const inputChars = count(value.inputChars, CHALLENGE_RUN_LIMITS.input);
  const inputLines = count(value.inputLines, inputChars ? inputChars + 1 : 0);
  const inputTokens = count(value.inputTokens, inputChars);
  const reasonChars = count(value.reasonChars, IDEA_LIMITS.observation);
  const { hasSuggestedOutput, runs, feedback, targetedMismatch } = value;
  if (id !== `case-${index + 1}` || typeof hasSuggestedOutput !== "boolean" ||
    !Array.isArray(runs) || runs.length > CHALLENGE_RUN_LIMIT ||
    (targetedMismatch !== null && typeof targetedMismatch !== "boolean")) return invalid();
  if (source === "practice" && targetedMismatch !== null) return invalid();
  if (source === "benchmark" && (runs.length || feedback !== null)) return invalid();
  return {
    id, inputChars, inputLines, inputTokens, reasonChars, hasSuggestedOutput,
    runs: runs.map(readRun),
    feedback: feedback === null ? null : readChallengeFeedbackLabel(feedback),
    targetedMismatch,
  };
}

export function readChallengeRankingDataset(input: unknown): ChallengeRankingDataset {
  const value = fields(input, ["format", "version", "source", "groups"]);
  const { source } = value;
  if (value.format !== "forma-challenge-ranking" || value.version !== 1 ||
    (source !== "practice" && source !== "benchmark") ||
    !Array.isArray(value.groups) || value.groups.length > CHALLENGE_RANKING_GROUP_LIMIT) return invalid();
  const ids = new Set<string>();
  const splits = new Map<string, ChallengeRankingGroup["split"]>();
  const groups = value.groups.map((inputGroup): ChallengeRankingGroup => {
    const group = fields(inputGroup, ["id", "problemKey", "split", "cases"]);
    const id = key(group.id);
    const problemKey = key(group.problemKey);
    const { split, cases } = group;
    if (ids.has(id) || !Array.isArray(cases) || cases.length > CHALLENGE_CASE_LIMIT ||
      (split !== null && split !== "development" && split !== "holdout") ||
      (source === "practice" ? split !== null : split === null)) return invalid();
    if (splits.has(problemKey) && splits.get(problemKey) !== split) {
      throw new Error("A problem appears in both challenge ranking splits.");
    }
    ids.add(id);
    splits.set(problemKey, split);
    return { id, problemKey, split, cases: cases.map((candidate, index) => readCase(candidate, index, source)) };
  });
  return { format: "forma-challenge-ranking", version: 1, source, groups };
}
