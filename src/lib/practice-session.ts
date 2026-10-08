import { activeContest, eligibleUpsolves, editContest } from "./contest-lab";
import { practiceIdentity } from "./practice-state";
import type { Data, Problem, Session } from "./model";
import type { TrackContext } from "./tracks-types";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";

/** Fresh practice creates its problem and session in one revision. The regular
 * path requires a saved problem, so failed dependent writes cannot orphan it. */
export function withPracticeSession(
  data: Data,
  problem: Problem,
  duration: number,
  now: number,
  id: string,
  fresh = false,
  context?: TrackContext,
  upsolveRowId?: string,
): Data {
  if (!Number.isInteger(duration) || duration < 1 || duration > 180)
    throw new Error("Choose an attempt timebox from 1 to 180 minutes.");
  if (activeContest(data))
    throw new Error(
      "Finish or abandon your active contest before starting timed practice.",
    );
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
  let next: Data = {
    ...data,
    problems: saved ? data.problems : [...data.problems, problem],
    session,
  };
  const queued = eligibleUpsolves(data, new Date(now)).find(
    (v) =>
      (!upsolveRowId || v.row.id === upsolveRowId) &&
      v.row.identity ===
        practiceIdentity(problem),
  );
  if (upsolveRowId && !queued)
    throw new Error(
      "This upsolve is not eligible today. Check its coding date and practice exclusions.",
    );
  if (queued)
    next = editContest(next, queued.contest.id, (c) => ({
      ...c,
      problems: c.problems.map((p) =>
        p.id === queued.row.id
          ? { ...p, upsolve: { ...p.upsolve!, sessionId: id } }
          : p,
      ),
    }));
  return next;
}
