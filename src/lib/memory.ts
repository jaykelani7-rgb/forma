import {
  codeforcesProblemKey,
  learningHistory,
  type LearningRecord,
  type LearningScope,
} from "./learning";
import { addDays, localDate, type Data, type Problem } from "./model";
import {
  DEFAULT_RECALL_DAYS,
  MISTAKES,
  validateRevisions,
  type MistakeCategory,
  type RevisionRecord,
} from "./memory-types";

export type MemoryEvent =
  | {
      type: "practice";
      id: string;
      completedAt: string;
      record: LearningRecord;
    }
  | {
      type: "revision";
      id: string;
      completedAt: string;
      record: RevisionRecord;
    };
export interface MemorySummary {
  latestReflection: LearningRecord | null;
  assistance: LearningRecord[];
  mistakes: { category: MistakeCategory; count: number }[];
  latestTakeaway: string;
  latestRevision: RevisionRecord | null;
  recallAt: string | null;
}
const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();
function scopeHandle(data: Data, scope: LearningScope) {
  return Object.hasOwn(scope, "handle")
    ? scope.handle
    : data.codeforces.connectedHandle;
}
function inScope(
  handle: string | null | undefined,
  data: Data,
  scope: LearningScope,
) {
  return (
    scope.allProfiles ||
    !handle ||
    lower(handle) === lower(scopeHandle(data, scope))
  );
}

/** Identity sharing is read-only: original problem and attempt records survive. */
export function matchingMemoryProblems(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): Problem[] {
  const target = data.problems.find((problem) => problem.id === problemId);
  if (!target) return [];
  const key = codeforcesProblemKey(target);
  return data.problems.filter(
    (problem) =>
      inScope(problem.cfHandle, data, scope) &&
      (key ? codeforcesProblemKey(problem) === key : problem.id === target.id),
  );
}

export function revisionsForProblem(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): RevisionRecord[] {
  const ids = new Set(
    matchingMemoryProblems(data, problemId, scope).map((problem) => problem.id),
  );
  return (data.revisions ?? [])
    .filter(
      (revision) =>
        ids.has(revision.problemId) && inScope(revision.handle, data, scope),
    )
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
    );
}
export function latestRevisionForProblem(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): RevisionRecord | null {
  return revisionsForProblem(data, problemId, scope)[0] ?? null;
}
/** One transparent written-recall schedule; coding reattempt dates are independent. */
export function recallDueForProblem(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): string | null {
  return latestRevisionForProblem(data, problemId, scope)?.nextReviewAt ?? null;
}
export function revisionCueForProblem(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): string {
  return (
    latestRevisionForProblem(data, problemId, scope)?.cue ??
    data.problems.find((problem) => problem.id === problemId)?.revisionCue ??
    ""
  );
}
export function revisionHandle(data: Data, problemId: string): string | null {
  const problem = data.problems.find((value) => value.id === problemId);
  if (!problem) throw new Error("This problem is no longer available.");
  return (
    problem.cfHandle ??
    (codeforcesProblemKey(problem) ? data.codeforces.connectedHandle : null)
  );
}
export function suggestedRecallDate(
  data: Data,
  outcome: RevisionRecord["outcome"],
  now = new Date(),
): string {
  return localDate(
    addDays(now, (data.settings.recallDays ?? DEFAULT_RECALL_DAYS)[outcome]),
  );
}

export function saveRevision(data: Data, revision: RevisionRecord): Data {
  const previous = (data.revisions ?? []).find(
    (record) => record.id === revision.id,
  );
  if (
    previous &&
    (previous.problemId !== revision.problemId ||
      lower(previous.handle) !== lower(revision.handle))
  )
    throw new Error(
      "An existing revision cannot be reassigned to a different problem or profile.",
    );
  const revisions = validateRevisions(
    [
      ...(data.revisions ?? []).filter((record) => record.id !== revision.id),
      revision,
    ],
    data.problems,
    data.codeforces.profiles.map((profile) => profile.handle),
  );
  return {
    ...data,
    revisions,
    problems: data.problems.map((problem) =>
      problem.id === revision.problemId && revision.handle === null
        ? { ...problem, revisionCue: revision.cue }
        : problem,
    ),
  };
}

function mistakeCounts(history: LearningRecord[]) {
  const counts = new Map<MistakeCategory, number>();
  for (const record of history)
    for (const category of record.mistakes ?? [])
      counts.set(category, (counts.get(category) ?? 0) + 1);
  const order = Object.keys(MISTAKES) as MistakeCategory[];
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        order.indexOf(a.category) - order.indexOf(b.category),
    );
}
function summarize(
  history: LearningRecord[],
  revisions: RevisionRecord[],
): MemorySummary {
  const reflected = history
    .filter((record) => record.outcome !== null)
    .sort(
      (a, b) =>
        (b.reflectedAt ?? b.completedAt).localeCompare(
          a.reflectedAt ?? a.completedAt,
        ) || a.id.localeCompare(b.id),
    );
  const latestRevision = revisions[0] ?? null;
  return {
    latestReflection: reflected[0] ?? null,
    assistance: reflected.filter(
      (record) => record.outcome === "hint" || record.outcome === "editorial",
    ),
    mistakes: mistakeCounts(reflected),
    latestTakeaway:
      reflected.find((record) => record.takeaway.trim())?.takeaway ?? "",
    latestRevision,
    recallAt: latestRevision?.nextReviewAt ?? null,
  };
}
export function problemMemory(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
) {
  const problems = matchingMemoryProblems(data, problemId, scope);
  const ids = new Set(problems.map((problem) => problem.id));
  const history = learningHistory(data, {
    ...scope,
    problemId: undefined,
  }).filter((record) => record.problemIds.some((id) => ids.has(id)));
  const revisions = revisionsForProblem(data, problemId, scope);
  const timeline: MemoryEvent[] = [
    ...history.map((record) => ({
      type: "practice" as const,
      id: record.id,
      completedAt: record.completedAt,
      record,
    })),
    ...revisions.map((record) => ({
      type: "revision" as const,
      id: `revision:${record.id}`,
      completedAt: record.completedAt,
      record,
    })),
  ].sort(
    (a, b) =>
      b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id),
  );
  return {
    problem: data.problems.find((problem) => problem.id === problemId),
    problems,
    history,
    revisions,
    timeline,
    summary: summarize(history, revisions),
  };
}
export function memorySummary(
  data: Data,
  problemId: string,
  scope: LearningScope = {},
): MemorySummary {
  return problemMemory(data, problemId, scope).summary;
}

/** Period totals preserve linked-event credit and never turn recall into coding time. */
export function memoryPeriod(
  data: Data,
  from: Date | string,
  to: Date | string,
  scope: LearningScope = {},
) {
  const first = typeof from === "string" ? from.slice(0, 10) : localDate(from);
  const last = typeof to === "string" ? to.slice(0, 10) : localDate(to);
  const within = (stamp: string) => {
    const day = localDate(new Date(stamp));
    return first <= day && day <= last;
  };
  const allHistory = learningHistory(data, scope);
  const history = allHistory.filter((record) => within(record.completedAt));
  const problemMap = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const selectedIds = scope.problemId
    ? new Set(
        matchingMemoryProblems(data, scope.problemId, scope).map(
          (problem) => problem.id,
        ),
      )
    : null;
  const revisions = (data.revisions ?? [])
    .filter(
      (record) =>
        inScope(record.handle, data, scope) &&
        within(record.completedAt) &&
        (!selectedIds || selectedIds.has(record.problemId)),
    )
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
    );
  const byIdentity = new Map<string, LearningRecord[]>();
  for (const record of allHistory) {
    const problem = problemMap.get(record.problemId);
    if (!problem) continue;
    const key = codeforcesProblemKey(problem) ?? `problem:${problem.id}`;
    const rows = byIdentity.get(key) ?? [];
    rows.push(record);
    byIdentity.set(key, rows);
  }
  const independentAfterAssistance: {
    problem: Problem;
    attempt: LearningRecord;
  }[] = [];
  for (const records of byIdentity.values()) {
    const success = records
      .filter(
        (record) =>
          record.outcome === "independent" && within(record.completedAt),
      )
      .sort(
        (a, b) =>
          a.completedAt.localeCompare(b.completedAt) ||
          a.id.localeCompare(b.id),
      )
      .find((record) =>
        records.some(
          (earlier) =>
            earlier.completedAt < record.completedAt &&
            (earlier.outcome === "hint" || earlier.outcome === "editorial") &&
            (!earlier.handle ||
              !record.handle ||
              lower(earlier.handle) === lower(record.handle)),
        ),
      );
    const problem = success && problemMap.get(success.problemId);
    if (success && problem)
      independentAfterAssistance.push({ problem, attempt: success });
  }
  return {
    history,
    revisions,
    independentAfterAssistance: independentAfterAssistance.sort((a, b) =>
      b.attempt.completedAt.localeCompare(a.attempt.completedAt),
    ),
    mistakes: mistakeCounts(
      history.filter((record) => record.outcome !== null),
    ),
    outcomes: {
      independent: revisions.filter(
        (record) => record.outcome === "independent",
      ).length,
      cue: revisions.filter((record) => record.outcome === "cue").length,
      unrecalled: revisions.filter((record) => record.outcome === "unrecalled")
        .length,
    },
    timedSessions: history.filter((record) => record.timedAttemptId !== null)
      .length,
    importedActivity: history.filter(
      (record) => record.importedAttemptId !== null,
    ).length,
    linkedEvents: history.filter((record) => record.source === "linked").length,
    measuredMinutes: Math.floor(
      history.reduce((sum, record) => sum + (record.elapsedMs ?? 0), 0) / 60000,
    ),
  };
}
