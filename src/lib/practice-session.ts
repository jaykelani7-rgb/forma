import type { Data, Duration, Problem, Session } from "./model";
import type { TrackContext } from "./tracks-types";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";

/** Fresh practice creates its problem and session in one revision. The regular
 * path requires a saved problem, so failed dependent writes cannot orphan it. */
export function withPracticeSession(
  data: Data,
  problem: Problem,
  duration: Duration,
  now: number,
  id: string,
  fresh = false,
  context?: TrackContext,
): Data {
  if (data.session) throw new Error("A session is already open.");
  const saved = data.problems.find((value) => value.id === problem.id);
  if (!saved && !fresh)
    throw new Error(
      "This problem has not been saved. Retry saving it before starting practice.",
    );
  if (context) {
    const requested = context;
    const track = data.tracks?.find((item) => item.id === requested.trackId);
    const stage = data.trackStages?.find(
      (item) => item.id === requested.stageId && item.trackId === track?.id,
    );
    const entry = data.trackEntries?.find(
      (item) => item.id === requested.entryId && item.stageId === stage?.id,
    );
    const actualProblem = saved ?? problem;
    const identity = normalizeCodeforcesIdentity({
      url: actualProblem.url,
      code: actualProblem.problemCode,
    });
    if (
      !track ||
      !stage ||
      !entry ||
      !identity ||
      normalizeCodeforcesIdentity(entry)?.key !== identity.key
    )
      throw new Error(
        "This track entry has changed. Return to the stage and choose the problem again.",
      );
    context = {
      trackId: track.id,
      stageId: stage.id,
      entryId: entry.id,
      trackTitle: track.title,
      stageTitle: stage.title,
    };
  }
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
    ...(context ? { trackContext: context } : {}),
  };
  return {
    ...data,
    problems: saved ? data.problems : [...data.problems, problem],
    session,
  };
}
