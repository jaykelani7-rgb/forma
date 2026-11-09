import type { CompanionState } from "../../packages/core/src/companion";
import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from "./codeforces-identity";
import { activeContest } from "./contest-lab";
import { emptyData, validateData, type Data, type Problem, type Session } from "./model";

export interface SessionHandoffPacket {
  version: 1;
  problem: Pick<Problem, "title" | "url" | "problemCode" | "rating">;
  session: Pick<Session, "id" | "startedAt" | "elapsedMs" | "targetMinutes" | "notes"> & {
    runningSince: null;
    phase: "focus";
  };
  thread: string;
}

export interface HandoffRemote {
  state: "missing" | "linked" | "ready" | "received" | "cancelled";
  accountId?: string;
  accountLabel?: string;
  sessionId?: string;
  packet?: SessionHandoffPacket;
}

export const isHandoffId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const isHandoffAccountId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isHandoffKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{43}$/.test(value);
export const isHandoffDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function fields(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new Error("This handoff contains unsupported fields.");
  }
  return input as Record<string, unknown>;
}

const text = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const integer = (value: unknown, max: number, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

function handoffNotes(notes: string, thread: string) {
  return [notes, thread.trim() && `Next step from the Ribbon\n${thread}`].filter(Boolean).join("\n\n");
}

/** A portable session contains only the chosen problem, paused timer, and notes. */
export function parseSessionHandoffPacket(input: unknown): SessionHandoffPacket {
  const value = fields(input, ["version", "problem", "session", "thread"]);
  const problem = fields(value.problem, ["title", "url", "problemCode", "rating"]);
  const session = fields(value.session, ["id", "startedAt", "elapsedMs", "targetMinutes", "notes", "runningSince", "phase"]);
  const identity = text(problem.url, 400, 1) ? normalizeCodeforcesIdentity(problem.url) : null;
  if (value.version !== 1 || !identity || problem.url !== identity.url || problem.problemCode !== identity.code
    || !text(problem.title, 240, 1) || !problem.title.trim()
    || !(problem.rating === null || integer(problem.rating, 10_000))
    || !text(session.id, 100, 1) || !/^companion:[\w-]+$/.test(session.id)
    || !text(session.startedAt, 40, 20) || !/^\d{4}-\d\d-\d\dT/.test(session.startedAt) || !Number.isFinite(Date.parse(session.startedAt))
    || !integer(session.elapsedMs, 31_536_000_000) || !integer(session.targetMinutes, 180, 1)
    || session.runningSince !== null || session.phase !== "focus" || !text(session.notes, 50_000)
    || !text(value.thread, 1000)) {
    throw new Error("This handoff is not a supported paused Codeforces session.");
  }
  if (handoffNotes(session.notes, value.thread).length > 50_000) {
    throw new Error("The session notes and thread are too long to transfer together.");
  }
  return {
    version: 1,
    problem: { title: problem.title, url: identity.url, problemCode: identity.code, rating: problem.rating },
    session: {
      id: session.id, startedAt: new Date(session.startedAt).toISOString(), elapsedMs: session.elapsedMs,
      targetMinutes: session.targetMinutes, notes: session.notes, runningSince: null, phase: "focus",
    },
    thread: value.thread,
  };
}

export function makeSessionHandoffPacket(data: Data, state: CompanionState): SessionHandoffPacket {
  const session = data.session;
  const problem = session && data.problems.find(item => item.id === session.problemId);
  const identity = problem && normalizeCodeforcesIdentity(problem.url);
  if (!session || session.runningSince !== null || session.phase !== "focus" || !problem
    || state.problemId !== problem.id || !identity || state.identity !== identity.key) {
    throw new Error("Pause the current problem before continuing on web.");
  }
  const thread = state.desk?.findLast(item => item.kind === "thread" && item.problemId === problem.id)?.text ?? "";
  return parseSessionHandoffPacket({
    version: 1,
    problem: { title: problem.title, url: identity.url, problemCode: identity.code, rating: problem.rating },
    session: {
      id: session.id, startedAt: session.startedAt, elapsedMs: session.elapsedMs, targetMinutes: session.targetMinutes,
      notes: session.notes, runningSince: null, phase: "focus",
    },
    thread,
  });
}

/** Import into a single existing workspace revision. Never replace its open work. */
export function applySessionHandoff(data: Data | null, input: SessionHandoffPacket): Data {
  const packet = parseSessionHandoffPacket(input);
  const workspace = data ?? emptyData();
  if (workspace.session) throw new Error("Finish the open web session before receiving this one.");
  if (activeContest(workspace)) throw new Error("Finish the active web contest before receiving this session.");
  if (workspace.attempts.some(attempt => attempt.id === packet.session.id)) {
    throw new Error("This attempt is already in your web notebook.");
  }
  const identity = normalizeCodeforcesIdentity(packet.problem.url)!;
  const existing = workspace.problems.find(problem => !problem.cfHandle && canonicalProblemIdentity(problem) === identity.key)
    ?? workspace.problems.find(problem => problem.cfHandle && problem.cfHandle.toLowerCase() === workspace.codeforces.connectedHandle?.toLowerCase()
      && canonicalProblemIdentity(problem) === identity.key);
  const problem: Problem = existing ?? {
    ...packet.problem, id: `handoff-problem:${identity.key}`, platform: "Codeforces", tags: [],
    createdAt: packet.session.startedAt, reviewAt: null, reviewCount: 0,
  };
  return validateData({
    ...workspace,
    problems: existing ? workspace.problems : [...workspace.problems, problem],
    session: { ...packet.session, problemId: problem.id, timerVisible: true, notes: handoffNotes(packet.session.notes, packet.thread) },
  });
}
