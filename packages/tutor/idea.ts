import { CHALLENGE_CASE_LIMIT, FIRST_CHALLENGE_CASE_ID, challengeOutputEqual } from "./challenge-run";
import type { IdeaChallenge, IdeaChallengeCase, IdeaOutline } from "./types";

export const IDEA_LIMITS = {
  explanation: 4_000,
  approach: 800,
  assumption: 250,
  assumptions: 4,
  uncertainty: 400,
  observation: 500,
  question: 300,
  example: 600,
  reason: 300,
} as const;

function readFields(value: unknown, keys?: readonly string[]) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    (keys && (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))))
  ) throw new Error("Tutor returned an incomplete result. Try the request again.");
  return value as Record<string, unknown>;
}

function readResult(text: string, keys?: readonly string[]) {
  const clean = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(clean);
  let value: unknown;
  try {
    value = JSON.parse(fenced ? fenced[1] : clean);
  } catch {
    throw new Error("Tutor did not return a readable result. Try the request again.");
  }
  return readFields(value, keys);
}

function line(value: unknown, limit: number, optional = false) {
  if (typeof value !== "string" || value.includes("\0") || value.trim().length > limit || (!optional && !value.trim())) {
    throw new Error("Tutor returned an incomplete result. Try the request again.");
  }
  return value.trim();
}

function sample(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || value.includes("\0") || value.length > IDEA_LIMITS.example) {
    throw new Error("Tutor returned an invalid test case. Try the challenge again.");
  }
  return value;
}

export function readIdeaOutline(text: string): IdeaOutline {
  const { approach, assumptions, uncertainty } = readResult(text, ["approach", "assumptions", "uncertainty"]);
  if (!Array.isArray(assumptions) || assumptions.length > IDEA_LIMITS.assumptions) {
    throw new Error("Tutor returned an incomplete outline. Try the request again.");
  }
  return {
    approach: line(approach, IDEA_LIMITS.approach),
    assumptions: assumptions.map(value => line(value, IDEA_LIMITS.assumption)),
    uncertainty: line(uncertainty, IDEA_LIMITS.uncertainty, true),
  };
}

export function readIdeaQuestion(text: string) {
  try {
    const { approach, assumption, uncertainty } = readResult(text, ["approach", "assumption", "uncertainty"]);
    return {
      approach: line(approach, IDEA_LIMITS.approach),
      assumption: line(assumption, IDEA_LIMITS.assumption),
      uncertainty: line(uncertainty, IDEA_LIMITS.uncertainty, true),
    };
  } catch {
    throw new Error("Review your approach and select one assumption before sending.");
  }
}

export function readIdeaChallenge(text: string): IdeaChallenge {
  const result = readResult(text);
  const observation = line(result.observation, IDEA_LIMITS.observation);
  const question = line(result.question, IDEA_LIMITS.question);
  if (!Object.hasOwn(result, "cases")) {
    const { exampleInput, expectedOutput } = readFields(result, ["observation", "question", "exampleInput", "expectedOutput"]);
    const input = sample(exampleInput);
    const output = sample(expectedOutput);
    if (input === null && output !== null) {
      throw new Error("Tutor returned an expected output without an input. Try the challenge again.");
    }
    const cases = input === null ? [] : [{ id: FIRST_CHALLENGE_CASE_ID, input, expectedOutput: output, reason: observation }];
    return { observation, question, cases };
  }

  const { cases: candidates } = readFields(result, ["observation", "question", "cases"]);
  if (!Array.isArray(candidates) || candidates.length > CHALLENGE_CASE_LIMIT) {
    throw new Error("Tutor returned an invalid list of cases. Try the challenge again.");
  }
  const cases: IdeaChallengeCase[] = [];
  for (const candidate of candidates) {
    const { input, expectedOutput, reason } = readFields(candidate, ["input", "expectedOutput", "reason"]);
    const caseInput = sample(input);
    if (caseInput === null) throw new Error("Tutor returned a case without an input. Try the challenge again.");
    const output = sample(expectedOutput);
    const explanation = line(reason, IDEA_LIMITS.reason);
    if (cases.some(existing => challengeOutputEqual(existing.input, caseInput))) continue;
    cases.push({ id: `case-${cases.length + 1}`, input: caseInput, expectedOutput: output, reason: explanation });
  }
  return { observation, question, cases };
}
