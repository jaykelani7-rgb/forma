export const CHALLENGE_RUN_LIMIT = 12;
export const CHALLENGE_RUN_LIMITS = { input: 600, output: 4_000, expectedOutput: 4_000, diagnostic: 2_000 } as const;

const executionOutcomes = ["exited", "compile-error", "runtime-error", "timeout", "output-limit"] as const;
const receiptOutcomes = ["match", "mismatch", "compile-error", "runtime-error", "timeout", "output-limit"] as const;
type ExpectedSource = "statement-sample" | "user";

export interface ChallengeRunTarget {
  fileUri: string;
  workspaceId: string;
  clientId: string;
}

export interface ChallengeRunPlan {
  turnId: string;
  requestId: string;
  problemTitle: string;
  assumption: string;
  input: string;
  sampleOutput: string | null;
  recoveryEpoch: string;
  sessionId: string | null;
}

export interface ChallengeRunSubmission {
  id: string;
  turnId: string;
  requestId: string;
  recoveryEpoch: string;
  sourceHash: string;
  output: string;
  outcome: typeof executionOutcomes[number];
  diagnostic: string;
  expectedOutput: string;
  expectedSource: ExpectedSource;
}

export interface ChallengeRunReceipt {
  id: string;
  input: string;
  expectedOutput: string;
  expectedSource: ExpectedSource;
  sourceHash: string;
  fileName: string;
  output: string;
  outcome: typeof receiptOutcomes[number];
  diagnostic: string;
  ranAt: string;
}

export type ChallengeRunRequest =
  | { operation: "review"; target: ChallengeRunTarget }
  | { operation: "record"; target: ChallengeRunTarget; run: ChallengeRunSubmission };

function invalid(): never {
  throw new Error("The challenge run has invalid fields.");
}

function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (keys && (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number, min = 0): string {
  if (typeof value !== "string" || value.length < min || value.length > limit || value.includes("\0")) return invalid();
  return value;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) return invalid();
  return value;
}

function sourceHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}

function expectedSource(value: unknown): ExpectedSource {
  if (value !== "statement-sample" && value !== "user") return invalid();
  return value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  return found ?? invalid();
}

function readTarget(input: unknown): ChallengeRunTarget {
  const value = record(input, ["fileUri", "workspaceId", "clientId"]);
  const fileUri = text(value.fileUri, 4_000, 1);
  try {
    const url = new URL(fileUri);
    if (url.protocol !== "file:" || url.host || url.search || url.hash || url.pathname === "/") return invalid();
  } catch {
    return invalid();
  }
  return { fileUri, workspaceId: id(value.workspaceId), clientId: id(value.clientId) };
}

export function parseChallengeRunRequest(input: unknown): ChallengeRunRequest {
  const value = record(input);
  if (value.operation === "review") {
    record(value, ["operation", "target"]);
    return { operation: "review", target: readTarget(value.target) };
  }
  if (value.operation !== "record") return invalid();
  record(value, ["operation", "target", "run"]);
  const run = record(value.run, [
    "id", "turnId", "requestId", "recoveryEpoch", "sourceHash", "output", "outcome", "diagnostic", "expectedOutput", "expectedSource",
  ]);
  return {
    operation: "record",
    target: readTarget(value.target),
    run: {
      id: id(run.id), turnId: id(run.turnId), requestId: id(run.requestId), recoveryEpoch: id(run.recoveryEpoch),
      sourceHash: sourceHash(run.sourceHash), output: text(run.output, CHALLENGE_RUN_LIMITS.output),
      outcome: oneOf(run.outcome, executionOutcomes), diagnostic: text(run.diagnostic, CHALLENGE_RUN_LIMITS.diagnostic),
      expectedOutput: text(run.expectedOutput, CHALLENGE_RUN_LIMITS.expectedOutput), expectedSource: expectedSource(run.expectedSource),
    },
  };
}

export function readChallengeRunPlan(input: unknown): ChallengeRunPlan {
  const value = record(input, ["turnId", "requestId", "problemTitle", "assumption", "input", "sampleOutput", "recoveryEpoch", "sessionId"]);
  return {
    turnId: id(value.turnId), requestId: id(value.requestId), recoveryEpoch: id(value.recoveryEpoch),
    problemTitle: text(value.problemTitle, 240, 1), assumption: text(value.assumption, 250, 1),
    input: text(value.input, CHALLENGE_RUN_LIMITS.input),
    sampleOutput: value.sampleOutput === null ? null : text(value.sampleOutput, CHALLENGE_RUN_LIMITS.expectedOutput),
    sessionId: value.sessionId === null ? null : id(value.sessionId),
  };
}

export function readChallengeRunReceipt(input: unknown): ChallengeRunReceipt {
  const value = record(input, [
    "id", "input", "expectedOutput", "expectedSource", "sourceHash", "fileName", "output", "outcome", "diagnostic", "ranAt",
  ]);
  const fileName = text(value.fileName, 250, 1);
  const ranAt = text(value.ranAt, 40, 1);
  if (/[\\/\r\n]/.test(fileName) || !Number.isFinite(Date.parse(ranAt))) return invalid();
  return {
    id: id(value.id), input: text(value.input, CHALLENGE_RUN_LIMITS.input),
    expectedOutput: text(value.expectedOutput, CHALLENGE_RUN_LIMITS.expectedOutput), expectedSource: expectedSource(value.expectedSource),
    sourceHash: sourceHash(value.sourceHash), fileName, output: text(value.output, CHALLENGE_RUN_LIMITS.output),
    outcome: oneOf(value.outcome, receiptOutcomes), diagnostic: text(value.diagnostic, CHALLENGE_RUN_LIMITS.diagnostic), ranAt,
  };
}

/** Normalize platform newlines and one optional final newline. Keep other whitespace. */
export function challengeOutputEqual(left: string, right: string): boolean {
  const comparable = (value: string) => value.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return comparable(left) === comparable(right);
}

export function challengeSampleOutput(input: string, samples: readonly { input: string; output: string }[]): string | null {
  const matches = samples.filter(sample => challengeOutputEqual(sample.input, input));
  const first = matches[0];
  return first && first.output.length <= CHALLENGE_RUN_LIMITS.expectedOutput && !first.output.includes("\0") &&
    matches.every(sample => challengeOutputEqual(sample.output, first.output)) ? first.output : null;
}
