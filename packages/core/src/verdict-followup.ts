import type { CompanionState, CompanionSubmission } from './companion';
import { canonicalProblemIdentity, normalizeCodeforcesIdentity } from './codeforces-identity';
import type { Data } from '../../../src/lib/model';
import type { SubmissionInput } from '../../../src/lib/codeforces-types';

export const DISCOVERY_MS = 5 * 60_000;
export const PENDING_MS = 15 * 60_000;
export interface VerdictFollowup {
  id: string; problemId: string; identity: string; handle: string;
  startedAt: string; finishedAt: string | null; discoveryUntil: string | null;
  pendingUntil: string | null; checkedAt: string | null; nextCheckAt: string;
  status: 'searching' | 'pending' | 'final' | 'temporary-failure' | 'expired';
  error: string | null;
}
const iso = (n: number) => new Date(n).toISOString();
function discoveryOpen(f: VerdictFollowup, now: number) {
  return f.finishedAt === null || (!!f.discoveryUntil && now <= Date.parse(f.discoveryUntil));
}
function pendingOpen(f: VerdictFollowup, now: number) {
  return f.status !== 'final' && !!f.pendingUntil && now <= Date.parse(f.pendingUntil);
}
export function followupDue(f: VerdictFollowup, now: number) {
  return (discoveryOpen(f, now) || pendingOpen(f, now)) && now >= Date.parse(f.nextCheckAt);
}
export function expireFollowups(state: CompanionState, now: number): CompanionState {
  return { ...state, followups: (state.followups ?? []).map(f =>
    f.status !== 'final' && !discoveryOpen(f, now) && !pendingOpen(f, now) ? { ...f, status: 'expired' as const } : f) };
}
/** Receipt time never widens the immutable attempt interval. Unknown evidence stays unassigned. */
export function reconcileFollowups(state: CompanionState, handle: string, rows: SubmissionInput[], now: number, error: string | null = null, data?: Data): CompanionState {
  const at = iso(now), followups = state.followups ?? [];
  const retained = new Map(state.submissions.map(s => [`${s.handle.toLowerCase()}:${s.id}`, s]));
  if (!error) for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || !Number.isFinite(Date.parse(row.submittedAt)) || row.submittedAt > at) continue;
    if(normalizeCodeforcesIdentity({url:row.problem.url,code:row.problem.code})?.key!==row.problem.key)continue;
    const key = `${handle.toLowerCase()}:${row.id}`, old = retained.get(key);
    if (old && (old.identity !== row.problem.key || old.submittedAt !== row.submittedAt || old.observedAt > at)) continue;
    const windows=new Map(followups.filter(f=>f.handle.toLowerCase()===handle.toLowerCase()&&f.identity===row.problem.key).map(f=>[f.id,{id:f.id,startedAt:f.startedAt,finishedAt:f.finishedAt??at,attributable:true}]));
    for(const attempt of data?.attempts??[]){
      const problem=data!.problems.find(p=>p.id===attempt.problemId);
      if(!windows.has(attempt.id)&&problem&&canonicalProblemIdentity(problem)===row.problem.key&&(!problem.cfHandle||problem.cfHandle.toLowerCase()===handle.toLowerCase()))windows.set(attempt.id,{id:attempt.id,startedAt:attempt.startedAt,finishedAt:attempt.completedAt,attributable:false});
    }
    const matches = [...windows.values()].filter(f=>row.submittedAt>=f.startedAt&&row.submittedAt<=f.finishedAt);
    const sessionId = old?.sessionId ?? (matches.length === 1 && matches[0].attributable ? matches[0].id : undefined);
    retained.set(key, { id: row.id, handle, identity: row.problem.key, verdict: row.verdict, submittedAt: row.submittedAt, observedAt: at, ...(sessionId ? { sessionId } : {}) });
  }
  const submissions = [...retained.values()].slice(-1000);
  const next = followups.map(f => {
    if (f.handle.toLowerCase() !== handle.toLowerCase()) return f;
    const evidence = submissions.filter(s => s.sessionId === f.id && s.handle.toLowerCase() === handle.toLowerCase());
    const pending = evidence.some(s => s.verdict === null || s.verdict === 'TESTING');
    const pendingUntil = f.pendingUntil ?? (pending ? iso(now + PENDING_MS) : null);
    const expired = !discoveryOpen(f, now) && !(pendingUntil && now <= Date.parse(pendingUntil));
    return { ...f, checkedAt: at, nextCheckAt: iso(now + (error ? 60_000 : 30_000)), pendingUntil,
      status: error ? (evidence.length&&!pending ? 'final' : expired ? 'expired' : 'temporary-failure') : pending ? (expired ? 'expired' : 'pending') : evidence.length ? 'final' : expired ? 'expired' : 'searching', error } as VerdictFollowup;
  });
  const selected = next.filter(f => f.problemId === state.problemId && f.handle.toLowerCase() === state.handle?.toLowerCase()).at(-1);
  const current: CompanionSubmission[] = selected ? submissions.filter(s => s.sessionId === selected.id) : [];
  const platform = !current.length ? 'unknown' : current.some(s => s.verdict === 'OK') ? 'accepted' : current.some(s => s.verdict === null || s.verdict === 'TESTING') ? 'pending' : 'rejected';
  return { ...state, followups: next, submissions, ...(handle.toLowerCase() === state.handle?.toLowerCase() ? { platform, checkedAt: at } : {}) };
}
