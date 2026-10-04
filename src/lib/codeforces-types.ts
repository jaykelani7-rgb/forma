import type { Difficulty, Outcome, Problem } from "./model";

export const CF_PAGE_SIZE = 50;
export const CF_INBOX_SIZE = 5;
export const DEFAULT_REVIEW_DAYS = { unsolved: 1, editorial: 3, hint: 5 };
export type ReviewDays = typeof DEFAULT_REVIEW_DAYS;
export interface PublicProfile { handle: string; rating: number | null; rank: string | null; }
export interface SyncedProfile extends PublicProfile {
  lastSyncAt: string | null;
  lastVisitAt: string | null;
  sinceAt: string | null;
  nextFrom: number;
  historyComplete: boolean;
  gapUntilId: number | null;
}
export interface PlatformSubmission {
  id: number;
  handle: string;
  problemId: string;
  submittedAt: string;
  verdict: string | null;
  language: string;
}
export interface ImportedAttempt {
  id: string;
  handle: string;
  problemId: string;
  submissionIds: number[];
  firstSubmittedAt: string;
  lastSubmittedAt: string;
  inbox: boolean;
  skipped: boolean;
  wasRevisit: boolean;
}
export interface QuickReflection {
  attemptId: string;
  outcome: Outcome;
  difficulty: Difficulty | null;
  takeaway: string;
  savedAt: string;
}
export interface CodeforcesData {
  connectedHandle: string | null;
  profiles: SyncedProfile[];
  submissions: PlatformSubmission[];
  practiceAttempts: ImportedAttempt[];
  reflections: QuickReflection[];
}
export interface SubmissionInput {
  id: number;
  submittedAt: string;
  verdict: string | null;
  language: string;
  problem: { key: string; title: string; code: string; url: string; rating: number | null; tags: string[] };
}
export interface ActivityPage { handle: string; from: number; count: number; submissions: SubmissionInput[]; }
export const emptyCodeforces = (): CodeforcesData => ({ connectedHandle: null, profiles: [], submissions: [], practiceAttempts: [], reflections: [] });
export const handleKey = (handle: string) => handle.toLowerCase();
export function validHandle(handle: string) { return /^[A-Za-z0-9_.-]{3,24}$/.test(handle); }

// Validate persisted/imported platform data as strictly as the original notebook.
export function validateCodeforces(input: unknown, problems: Problem[]): CodeforcesData {
  const fail = (): never => { throw new Error("Codeforces history has invalid fields, duplicate identities, or broken relationships."); };
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
  const stamp = (v: unknown): v is string => text(v,40) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
  const normalizeStamp = (v:unknown) => v===null?null:new Date(v as string).toISOString();
  const nullableStamp = (v: unknown) => v === null || stamp(v);
  const integer = (v: unknown, min=0, max=Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  if (!obj(input) || !(input.connectedHandle === null || (text(input.connectedHandle,24) && validHandle(input.connectedHandle))) || !Array.isArray(input.profiles) || input.profiles.length > 50 || !Array.isArray(input.submissions) || input.submissions.length > 50000 || !Array.isArray(input.practiceAttempts) || input.practiceAttempts.length > 50000 || !Array.isArray(input.reflections) || input.reflections.length > 50000) return fail();
  const profiles: SyncedProfile[] = [];
  const handles = new Set<string>();
  for (const p of input.profiles) {
    if (!obj(p) || !text(p.handle,24) || !validHandle(p.handle) || handles.has(handleKey(p.handle)) || !(p.rating === null || integer(p.rating,0,10000)) || !(p.rank === null || text(p.rank,100)) || !nullableStamp(p.lastSyncAt) || !nullableStamp(p.lastVisitAt) || !nullableStamp(p.sinceAt) || !integer(p.nextFrom,1,10000000) || typeof p.historyComplete !== "boolean" || !(p.gapUntilId === null || integer(p.gapUntilId,1))) return fail();
    handles.add(handleKey(p.handle));
    profiles.push({handle:p.handle,rating:p.rating as number|null,rank:p.rank as string|null,lastSyncAt:normalizeStamp(p.lastSyncAt),lastVisitAt:normalizeStamp(p.lastVisitAt),sinceAt:normalizeStamp(p.sinceAt),nextFrom:p.nextFrom,historyComplete:p.historyComplete,gapUntilId:p.gapUntilId as number|null});
  }
  if (input.connectedHandle && !handles.has(handleKey(input.connectedHandle))) return fail();
  const problemMap = new Map(problems.map(p=>[p.id,p]));
  const scoped = (id: unknown, handle: string) => typeof id === "string" && handleKey(problemMap.get(id)?.cfHandle ?? "") === handleKey(handle);
  const submissions: PlatformSubmission[] = [];
  const submissionMap = new Map<string,PlatformSubmission>();
  for (const s of input.submissions) {
    if (!obj(s) || !integer(s.id,1) || !text(s.handle,24) || !handles.has(handleKey(s.handle)) || !scoped(s.problemId,s.handle) || !stamp(s.submittedAt) || !(s.verdict === null || (text(s.verdict,80) && /^[A-Z_0-9]+$/.test(s.verdict))) || !text(s.language,120)) return fail();
    const key = `${handleKey(s.handle)}:${s.id}`;
    if (submissionMap.has(key)) return fail();
    const value = {id:s.id,handle:s.handle,problemId:s.problemId as string,submittedAt:new Date(s.submittedAt).toISOString(),verdict:s.verdict as string|null,language:s.language};
    submissions.push(value); submissionMap.set(key,value);
  }
  const practiceAttempts: ImportedAttempt[] = [];
  const attemptIds = new Set<string>();
  const membership = new Set<string>();
  for (const a of input.practiceAttempts) {
    if (!obj(a) || !text(a.id,100) || !a.id || attemptIds.has(a.id) || !text(a.handle,24) || !handles.has(handleKey(a.handle)) || !scoped(a.problemId,a.handle) || !Array.isArray(a.submissionIds) || !a.submissionIds.length || a.submissionIds.length > 50000 || !stamp(a.firstSubmittedAt) || !stamp(a.lastSubmittedAt) || Date.parse(a.firstSubmittedAt) > Date.parse(a.lastSubmittedAt) || typeof a.inbox !== "boolean" || typeof a.skipped !== "boolean" || typeof a.wasRevisit !== "boolean") return fail();
    const times: string[] = [];
    for (const id of a.submissionIds) {
      const key=`${handleKey(a.handle)}:${id}`;
      const sub=submissionMap.get(key);
      if (!integer(id,1) || !sub || sub.problemId !== a.problemId || membership.has(key)) return fail();
      times.push(sub.submittedAt); membership.add(key);
    }
    times.sort();
    if (times[0] !== normalizeStamp(a.firstSubmittedAt) || times.at(-1) !== normalizeStamp(a.lastSubmittedAt)) return fail();
    attemptIds.add(a.id);
    practiceAttempts.push({id:a.id,handle:a.handle,problemId:a.problemId as string,submissionIds:[...a.submissionIds],firstSubmittedAt:normalizeStamp(a.firstSubmittedAt)!,lastSubmittedAt:normalizeStamp(a.lastSubmittedAt)!,inbox:a.inbox,skipped:a.skipped,wasRevisit:a.wasRevisit});
  }
  if (membership.size !== submissions.length) return fail();
  const reflections: QuickReflection[] = [];
  const reflected = new Set<string>();
  for (const r of input.reflections) {
    if (!obj(r) || !text(r.attemptId,100) || !attemptIds.has(r.attemptId) || reflected.has(r.attemptId) || !["independent","hint","editorial","unsolved"].includes(r.outcome as string) || !(r.difficulty === null || ["approach","coding","edges","complexity","debugging"].includes(r.difficulty as string)) || !text(r.takeaway,300) || !stamp(r.savedAt)) return fail();
    reflected.add(r.attemptId);
    reflections.push({attemptId:r.attemptId,outcome:r.outcome as Outcome,difficulty:r.difficulty as Difficulty|null,takeaway:r.takeaway,savedAt:normalizeStamp(r.savedAt)!});
  }
  for (const p of problems) {
    if (p.cfHandle && !handles.has(handleKey(p.cfHandle))) return fail();
    if (p.reviewAttemptId && !practiceAttempts.some(a=>a.id===p.reviewAttemptId&&a.problemId===p.id)) return fail();
  }
  return {connectedHandle:input.connectedHandle as string|null,profiles,submissions,practiceAttempts,reflections};
}
