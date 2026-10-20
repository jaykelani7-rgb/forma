/** Versioned boundary shared by the renderer, host and IDE integration. */
export const COMPANION_PROTOCOL_VERSION = 1 as const;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_QUEUED_MESSAGES = 200;
export type LearningOutcome = "independent" | "hint" | "editorial" | "unsolved";
export type ReflectionDifficulty = "approach" | "coding" | "edges" | "complexity" | "debugging";
export type Mistake = "statement" | "approach" | "invariant" | "edges" | "indexing" | "numeric" | "complexity" | "implementation" | "other";
export type CommandPayloads = {
  attach: { url: string; title?: string; fileUri?: string; workspaceId?: string; source?: "manual" | "cph"; adapterVersion?: string };
  start: { durationMinutes?: number };
  pause: Record<string, never>;
  resume: Record<string, never>;
  finish: Record<string, never>;
  thought: { text: string };
  reflect: { outcome: LearningOutcome; difficulty?: ReflectionDifficulty | null; takeaway?: string; notes?: string; mistakes?: Mistake[]; mistakeNote?: string; approach?: string };
  recall: { activity: "explain" | "complexity"; outcome: "independent" | "cue" | "unrecalled"; response: string; cue: string };
  defer: { until: string | null };
  "set-handle": { handle: string | null };
};
export type CompanionCommand = { [K in keyof CommandPayloads]: { id: string; type: K; payload: CommandPayloads[K]; expectedProblemKey?: string; expectedSessionId?: string; occurredAt?: string } }[keyof CommandPayloads];
export type EventPayloads = {
  CommandReceived: CompanionCommand;
  ProblemIdentified: CommandPayloads["attach"];
  SourceChanged: { fileUri: string; revision: string };
  LocalTestsObserved: { fileUri: string; sourceRevision: string; status: "running" | "passed" | "failed"; source: "supported-api" | "user"; adapterVersion?: string };
  SubmissionObserved: { id: number; handle: string; identity: string; verdict: string | null; submittedAt: string };
  SubmissionBatchObserved: { handle: string; checkedAt: string; submissions: { id: number; handle: string; identity: string; verdict: string | null; submittedAt: string; observedAt: string; sessionId?: string }[] };
};
type EventEnvelope = {
  eventId: string; eventVersion: 1;
  deviceId: string; workspaceKey: string;
  producer: "vscode" | "desktop" | "codeforces" | "user";
  producerVersion: string; occurredAt: string; receivedAt: string; correlationId: string;
  sourceReference?: string;
};
export type CompanionEvent = { [K in keyof EventPayloads]: EventEnvelope & { eventType: K; payload: EventPayloads[K] } }[keyof EventPayloads];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const fail = (message: string): never => { throw new Error(message); };
const choices = (v: unknown, values: readonly string[]) => typeof v === "string" && values.includes(v);
const iso = (v: unknown): v is string => string(v, 40, 20) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string => string(v, 10, 10) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function fields(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some((key) => !allowed.includes(key))) fail("This message contains unsupported fields.");
}
function optionalText(v: Record<string, unknown>, key: string, max: number) {
  if (v[key] !== undefined && !string(v[key], max)) fail(`Invalid ${key}.`);
}
function size(input: unknown) {
  let encoded: string;
  try { encoded = JSON.stringify(input); } catch { return fail("Message must be serializable."); }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_BYTES) fail("Message exceeds the supported size.");
}
/** Validate before persistence or dispatch. Unknown fields never reach privileged code. */
export function parseCommand(input: unknown, now = Date.now()): CompanionCommand {
  size(input);
  if (!object(input) || !string(input.id, 90, 1) || !string(input.type, 30, 1) || !object(input.payload)) return fail("Invalid companion command.");
  fields(input, ["id", "type", "payload", "expectedProblemKey", "expectedSessionId", "occurredAt"]);
  if (input.occurredAt !== undefined && (!iso(input.occurredAt) || Date.parse(input.occurredAt) > now + 5 * 60 * 1000)) return fail("The command time is invalid or too far in the future. Check the device clock.");
  if (input.expectedProblemKey !== undefined && (!string(input.expectedProblemKey, 100, 1) || !/^(contest|gym):\d+:[A-Z]\d*$/.test(input.expectedProblemKey))) return fail("Invalid expected problem identity.");
  if (input.expectedSessionId !== undefined && !string(input.expectedSessionId, 100, 1)) return fail("Invalid expected session.");
  const p = input.payload;
  switch (input.type) {
    case "attach": {
      fields(p, ["url", "title", "fileUri", "workspaceId", "source", "adapterVersion"]);
      if (!string(p.url, 2000, 1)) return fail("Attach requires a Codeforces URL.");
      optionalText(p, "title", 240); optionalText(p, "fileUri", 4096); optionalText(p, "workspaceId", 200); optionalText(p, "adapterVersion", 100);
      if (p.source !== undefined && !choices(p.source, ["manual", "cph"])) return fail("Invalid problem source.");
      if (p.fileUri !== undefined) { try { const u = new URL(p.fileUri as string); if (u.protocol !== "file:" || (u.hostname && u.hostname !== "localhost") || u.search || u.hash) return fail("Only a local solution file URI is supported."); } catch { return fail("Invalid local solution file URI."); } }
      break;
    }
    case "start":
      fields(p, ["durationMinutes"]);
      if (p.durationMinutes !== undefined && (typeof p.durationMinutes !== "number" || !Number.isInteger(p.durationMinutes) || p.durationMinutes < 1 || p.durationMinutes > 180)) return fail("Choose a timebox from 1 to 180 minutes.");
      break;
    case "pause": case "resume": case "finish": fields(p, []); break;
    case "thought": fields(p, ["text"]); if (!string(p.text, 10000, 1) || !p.text.trim()) return fail("Write a thought before saving."); break;
    case "reflect":
      fields(p, ["outcome", "difficulty", "takeaway", "notes", "mistakes", "mistakeNote", "approach"]);
      if (!choices(p.outcome, ["independent", "hint", "editorial", "unsolved"]) || (p.difficulty !== undefined && p.difficulty !== null && !choices(p.difficulty, ["approach", "coding", "edges", "complexity", "debugging"]))) return fail("Choose a recognised reflection outcome and difficulty.");
      optionalText(p, "takeaway", 300); optionalText(p, "notes", 10000); optionalText(p, "mistakeNote", 2000); optionalText(p, "approach", 2000);
      if (p.mistakes !== undefined && (!Array.isArray(p.mistakes) || p.mistakes.length > 9 || new Set(p.mistakes).size !== p.mistakes.length || !p.mistakes.every((m) => choices(m, ["statement", "approach", "invariant", "edges", "indexing", "numeric", "complexity", "implementation", "other"])))) return fail("Choose recognised, unique mistake labels.");
      break;
    case "recall":
      fields(p, ["activity", "outcome", "response", "cue"]);
      if (!choices(p.activity, ["explain", "complexity"]) || !choices(p.outcome, ["independent", "cue", "unrecalled"]) || !string(p.response, 10000) || !string(p.cue, 2000)) return fail("Invalid recall record.");
      break;
    case "defer": fields(p, ["until"]); if (p.until !== null && !day(p.until)) return fail("Choose a valid practice date."); break;
    case "set-handle": fields(p, ["handle"]); if (p.handle !== null && (!string(p.handle, 24, 3) || !/^[A-Za-z0-9_.-]+$/.test(p.handle))) return fail("Invalid Codeforces handle."); break;
    default: return fail("Unsupported companion command.");
  }
  return structuredClone(input) as CompanionCommand;
}
/** Provenance and each observation's payload are checked independently. */
export function parseEvent(input: unknown): CompanionEvent {
  size(input);
  if (!object(input)) return fail("Invalid companion event.");
  fields(input, ["eventId", "eventVersion", "eventType", "deviceId", "workspaceKey", "producer", "producerVersion", "occurredAt", "receivedAt", "correlationId", "sourceReference", "payload"]);
  if (!string(input.eventId, 100, 1) || input.eventVersion !== 1 || !choices(input.eventType, ["CommandReceived", "ProblemIdentified", "SourceChanged", "LocalTestsObserved", "SubmissionObserved", "SubmissionBatchObserved"]) || !string(input.deviceId, 100, 1) || !string(input.workspaceKey, 200, 1) || !choices(input.producer, ["vscode", "desktop", "codeforces", "user"]) || !string(input.producerVersion, 100, 1) || !iso(input.occurredAt) || !iso(input.receivedAt) || !string(input.correlationId, 100, 1) || (input.sourceReference !== undefined && !string(input.sourceReference, 4096))) return fail("Invalid companion event provenance.");
  if (input.eventType === "CommandReceived") parseCommand(input.payload);
  else {
    if (!object(input.payload)) return fail("Invalid observation payload.");
    const p = input.payload;
    if (input.eventType === "ProblemIdentified") parseCommand({ id: "observation", type: "attach", payload: p });
    if (input.eventType === "SourceChanged" || input.eventType === "LocalTestsObserved") {
      fields(p, input.eventType === "SourceChanged" ? ["fileUri", "revision"] : ["fileUri", "sourceRevision", "status", "source", "adapterVersion"]);
      // Reuse the local-URI check without granting this event attach authority.
      parseCommand({ id: "observation", type: "attach", payload: { url: "https://codeforces.com/contest/1/problem/A", fileUri: p.fileUri } });
      if (!string(p.fileUri, 4096, 1) || !string(p[input.eventType === "SourceChanged" ? "revision" : "sourceRevision"], 200, 1)) return fail("Source observations require a file and bounded revision.");
      if (input.eventType === "LocalTestsObserved" && (!choices(p.status, ["running", "passed", "failed"]) || !choices(p.source, ["supported-api", "user"]))) return fail("Local test results require a real supported result source.");
      optionalText(p, "adapterVersion", 100);
    }
    if (input.eventType === "SubmissionObserved") {
      fields(p, ["id", "handle", "identity", "verdict", "submittedAt"]);
      if (!Number.isSafeInteger(p.id) || (p.id as number) < 1 || !string(p.handle, 24, 3) || !/^[A-Za-z0-9_.-]+$/.test(p.handle) || !string(p.identity, 100, 1) || !/^(contest|gym):\d+:[A-Z]\d*$/.test(p.identity) || !(p.verdict === null || string(p.verdict, 100, 1)) || !iso(p.submittedAt)) return fail("Invalid authoritative submission observation.");
    }
    if (input.eventType === "SubmissionBatchObserved") {
      fields(p, ["handle", "checkedAt", "submissions"]);
      if (!string(p.handle, 24, 3) || !/^[A-Za-z0-9_.-]+$/.test(p.handle) || !iso(p.checkedAt) || !Array.isArray(p.submissions) || p.submissions.length > 1000) return fail("Invalid authoritative submission batch.");
      const ids = new Set<number>();
      for (const submission of p.submissions) {
        if (!object(submission)) return fail("Invalid authoritative submission observation.");
        fields(submission, ["id", "handle", "identity", "verdict", "submittedAt", "observedAt", "sessionId"]);
        if (!Number.isSafeInteger(submission.id) || (submission.id as number) < 1 || ids.has(submission.id as number) || !string(submission.handle, 24, 3) || submission.handle.toLowerCase() !== p.handle.toLowerCase() || !string(submission.identity, 100, 1) || !/^(contest|gym):\d+:[A-Z]\d*$/.test(submission.identity) || !(submission.verdict === null || string(submission.verdict, 100, 1)) || !iso(submission.submittedAt) || !iso(submission.observedAt) || Date.parse(submission.submittedAt) > Date.parse(submission.observedAt) || (submission.sessionId !== undefined && !string(submission.sessionId, 100, 1))) return fail("Invalid authoritative submission observation.");
        ids.add(submission.id as number);
      }
    }
  }
  return structuredClone(input) as CompanionEvent;
}
