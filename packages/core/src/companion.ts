import { parseCommand, type CompanionCommand, type CommandPayloads } from "../../contracts/src/index";
import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from "./codeforces-identity";
import { deferProblem, elapsed, localDate, nextReview, validateData, type Attempt, type Data, type Problem } from "../../../src/lib/model";
import { withPracticeSession } from "../../../src/lib/practice-session";
import { memorySummary, revisionHandle, saveRevision, suggestedRecallDate } from "../../../src/lib/memory";
import { validateReflectionMemory } from "../../../src/lib/memory-types";
import { revisitItems } from "../../../src/lib/practice-state";
import type { SubmissionInput } from "../../../src/lib/codeforces-types";

export interface CompanionThought { id: string; problemId: string; text: string; createdAt: string }
export interface CompanionBinding { id: string; problemId: string; identity: string; fileUri: string; confirmedAt: string; workspaceId?: string; clientId?: string; source?: "manual" | "cph" | "browser"; adapterVersion?: string }
export interface CompanionSubmission { id: number; handle: string; identity: string; verdict: string | null; submittedAt: string; observedAt: string; sessionId?: string }
export interface CompanionState {
  version: 1;
  problemId: string | null;
  identity: string | null;
  lifecycle: "ready" | "working" | "paused" | "closed";
  localTests: "unknown" | "running" | "passed" | "failed" | "stale";
  platform: "unknown" | "pending" | "accepted" | "rejected";
  learning: "unrecorded" | "independent" | "hint" | "editorial" | "unsolved";
  thoughts: CompanionThought[];
  bindings: CompanionBinding[];
  submissions: CompanionSubmission[];
  handle: string | null;
  checkedAt: string | null;
}
export const initialCompanionState = (): CompanionState => ({ version: 1, problemId: null, identity: null, lifecycle: "ready", localTests: "unknown", platform: "unknown", learning: "unrecorded", thoughts: [], bindings: [], submissions: [], handle: null, checkedAt: null });
export const createCompanionState = initialCompanionState;
export interface CompanionSnapshot { data: Data; state: CompanionState }
const finiteNow = (now: number) => { if (!Number.isFinite(now) || now < 0 || now > 8.64e15) throw new Error("Invalid observation time."); return new Date(now).toISOString(); };
function currentProblem(data: Data, state: CompanionState): Problem {
  const problem = data.problems.find((p) => p.id === state.problemId);
  if (!problem) throw new Error("Attach a Codeforces problem first.");
  if (problem.cfHandle && problem.cfHandle.toLowerCase() !== state.handle?.toLowerCase()) throw new Error("This problem belongs to another Codeforces profile. Attach it for the selected profile before continuing.");
  return problem;
}
function currentSession(data: Data, state: CompanionState) {
  const problem = currentProblem(data, state);
  if (!data.session || data.session.problemId !== problem.id) throw new Error("Start a timed session for this problem first.");
  return data.session;
}
/** Pause only measured time. The host calls this before suspend, quit and recovery. */
export function pauseCompanionForLifecycle(data: Data, state: CompanionState, now: number): CompanionSnapshot {
  finiteNow(now);
  if (!data.session) return { data, state };
  return {
    data: { ...data, session: { ...data.session, elapsedMs: elapsed(data.session, now), runningSince: null } },
    state: { ...state, lifecycle: "paused" },
  };
}
/** A host transaction persists the returned notebook, state and command ID together. */
export function applyCompanionCommand(data: Data, state: CompanionState, input: CompanionCommand | unknown, now: number): CompanionSnapshot {
  const command = parseCommand(input, now);
  const stamp = finiteNow(now);
  if (command.expectedProblemKey !== undefined && command.expectedProblemKey !== state.identity) throw new Error("The active problem changed. Resolve this queued command before retrying.");
  if (command.expectedSessionId !== undefined && command.expectedSessionId !== data.session?.id) throw new Error("The active session changed. Resolve this queued command before retrying.");
  switch (command.type) {
    case "attach": {
      const identity = normalizeCodeforcesIdentity(command.payload.url);
      // Manual attach accepts URLs only, never a title, guessed number or arbitrary link.
      if (!identity || !/^https?:\/\//i.test(command.payload.url)) throw new Error("Attach a supported Codeforces problem URL.");
      const activate = command.payload.activate !== false;
      if (activate && data.session && canonicalProblemIdentity(currentProblem(data, { ...state, problemId: data.session.problemId })) !== identity.key) throw new Error("Finish the open session before switching problems.");
      const previous = state.bindings.find((b) => b.fileUri === command.payload.fileUri && (!b.clientId || b.clientId === command.payload.clientId));
      if (previous && command.payload.source === "cph" && !command.payload.replace && (previous.identity !== identity.key || previous.source === "manual" || previous.source === "browser")) throw new Error("This file already has a confirmed association. Resolve it explicitly before using CPH metadata.");
      const candidates = data.problems.filter((p) => canonicalProblemIdentity(p) === identity.key && (!p.cfHandle || p.cfHandle.toLowerCase() === state.handle?.toLowerCase()));
      const existing = (data.session ? candidates.find((p) => p.id === data.session!.problemId) : undefined) ?? candidates.find((p) => !p.cfHandle) ?? candidates[0];
      const problem: Problem = existing ?? { id: `companion:${command.id}`, title: command.payload.title?.trim() || `Codeforces ${identity.code}`, platform: "Codeforces", url: identity.url, problemCode: identity.code, tags: [], rating: null, createdAt: stamp, reviewAt: null, reviewCount: 0 };
      const same = state.problemId === problem.id;
      const sameFile = !command.payload.fileUri || state.bindings.some((b) => b.problemId === problem.id && b.fileUri === command.payload.fileUri);
      const binding: CompanionBinding | null = command.payload.fileUri ? { id: command.id, problemId: problem.id, identity: identity.key, fileUri: command.payload.fileUri, confirmedAt: stamp, ...(command.payload.workspaceId ? { workspaceId: command.payload.workspaceId } : {}), ...(command.payload.clientId ? { clientId: command.payload.clientId } : {}), ...(command.payload.source ? { source: command.payload.source } : {}), ...(command.payload.adapterVersion ? { adapterVersion: command.payload.adapterVersion } : {}) } : null;
      const bindings = binding ? [...state.bindings.filter((b) => b !== previous), binding] : state.bindings;
      if (bindings.length > 500) throw new Error("This device has reached its 500 solution binding limit. Export your notebook and remove an old binding before attaching another file.");
      return { data: existing ? data : { ...data, problems: [...data.problems, problem] }, state: { ...state, ...(activate ? { problemId: problem.id, identity: identity.key, lifecycle: same ? state.lifecycle : "ready", localTests: same && sameFile ? state.localTests : "unknown", platform: same ? state.platform : "unknown", learning: same ? state.learning : "unrecorded" } : {}), bindings } };
    }
    case "forget-binding": case "rename-binding": {
      const matches = (b: CompanionBinding) => b.fileUri === command.payload.fileUri && (!b.clientId || b.clientId === command.payload.clientId);
      if (command.payload.bindingId && state.bindings.some(b => matches(b) && b.id !== command.payload.bindingId)) throw new Error("The file association changed. Keep this capture for recovery before retrying.");
      if (command.type === "rename-binding" && state.bindings.some((b) => b.fileUri === command.payload.newFileUri)) throw new Error("The renamed file already has an association. Resolve it before transferring this binding.");
      const bindings = command.type === "forget-binding" ? state.bindings.filter((b) => !matches(b)) : state.bindings.map((b) => matches(b) ? { ...b, fileUri: command.payload.newFileUri } : b);
      return { data, state: { ...state, bindings } };
    }
    case "start": {
      const problem = currentProblem(data, state);
      if (data.attempts.some((attempt) => attempt.id === `companion:${command.id}`)) throw new Error("This session ID already belongs to a saved attempt. Start again with a new command ID.");
      return { data: withPracticeSession(data, problem, command.payload.durationMinutes ?? data.settings.defaultDuration, now, `companion:${command.id}`), state: { ...state, lifecycle: "working", learning: "unrecorded", platform: "unknown" } };
    }
    case "pause": {
      currentSession(data, state);
      return pauseCompanionForLifecycle(data, state, now);
    }
    case "resume": {
      const session = currentSession(data, state);
      if (session.phase === "reflection") throw new Error("Save the reflection before starting another session.");
      if (session.runningSince !== null) return { data, state };
      return { data: { ...data, session: { ...session, runningSince: now } }, state: { ...state, lifecycle: "working" } };
    }
    case "finish": {
      const session = currentSession(data, state);
      return { data: { ...data, session: { ...session, runningSince: null, elapsedMs: elapsed(session, now), phase: "reflection" } }, state: { ...state, lifecycle: "paused" } };
    }
    case "thought": {
      const problem = currentProblem(data, state);
      const thought = { id: command.id, problemId: problem.id, text: command.payload.text.trim(), createdAt: stamp };
      const thoughts = [...state.thoughts.filter((t) => t.id !== thought.id), thought];
      if (thoughts.length > 1000) throw new Error("This device has reached its 1,000 thought limit. Export your notebook and archive older thoughts before saving another.");
      // Untimed thoughts are device memory, never manufactured attempts or coding time.
      return { data, state: { ...state, thoughts } };
    }
    case "reflect": {
      const problem = currentProblem(data, state);
      const session = currentSession(data, state);
      const result = finishPracticeReflection(data, session.id, command.payload, now);
      return { data: result, state: { ...state, learning: command.payload.outcome, lifecycle: "closed", problemId: problem.id } };
    }
    case "recall": {
      const problem = currentProblem(data, state);
      return { data: saveRevision(data, { id: `companion:${command.id}`, problemId: problem.id, handle: revisionHandle(data, problem.id), ...command.payload, completedAt: stamp, nextReviewAt: suggestedRecallDate(data, command.payload.outcome, new Date(now)) }), state };
    }
    case "defer": {
      const problem = currentProblem(data, state);
      return { data: deferProblem(data, problem.id, command.payload.until), state };
    }
    case "set-handle": {
      if (data.session) throw new Error("Finish the open session before changing the Codeforces profile.");
      const handle = command.payload.handle;
      const selected = data.problems.find((p) => p.id === state.problemId);
      const foreignProfile = !!selected?.cfHandle && selected.cfHandle.toLowerCase() !== handle?.toLowerCase();
      // Public-handle selection grants no account authorization and no learning credit.
      const profiles = handle && !data.codeforces.profiles.some((p) => p.handle.toLowerCase() === handle.toLowerCase()) ? [...data.codeforces.profiles, { handle, rating: null, rank: null, lastSyncAt: null, lastVisitAt: null, sinceAt: null, nextFrom: 1, historyComplete: false, gapUntilId: null }] : data.codeforces.profiles;
      return { data: { ...data, codeforces: { ...data.codeforces, connectedHandle: handle, profiles } }, state: { ...state, ...(foreignProfile ? { problemId: null, identity: null, learning: "unrecorded" as const, lifecycle: "ready" as const, localTests: "unknown" as const } : {}), handle, platform: "unknown", checkedAt: null, submissions: [] } };
    }
  }
}

/** The same nextReview/elapsed/memory validators as the website; no imported or fake timer. */
export function finishPracticeReflection(data: Data, sessionId: string, payload: CommandPayloads["reflect"], now: number): Data {
  const stamp = finiteNow(now);
  const session = data.session;
  if (!session || session.id !== sessionId) throw new Error("The timed session changed. Reopen its reflection.");
  const problem = data.problems.find((p) => p.id === session.problemId);
  if (!problem) throw new Error("The session problem is no longer available.");
  const review = nextReview(problem, payload.outcome, new Date(now), data.settings.reviewDays);
  const memory = validateReflectionMemory(payload);
  const attempt = { id: session.id, problemId: problem.id, startedAt: session.startedAt, completedAt: stamp, elapsedMs: elapsed(session, now), outcome: payload.outcome, difficulty: payload.difficulty ?? null, takeaway: payload.takeaway?.trim() ?? "", notes: payload.notes ?? session.notes, ...memory, ...(session.trackContext ? { trackContext: session.trackContext } : {}) };
  return recordPracticeReflection(data, attempt, review);
}

/** Shared final write used by the web reflection form and companion command. */
export function recordPracticeReflection(data: Data, attempt: Attempt, review: Pick<Problem, "reviewAt" | "reviewCount">, options: { reviewManual?: boolean; completedRevisit?: boolean } = {}): Data {
  if (data.session && data.session.id !== attempt.id) throw new Error("Another session is now active. Review your recovery copy before saving this reflection.");
  const previous = data.attempts.find((row) => row.id === attempt.id);
  if (previous && (previous.problemId !== attempt.problemId || previous.startedAt !== attempt.startedAt)) throw new Error("A saved attempt cannot be reassigned to another problem or session.");
  return validateData({ ...data, session: null, attempts: data.attempts.some((a) => a.id === attempt.id) ? data.attempts.map((a) => a.id === attempt.id ? attempt : a) : [...data.attempts, attempt], problems: data.problems.map((p) => p.id === attempt.problemId ? { ...p, ...review, reviewManual: options.reviewManual ?? false, reviewUpdatedAt: attempt.completedAt, ...(p.cfHandle ? { reviewAttemptId: undefined } : {}), ...(options.completedRevisit && p.reviewAt ? { reviewCompletedAt: attempt.completedAt } : {}) } : p) });
}

/** Submitted platform evidence is independent of the user's retained reflection. */
export function applySubmissionEvidence(data: Data, state: CompanionState, evidence: { handle: string; submissions: SubmissionInput[]; checkedAt: string }, now = Date.now()): CompanionSnapshot {
  finiteNow(now);
  if (!state.handle || evidence.handle.toLowerCase() !== state.handle.toLowerCase() || !Number.isFinite(Date.parse(evidence.checkedAt)) || (state.checkedAt && evidence.checkedAt < state.checkedAt)) return { data, state };
  const session = data.session?.problemId === state.problemId ? data.session : null;
  const latestAttempt = data.attempts.filter((a) => a.problemId === state.problemId).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  const windowStart = session?.startedAt ?? latestAttempt?.startedAt;
  const windowEnd = session ? undefined : latestAttempt?.completedAt;
  const selectedSessionId = session?.id ?? latestAttempt?.id;
  const scopedProblems = new Set(data.problems.filter((p) => canonicalProblemIdentity(p) === state.identity && (!p.cfHandle || p.cfHandle.toLowerCase() === state.handle?.toLowerCase())).map((p) => p.id));
  const candidates = new Map(data.attempts.filter((a) => scopedProblems.has(a.problemId)).map((a) => [a.id, { id: a.id, startedAt: a.startedAt, completedAt: a.completedAt }]));
  if (data.session && scopedProblems.has(data.session.problemId)) candidates.set(data.session.id, { id: data.session.id, startedAt: data.session.startedAt, completedAt: evidence.checkedAt });
  const retained = new Map(state.submissions.map((s) => [s.id, s]));
  for (const submission of evidence.submissions) {
    const previous = retained.get(submission.id);
    if (!Number.isSafeInteger(submission.id) || submission.id < 1 || submission.problem.key !== state.identity || !Number.isFinite(Date.parse(submission.submittedAt))) continue;
    if (previous && (previous.handle.toLowerCase() !== evidence.handle.toLowerCase() || previous.identity !== submission.problem.key || previous.submittedAt !== submission.submittedAt)) continue;
    const matches = [...candidates.values()].filter((candidate) => submission.submittedAt >= candidate.startedAt && submission.submittedAt <= candidate.completedAt && submission.submittedAt <= evidence.checkedAt);
    if (!previous && matches.length !== 1) continue;
    const canonical = normalizeCodeforcesIdentity({ url: submission.problem.url, code: submission.problem.code });
    if (canonical?.key !== state.identity) continue;
    if (previous && previous.observedAt > evidence.checkedAt) continue;
    retained.set(submission.id, { id: submission.id, handle: evidence.handle, identity: canonical.key, verdict: submission.verdict, submittedAt: submission.submittedAt, observedAt: evidence.checkedAt, ...(previous?.sessionId ? { sessionId: previous.sessionId } : matches.length === 1 ? { sessionId: matches[0].id } : {}) });
  }
  const submissions = [...retained.values()].slice(-1000);
  const current = submissions.filter((s) => s.identity === state.identity && s.handle.toLowerCase() === state.handle?.toLowerCase() && (s.sessionId ? s.sessionId === selectedSessionId : windowStart && s.submittedAt >= windowStart && (!windowEnd || s.submittedAt <= windowEnd))).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id - a.id);
  const platform = current.some((s) => s.verdict === "OK") ? "accepted" : !current.length ? "unknown" : current[0].verdict === null || current[0].verdict === "TESTING" ? "pending" : "rejected";
  return { data, state: { ...state, submissions, platform, checkedAt: evidence.checkedAt } };
}
export function invalidateLocalTests(state: CompanionState, fileUri?: string): CompanionState {
  if (fileUri && !state.bindings.some((b) => b.problemId === state.problemId && b.fileUri === fileUri)) return state;
  return { ...state, localTests: state.localTests === "unknown" ? "unknown" : "stale" };
}
export function getCompanionView(data: Data, state: CompanionState, now = Date.now()) {
  const problem = data.problems.find((p) => p.id === state.problemId) ?? null;
  const session = data.session?.problemId === problem?.id ? data.session : null;
  const today=localDate(new Date(now));
  const due=revisitItems(data,new Date(now)).filter(item=>item.dueAt!<=today&&!item.skipped&&(!item.deferredUntil||item.deferredUntil<=today)).map(item=>item.problem);
  return { problem, session: session ? { id: session.id, elapsedMs: elapsed(session, now), running: session.runningSince !== null, phase: session.phase, targetMinutes: session.targetMinutes } : null, memory: problem ? memorySummary(data, problem.id) : null, due };
}

/** Reject corrupt device-state writes instead of losing notes or trusting statuses. */
export function validateCompanionState(input: unknown, data: Data): CompanionState {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid companion state.");
  const state = input as CompanionState;
  const member = (v: unknown, options: string[]) => typeof v === "string" && options.includes(v);
  const stamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const ids = new Set(data.problems.map((p) => p.id));
  if (state.version !== 1 || !(state.problemId === null || ids.has(state.problemId)) || !(state.identity === null || (typeof state.identity === "string" && /^(contest|gym):\d+:[A-Z]\d*$/.test(state.identity))) || !member(state.lifecycle, ["ready", "working", "paused", "closed"]) || !member(state.localTests, ["unknown", "running", "passed", "failed", "stale"]) || !member(state.platform, ["unknown", "pending", "accepted", "rejected"]) || !member(state.learning, ["unrecorded", "independent", "hint", "editorial", "unsolved"]) || !(state.handle === null || (typeof state.handle === "string" && /^[A-Za-z0-9_.-]{3,24}$/.test(state.handle))) || !(state.checkedAt === null || stamp(state.checkedAt)) || !Array.isArray(state.thoughts) || state.thoughts.length > 1000 || !Array.isArray(state.bindings) || state.bindings.length > 500 || !Array.isArray(state.submissions) || state.submissions.length > 1000) throw new Error("Invalid companion state fields.");
  for (const thought of state.thoughts) if (!thought || typeof thought.id !== "string" || !ids.has(thought.problemId) || typeof thought.text !== "string" || thought.text.length > 10000 || !stamp(thought.createdAt)) throw new Error("Invalid saved thought.");
  for (const binding of state.bindings) { if (!binding || typeof binding.id !== "string" || !ids.has(binding.problemId) || canonicalProblemIdentity(data.problems.find((p) => p.id === binding.problemId)!) !== binding.identity || !stamp(binding.confirmedAt)) throw new Error("Invalid solution binding."); parseCommand({ id: binding.id, type: "attach", payload: { url: data.problems.find((p) => p.id === binding.problemId)!.url, fileUri: binding.fileUri, ...(binding.workspaceId ? { workspaceId: binding.workspaceId } : {}), ...(binding.clientId ? { clientId: binding.clientId } : {}), ...(binding.source ? { source: binding.source } : {}), ...(binding.adapterVersion ? { adapterVersion: binding.adapterVersion } : {}) } }); }
  for (const s of state.submissions) if (!s || !Number.isSafeInteger(s.id) || s.id < 1 || typeof s.handle !== "string" || !/^[A-Za-z0-9_.-]{3,24}$/.test(s.handle) || typeof s.identity !== "string" || !/^(contest|gym):\d+:[A-Z]\d*$/.test(s.identity) || !(s.verdict === null || (typeof s.verdict === "string" && s.verdict.length <= 100)) || !stamp(s.submittedAt) || !stamp(s.observedAt)) throw new Error("Invalid platform evidence.");
  for (const s of state.submissions) {
    if (s.sessionId === undefined) continue; // Older local projections predate explicit attribution.
    if (typeof s.sessionId !== "string" || !s.sessionId.length || s.sessionId.length > 100) throw new Error("Invalid platform session attribution.");
    const target = data.session?.id === s.sessionId ? data.session : data.attempts.find((a) => a.id === s.sessionId);
    const problem = target ? data.problems.find((p) => p.id === target.problemId) : undefined;
    if (!target || !problem || canonicalProblemIdentity(problem) !== s.identity || (problem.cfHandle && problem.cfHandle.toLowerCase() !== s.handle.toLowerCase()) || s.submittedAt < target.startedAt || s.submittedAt > ("completedAt" in target ? target.completedAt : s.observedAt)) throw new Error("Platform evidence does not belong to its recorded session.");
  }
  if (state.problemId && canonicalProblemIdentity(data.problems.find((p) => p.id === state.problemId)!) !== state.identity) throw new Error("The companion problem identity changed.");
  return structuredClone(state);
}
