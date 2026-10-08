import type { Data, Problem } from "./model";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";

export interface PracticeScope {
  handle?: string | null;
}
interface PracticeIndex {
  groups: Map<string, Problem[]>;
  times: Map<string, string>;
  reflections: Map<string, string>;
  revisions: Map<string, NonNullable<Data["revisions"]>>;
  timedProfiles: Map<string, Map<string, string>>;
}
const indexes = new WeakMap<Data, PracticeIndex>();
function indexFor(data: Data): PracticeIndex {
  const previous = indexes.get(data);
  if (previous) return previous;
  const groups = new Map<string, Problem[]>(),
    times = new Map<string, string>(),
    reflections = new Map<string, string>(),
    revisions: PracticeIndex["revisions"] = new Map(),
    timedProfiles: PracticeIndex["timedProfiles"] = new Map();
  const linkedHandles = new Map(
    data.learningLinks?.map((link) => [
      link.timedAttemptId,
      link.handle.toLowerCase(),
    ]),
  );
  const problems = new Map(data.problems.map((p) => [p.id, p]));
  for (const problem of data.problems) {
    const key = practiceIdentity(problem);
    const group = groups.get(key);
    if (group) group.push(problem);
    else groups.set(key, [problem]);
  }
  for (const attempt of data.attempts) {
    if (attempt.completedAt > (times.get(attempt.problemId) ?? ""))
      times.set(attempt.problemId, attempt.completedAt);
    const handle = linkedHandles.get(attempt.id);
    if (handle) {
      const stamps =
        timedProfiles.get(attempt.problemId) ?? new Map<string, string>();
      stamps.set(attempt.completedAt, handle);
      timedProfiles.set(attempt.problemId, stamps);
    }
  }
  for (const reflection of data.codeforces.reflections)
    reflections.set(reflection.attemptId, reflection.savedAt);
  for (const revision of data.revisions ?? []) {
    const problem = problems.get(revision.problemId);
    if (!problem) continue;
    const key = practiceIdentity(problem);
    const group = revisions.get(key);
    if (group) group.push(revision);
    else revisions.set(key, [revision]);
  }
  const index = { groups, times, reflections, revisions, timedProfiles };
  indexes.set(data, index);
  return index;
}
export function practiceIdentity(problem: Problem): string {
  const identity = normalizeCodeforcesIdentity({
    url: problem.url,
    code:
      problem.platform.toLowerCase() === "codeforces"
        ? problem.problemCode
        : "",
  });
  if (problem.cfKey && identity && problem.cfKey !== identity.key)
    return `problem:${problem.id}`;
  return problem.cfKey ?? identity?.key ?? `problem:${problem.id}`;
}
function day(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function matchingPracticeProblems(
  data: Data,
  problem: Problem,
  scope: PracticeScope = {},
): Problem[] {
  const handle = (
    scope.handle === undefined ? data.codeforces.connectedHandle : scope.handle
  )?.toLowerCase();
  const key = practiceIdentity(problem);
  return (indexFor(data).groups.get(key) ?? []).filter(
    (p) => !p.cfHandle || p.cfHandle.toLowerCase() === handle,
  );
}
function decisionTime(data: Data, problem: Problem): string {
  if (problem.reviewUpdatedAt) return problem.reviewUpdatedAt;
  if (problem.reviewCompletedAt) return problem.reviewCompletedAt;
  const index = indexFor(data);
  const reflection =
    problem.reviewAttemptId && index.reflections.get(problem.reviewAttemptId);
  if (reflection) return reflection;
  // Legacy decisions retain their evidence dates; an import's creation date is
  // not evidence that its schedule supersedes a deliberate practice decision.
  return index.times.get(problem.id) ?? "";
}
function codingDecision(
  data: Data,
  problems: Problem[],
  handle?: string,
): Problem | undefined {
  const index = indexFor(data);
  const applicable = (problem: Problem) => {
    if (problem.cfHandle) return true;
    // An explicitly linked timed event belongs to that profile, including its
    // automatic date. Later notebook choices remain personal. Undated legacy
    // manual choices have no reliable event provenance and are kept as written.
    const stamp =
      problem.reviewUpdatedAt ??
      (!problem.reviewManual ? index.times.get(problem.id) : undefined);
    const sourceHandle =
      stamp && index.timedProfiles.get(problem.id)?.get(stamp);
    return !sourceHandle || sourceHandle === handle;
  };
  return problems
    .filter(applicable)
    .filter(
      (p) =>
        p.reviewAt !== null ||
        p.reviewManual ||
        p.reviewAttemptId ||
        p.reviewCompletedAt ||
        p.reviewUpdatedAt,
    )
    .sort(
      (a, b) =>
        decisionTime(data, b).localeCompare(decisionTime(data, a)) ||
        Number(!!b.reviewManual) - Number(!!a.reviewManual) ||
        (b.reviewAt ?? "").localeCompare(a.reviewAt ?? "") ||
        a.id.localeCompare(b.id),
    )[0];
}
/** Latest evidenced coding decision wins; manual decisions win timestamp ties,
 * then the later date, then stable ID. Bare unscheduled copies are not decisions.
 * Skips, deferrals and archival apply across the current canonical group. */
export function sharedPracticeState(
  data: Data,
  problem: Problem,
  now = new Date(),
  scope: PracticeScope = {},
) {
  const problems = matchingPracticeProblems(data, problem, scope);
  const handle = (
    scope.handle === undefined ? data.codeforces.connectedHandle : scope.handle
  )?.toLowerCase();
  const codingProblem = codingDecision(data, problems, handle);
  const codingAt = codingProblem?.reviewAt ?? null;
  const today = day(now);
  const deferredUntil =
    problems
      .map((p) => p.deferredUntil ?? "")
      .sort()
      .at(-1) || null;
  const skipped = problems.some((p) => p.skippedOn === today);
  const archived = problems.some((p) => p.archived);
  const available = problems.length > 0 || !problem.cfHandle;
  const ids = new Set(problems.map((p) => p.id));
  const revision = (
    indexFor(data).revisions.get(practiceIdentity(problem)) ?? []
  )
    .filter(
      (r) =>
        ids.has(r.problemId) &&
        (!r.handle || r.handle.toLowerCase() === handle),
    )
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id),
    )[0];
  const recallAt = revision?.nextReviewAt ?? null;
  return {
    problems,
    codingProblem,
    codingAt,
    deferredUntil,
    skipped,
    archived,
    eligible:
      available &&
      !archived &&
      !skipped &&
      (!deferredUntil || deferredUntil <= today) &&
      (!codingAt || codingAt <= today),
    recallAt,
    recallActivity: revision?.activity ?? null,
    dueAt:
      [codingAt, recallAt].filter((v): v is string => !!v).sort()[0] ?? null,
  };
}
export function resolvedPracticeProblems(
  data: Data,
  now = new Date(),
): Problem[] {
  const groups = new Map<string, Problem>();
  for (const problem of data.problems) {
    if (
      problem.cfHandle &&
      problem.cfHandle.toLowerCase() !==
        data.codeforces.connectedHandle?.toLowerCase()
    )
      continue;
    const key = practiceIdentity(problem);
    const previous = groups.get(key);
    if (!previous || (previous.cfHandle && !problem.cfHandle))
      groups.set(key, problem);
  }
  return [...groups.values()].map((problem) => {
    const state = sharedPracticeState(data, problem, now);
    return (
      state.codingProblem ??
      (problem.reviewAt === state.codingAt
        ? problem
        : { ...problem, reviewAt: state.codingAt, reviewCount: 0 })
    );
  });
}
export function resolvedCodingQueue(data: Data, now = new Date()): Problem[] {
  return resolvedPracticeProblems(data, now)
    .filter((p) => {
      const state = sharedPracticeState(data, p, now);
      return !state.archived && !!state.codingAt;
    })
    .sort(
      (a, b) =>
        a.reviewAt!.localeCompare(b.reviewAt!) || a.id.localeCompare(b.id),
    );
}
export function revisitItems(data: Data, now = new Date()) {
  return resolvedPracticeProblems(data, now)
    .flatMap((problem) => {
      const state = sharedPracticeState(data, problem, now);
      return !state.archived && state.dueAt ? [{ problem, ...state }] : [];
    })
    .sort(
      (a, b) =>
        a.dueAt!.localeCompare(b.dueAt!) ||
        a.problem.id.localeCompare(b.problem.id),
    );
}
