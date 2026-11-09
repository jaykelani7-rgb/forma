import type { IdeaChallenge, IdeaOutline } from "./types";

export const IDEA_LIMITS = {
  explanation: 4_000,
  approach: 800,
  assumption: 250,
  assumptions: 4,
  uncertainty: 400,
  observation: 500,
  question: 300,
  example: 600,
} as const;

function readResult(text: string, keys: readonly string[]) {
  const clean = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(clean);
  let value: unknown;
  try {
    value = JSON.parse(fenced ? fenced[1] : clean);
  } catch {
    throw new Error("Tutor did not return a readable result. Try the request again.");
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
  ) throw new Error("Tutor returned an incomplete result. Try the request again.");
  return value as Record<string, unknown>;
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
  const { observation, question, exampleInput, expectedOutput } = readResult(text, ["observation", "question", "exampleInput", "expectedOutput"]);
  if (exampleInput === null && expectedOutput !== null) {
    throw new Error("Tutor returned an expected output without an input. Try the challenge again.");
  }
  return {
    observation: line(observation, IDEA_LIMITS.observation),
    question: line(question, IDEA_LIMITS.question),
    exampleInput: sample(exampleInput),
    expectedOutput: sample(expectedOutput),
  };
}
