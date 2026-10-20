import type { CompanionSnapshot } from "./companion";
export type CaptureTarget = { problemKey: string; sessionId?: string; title: string };
/** Capture when opening an input surface, not when its delayed submission completes. */
export function freezeCaptureTarget(snapshot: CompanionSnapshot): CaptureTarget | undefined {
  if (!snapshot.state.identity) return;
  return { problemKey: snapshot.state.identity, ...(snapshot.data.session ? { sessionId: snapshot.data.session.id } : {}), title: snapshot.data.problems.find(p => p.id === snapshot.state.problemId)?.title ?? snapshot.state.identity };
}
export function capturePreconditions(target: CaptureTarget) {
  return { expectedProblemKey: target.problemKey, ...(target.sessionId ? { expectedSessionId: target.sessionId } : {}) };
}
