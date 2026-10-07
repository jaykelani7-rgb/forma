import type { Data, Duration, Problem, Session } from "./model";

/** Fresh practice creates its problem and session in one revision. The regular
 * path requires a saved problem, so failed dependent writes cannot orphan it. */
export function withPracticeSession(
  data: Data,
  problem: Problem,
  duration: Duration,
  now: number,
  id: string,
  fresh = false,
): Data {
  if (data.session) throw new Error("A session is already open.");
  const saved = data.problems.find((value) => value.id === problem.id);
  if (!saved && !fresh)
    throw new Error(
      "This problem has not been saved. Retry saving it before starting practice.",
    );
  const session: Session = {
    id,
    problemId: problem.id,
    startedAt: new Date(now).toISOString(),
    runningSince: now,
    elapsedMs: 0,
    targetMinutes: duration,
    notes: "",
    timerVisible: true,
    phase: "focus",
  };
  return {
    ...data,
    problems: saved ? data.problems : [...data.problems, problem],
    session,
  };
}
