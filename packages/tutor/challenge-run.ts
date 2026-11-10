export const CHALLENGE_RUN_LIMIT = 12;
export const CHALLENGE_RUN_LIMITS = { input: 600, output: 4_000, expectedOutput: 4_000, diagnostic: 2_000 } as const;
export const CHALLENGE_CASE_LIMIT = 3;
export const FIRST_CHALLENGE_CASE_ID = "case-1";
export const CHALLENGE_FEEDBACK_LABELS = ["helpful", "wrong-assumption", "invalid-input"] as const;

export type ChallengeFeedbackLabel = typeof CHALLENGE_FEEDBACK_LABELS[number];
export interface ChallengeFeedback {
  caseId: string;
  label: ChallengeFeedbackLabel;
  recordedAt: string;
}

export interface ChallengeCaseState {
  caseId: string | null;
  runs: ChallengeRunReceipt[];
  feedback: ChallengeFeedback[];
}

const executionOutcomes = ["exited", "compile-error", "runtime-error", "timeout", "output-limit"] as const;
const receiptOutcomes = ["match", "mismatch", "compile-error", "runtime-error", "timeout", "output-limit"] as const;
type ExpectedSource = "statement-sample" | "user" | "reference";

export interface ChallengeReference {
  fileName: string;
  sourceHash: string;
}

export interface ChallengeRunTarget {
  fileUri: string;
  workspaceId: string;
  clientId: string;
}

export interface ChallengeRunPlan {
  turnId: string;
  requestId: string;
  caseId: string;
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
  caseId?: string;
  recoveryEpoch: string;
  sourceHash: string;
  output: string;
  outcome: typeof executionOutcomes[number];
  diagnostic: string;
  expectedOutput: string;
  expectedSource: ExpectedSource;
  reference?: ChallengeReference;
}

export interface ChallengeRunReceipt {
  id: string;
  caseId?: string;
  input: string;
  expectedOutput: string;
  expectedSource: ExpectedSource;
  reference?: ChallengeReference;
  sourceHash: string;
  fileName: string;
  output: string;
  outcome: typeof receiptOutcomes[number];
  diagnostic: string;
  ranAt: string;
}

export type ChallengeRunRequest =
  | { operation: "review"; target: ChallengeRunTarget; withReference?: true }
  | { operation: "record"; target: ChallengeRunTarget; run: ChallengeRunSubmission };

function invalid(): never {
  throw new Error("The challenge run has invalid fields.");
}

function record(value: unknown, keys?: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (keys && (keys.some(key => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key)))) return invalid();
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
  if (value !== "statement-sample" && value !== "user" && value !== "reference") return invalid();
  return value;
}

function basenameLabel(value: unknown): string {
  const fileName = text(value, 250, 1);
  if (/[\\/\r\n]/.test(fileName)) return invalid();
  return fileName;
}

function readReference(value: Record<string, unknown>, source: ExpectedSource): ChallengeReference | undefined {
  if (Object.hasOwn(value, "reference") !== (source === "reference")) return invalid();
  if (source !== "reference") return;
  const reference = record(value.reference, ["fileName", "sourceHash"]);
  return { fileName: basenameLabel(reference.fileName), sourceHash: sourceHash(reference.sourceHash) };
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  return found ?? invalid();
}

export function readChallengeCaseId(value: unknown): string {
  if (typeof value !== "string" || !/^case-[1-3]$/.test(value)) return invalid();
  return value;
}

export function readChallengeFeedbackLabel(value: unknown): ChallengeFeedbackLabel {
  return oneOf(value, CHALLENGE_FEEDBACK_LABELS);
}

export function readChallengeFeedback(input: unknown): ChallengeFeedback {
  const value = record(input, ["caseId", "label", "recordedAt"]);
  const recordedAt = text(value.recordedAt, 40, 1);
  if (!Number.isFinite(Date.parse(recordedAt))) return invalid();
  return { caseId: readChallengeCaseId(value.caseId), label: readChallengeFeedbackLabel(value.label), recordedAt };
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
    record(value, ["operation", "target"], ["withReference"]);
    const withReference = Object.hasOwn(value, "withReference");
    if (withReference && value.withReference !== true) return invalid();
    return {
      operation: "review", target: readTarget(value.target),
      ...(withReference ? { withReference: true as const } : {}),
    };
  }
  if (value.operation !== "record") return invalid();
  record(value, ["operation", "target", "run"]);
  const run = record(value.run, [
    "id", "turnId", "requestId", "recoveryEpoch", "sourceHash", "output", "outcome", "diagnostic", "expectedOutput", "expectedSource",
  ], ["caseId", "reference"]);
  const source = expectedSource(run.expectedSource);
  const reference = readReference(run, source);
  return {
    operation: "record",
    target: readTarget(value.target),
    run: {
      id: id(run.id), turnId: id(run.turnId), requestId: id(run.requestId), recoveryEpoch: id(run.recoveryEpoch),
      sourceHash: sourceHash(run.sourceHash), output: text(run.output, CHALLENGE_RUN_LIMITS.output),
      outcome: oneOf(run.outcome, executionOutcomes), diagnostic: text(run.diagnostic, CHALLENGE_RUN_LIMITS.diagnostic),
      expectedOutput: text(run.expectedOutput, CHALLENGE_RUN_LIMITS.expectedOutput), expectedSource: source,
      ...(Object.hasOwn(run, "caseId") ? { caseId: readChallengeCaseId(run.caseId) } : {}),
      ...(reference ? { reference } : {}),
    },
  };
}

export function readChallengeRunPlan(input: unknown): ChallengeRunPlan {
  const value = record(input, ["turnId", "requestId", "problemTitle", "assumption", "input", "sampleOutput", "recoveryEpoch", "sessionId"], ["caseId"]);
  return {
    turnId: id(value.turnId), requestId: id(value.requestId), recoveryEpoch: id(value.recoveryEpoch),
    caseId: Object.hasOwn(value, "caseId") ? readChallengeCaseId(value.caseId) : FIRST_CHALLENGE_CASE_ID,
    problemTitle: text(value.problemTitle, 240, 1), assumption: text(value.assumption, 250, 1),
    input: text(value.input, CHALLENGE_RUN_LIMITS.input),
    sampleOutput: value.sampleOutput === null ? null : text(value.sampleOutput, CHALLENGE_RUN_LIMITS.expectedOutput),
    sessionId: value.sessionId === null ? null : id(value.sessionId),
  };
}

export function readChallengeRunReceipt(input: unknown): ChallengeRunReceipt {
  const value = record(input, [
    "id", "input", "expectedOutput", "expectedSource", "sourceHash", "fileName", "output", "outcome", "diagnostic", "ranAt",
  ], ["caseId", "reference"]);
  const source = expectedSource(value.expectedSource);
  const reference = readReference(value, source);
  const fileName = basenameLabel(value.fileName);
  const ranAt = text(value.ranAt, 40, 1);
  if (!Number.isFinite(Date.parse(ranAt))) return invalid();
  return {
    id: id(value.id), input: text(value.input, CHALLENGE_RUN_LIMITS.input),
    expectedOutput: text(value.expectedOutput, CHALLENGE_RUN_LIMITS.expectedOutput), expectedSource: source,
    sourceHash: sourceHash(value.sourceHash), fileName, output: text(value.output, CHALLENGE_RUN_LIMITS.output),
    outcome: oneOf(value.outcome, receiptOutcomes), diagnostic: text(value.diagnostic, CHALLENGE_RUN_LIMITS.diagnostic), ranAt,
    ...(Object.hasOwn(value, "caseId") ? { caseId: readChallengeCaseId(value.caseId) } : {}),
    ...(reference ? { reference } : {}),
  };
}

export function readChallengeCaseState(input: unknown): ChallengeCaseState {
  const value = record(input, ["caseId", "runs", "feedback"]);
  if (!Array.isArray(value.runs) || value.runs.length > CHALLENGE_RUN_LIMIT * CHALLENGE_CASE_LIMIT ||
    !Array.isArray(value.feedback) || value.feedback.length > CHALLENGE_CASE_LIMIT) return invalid();
  const caseId = value.caseId === null ? null : readChallengeCaseId(value.caseId);
  const runs = value.runs.map(readChallengeRunReceipt);
  const feedback = value.feedback.map(readChallengeFeedback);
  if ((caseId === null && (runs.length || feedback.length)) ||
    new Set(runs.map(run => run.id)).size !== runs.length ||
    new Set(feedback.map(entry => entry.caseId)).size !== feedback.length) return invalid();
  return { caseId, runs, feedback };
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
