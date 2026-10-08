import type { Data, Problem } from "./model";
import { localDate, suggestion } from "./model";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";
import {
  nextTrackEntry,
  stageEntries,
  trackContextForEntry,
  trackEntries,
  trackEntryProgress,
} from "./tracks";
import type { TrackContext } from "./tracks-types";
import { revisitItems } from "./practice-state";

export interface TodayPractice {
  problem: Problem;
  reason: string;
  revisit: boolean;
  focusFallback: boolean;
  fresh: boolean;
  trackContext?: TrackContext;
  position?: { index: number; total: number };
  activity?: "explain" | "complexity";
}
const identity = (problem: Problem) =>
  problem.cfKey ??
  normalizeCodeforcesIdentity({
    url: problem.url,
    code:
      problem.platform.toLowerCase() === "codeforces"
        ? problem.problemCode
        : "",
  })?.key;
function contextForProblem(
  data: Data,
  problem: Problem,
): Pick<TodayPractice, "trackContext" | "position"> {
  if (!data.activeTrackId) return {};
  const key = identity(problem);
  const entry =
    key &&
    trackEntries(data, data.activeTrackId).find(
      (entry) => normalizeCodeforcesIdentity(entry)?.key === key,
    );
  const context = entry && trackContextForEntry(data, entry.id);
  if (!entry || !context) return {};
  const ordered = stageEntries(data, entry.stageId);
  return {
    trackContext: context,
    position: {
      index: ordered.findIndex((value) => value.id === entry.id) + 1,
      total: ordered.length,
    },
  };
}

/** Today keeps its existing focus and scheduling rules. A chosen track changes
 * the source of unfinished work, while imported acceptance never completes it. */
export function todayPractice(
  data: Data,
  now = new Date(),
): TodayPractice | null {
  const session = data.session;
  const activeProblem =
    session &&
    data.problems.find((problem) => problem.id === session.problemId);
  if (session && activeProblem) {
    const context = session.trackContext;
    const ordered = context && stageEntries(data, context.stageId);
    const index =
      ordered?.findIndex((entry) => entry.id === context?.entryId) ?? -1;
    return {
      problem: activeProblem,
      reason: "Your notes and timer are ready when you are.",
      revisit: true,
      focusFallback: false,
      fresh: false,
      ...(context ? { trackContext: context } : {}),
      ...(ordered && index >= 0
        ? { position: { index: index + 1, total: ordered.length } }
        : {}),
    };
  }
  const existing = suggestion(data, now);
  const recall = revisitItems(data, now).find(
    (item) =>
      item.recallAt &&
      item.recallAt <= localDate(now) &&
      !item.skipped &&
      (!item.deferredUntil || item.deferredUntil <= localDate(now)),
  );
  if (
    recall &&
    (!existing?.problem.reviewAt ||
      existing.problem.reviewAt > recall.recallAt!)
  )
    return {
      problem: recall.problem,
      reason:
        "A written recall check is ready. Your coding reattempt keeps its own date.",
      revisit: true,
      focusFallback: false,
      fresh: false,
      activity: recall.recallActivity!,
      ...contextForProblem(data, recall.problem),
    };
  if (existing?.problem.reviewAt && existing.problem.reviewAt <= localDate(now))
    return {
      ...existing,
      revisit: true,
      fresh: false,
      ...contextForProblem(data, existing.problem),
    };

  if (data.activeTrackId) {
    const next = nextTrackEntry(data, data.activeTrackId, now);
    if (next)
      return {
        problem: next.problem,
        reason: next.reason,
        revisit: next.revisit,
        focusFallback: false,
        fresh: next.fresh,
        ...contextForProblem(data, next.problem),
      };
    const completed = new Set(
      trackEntries(data, data.activeTrackId)
        .filter((entry) => {
          const progress = trackEntryProgress(data, entry, now);
          return progress.independent && !progress.revisitDue;
        })
        .map((entry) => normalizeCodeforcesIdentity(entry)!.key),
    );
    const fallback = suggestion(
      {
        ...data,
        problems: data.problems.filter((problem) => {
          const key = identity(problem);
          return !key || !completed.has(key);
        }),
      },
      now,
    );
    return fallback
      ? {
          ...fallback,
          fresh: false,
          ...contextForProblem(data, fallback.problem),
        }
      : null;
  }
  return existing ? { ...existing, fresh: false } : null;
}
