import type {
  CodeforcesData,
  ImportedAttempt,
  QuickReflection,
} from "./codeforces-types";
import type { Attempt, Data, Difficulty, Outcome, Problem } from "./model";

export interface LearningLink {
  timedAttemptId: string;
  importedAttemptId: string;
  handle: string;
  linkedAt: string;
  reflectionSource: "timed" | "codeforces";
}

// A practice event can have several recorded sources. Linking is explicit and
// affects learning credit only; measured time and original reflections survive.
export interface LearningRecord {
  id: string;
  source: "timed" | "codeforces" | "linked";
  problemId: string;
  problemIds: string[];
  handle: string | null;
  learningKey: string;
  completedAt: string;
  reflectedAt: string | null;
  outcome: Outcome | null;
  difficulty: Difficulty | null;
  takeaway: string;
  notes: string;
  elapsedMs: number | null;
  timedAttemptId: string | null;
  importedAttemptId: string | null;
  submissionIds: number[];
  accepted: boolean | null;
  reflectionPending: boolean;
  reflectionSource: "timed" | "codeforces" | null;
}

export interface LearningScope {
  // By default the active Codeforces profile and personal timed sessions appear.
  // Archived profiles remain addressable without adding their credit to this view.
  handle?: string | null;
  allProfiles?: boolean;
  problemId?: string;
}

const lower = (value: string) => value.toLowerCase();

export function codeforcesProblemKey(problem: Problem): string | null {
  if (problem.cfKey) return problem.cfKey;
  try {
    const url = new URL(problem.url);
    if (!/^(www\.)?codeforces\.com$/.test(url.hostname)) return null;
    const match = url.pathname.match(
      /^\/(?:problemset\/problem\/|(?:contest|gym)\/)(\d+)\/(?:problem\/)?([A-Za-z0-9]+)\/?$/,
    );
    return match ? `contest:${match[1]}:${match[2].toUpperCase()}` : null;
  } catch {
    return null;
  }
}

function learningKey(problem: Problem, handle: string | null): string {
  return `${handle ? `cf:${lower(handle)}` : "notebook"}:${codeforcesProblemKey(problem) ?? `problem:${problem.id}`}`;
}

function sameProblem(timed: Problem, imported: Problem): boolean {
  const first = codeforcesProblemKey(timed);
  return !!first && first === codeforcesProblemKey(imported);
}

export function validateLearningLinks(
  input: unknown,
  problems: Problem[],
  attempts: Attempt[],
  codeforces: CodeforcesData,
): LearningLink[] {
  if (input === undefined) return [];
  const fail = (): never => {
    throw new Error(
      "Learning links have invalid fields, duplicate credit, or mismatched problem/profile identities.",
    );
  };
  if (!Array.isArray(input) || input.length > 50000) return fail();
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
  const timedMap = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const importedMap = new Map(
    codeforces.practiceAttempts.map((attempt) => [attempt.id, attempt]),
  );
  const usedTimed = new Set<string>();
  const usedImported = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail();
    const link = value as Record<string, unknown>;
    if (
      typeof link.timedAttemptId !== "string" ||
      typeof link.importedAttemptId !== "string" ||
      typeof link.handle !== "string" ||
      !/^[A-Za-z0-9_.-]{3,24}$/.test(link.handle) ||
      typeof link.linkedAt !== "string" ||
      link.linkedAt.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T/.test(link.linkedAt) ||
      !Number.isFinite(Date.parse(link.linkedAt)) ||
      !["timed", "codeforces"].includes(link.reflectionSource as string)
    )
      return fail();
    const timed = timedMap.get(link.timedAttemptId);
    const imported = importedMap.get(link.importedAttemptId);
    const timedProblem = timed && problemMap.get(timed.problemId);
    const importedProblem = imported && problemMap.get(imported.problemId);
    if (
      !timed ||
      !imported ||
      !timedProblem ||
      !importedProblem ||
      lower(imported.handle) !== lower(link.handle) ||
      (timedProblem.cfHandle &&
        lower(timedProblem.cfHandle) !== lower(link.handle)) ||
      !sameProblem(timedProblem, importedProblem) ||
      usedTimed.has(timed.id) ||
      usedImported.has(imported.id) ||
      (link.reflectionSource === "codeforces" &&
        !codeforces.reflections.some(
          (reflection) => reflection.attemptId === imported.id,
        ))
    )
      return fail();
    usedTimed.add(timed.id);
    usedImported.add(imported.id);
    return {
      timedAttemptId: timed.id,
      importedAttemptId: imported.id,
      handle: imported.handle,
      linkedAt: new Date(link.linkedAt).toISOString(),
      reflectionSource:
        link.reflectionSource as LearningLink["reflectionSource"],
    };
  });
}

export function possibleLearningLinks(
  data: Data,
  importedAttemptId: string,
): Attempt[] {
  const imported = data.codeforces.practiceAttempts.find(
    (attempt) => attempt.id === importedAttemptId,
  );
  const importedProblem =
    imported &&
    data.problems.find((problem) => problem.id === imported.problemId);
  if (
    !imported ||
    !importedProblem ||
    data.learningLinks?.some((link) => link.importedAttemptId === imported.id)
  )
    return [];
  const linked = new Set(
    data.learningLinks?.map((link) => link.timedAttemptId),
  );
  return data.attempts
    .filter((attempt) => {
      const problem = data.problems.find(
        (problem) => problem.id === attempt.problemId,
      );
      return (
        !!problem &&
        !linked.has(attempt.id) &&
        sameProblem(problem, importedProblem) &&
        (!problem.cfHandle ||
          lower(problem.cfHandle) === lower(imported.handle))
      );
    })
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function possibleImportedLearningLinks(
  data: Data,
  timedAttemptId: string,
): ImportedAttempt[] {
  const timed = data.attempts.find((attempt) => attempt.id === timedAttemptId);
  const timedProblem =
    timed && data.problems.find((problem) => problem.id === timed.problemId);
  if (!timed || !timedProblem) return [];
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const links = new Map(
    (data.learningLinks ?? []).map((link) => [
      link.importedAttemptId,
      link.timedAttemptId,
    ]),
  );
  return data.codeforces.practiceAttempts
    .filter((attempt) => {
      const problem = problems.get(attempt.problemId);
      const linkedTimed = links.get(attempt.id);
      return (
        !!problem &&
        (!linkedTimed || linkedTimed === timedAttemptId) &&
        sameProblem(timedProblem, problem) &&
        (!timedProblem.cfHandle ||
          lower(timedProblem.cfHandle) === lower(attempt.handle))
      );
    })
    .sort((a, b) => b.lastSubmittedAt.localeCompare(a.lastSubmittedAt));
}

export function linkLearningAttempts(
  data: Data,
  timedAttemptId: string,
  importedAttemptId: string,
  reflectionSource: LearningLink["reflectionSource"] = "timed",
  now = new Date(),
): Data {
  const imported = data.codeforces.practiceAttempts.find(
    (attempt) => attempt.id === importedAttemptId,
  );
  if (!imported)
    throw new Error("This imported practice attempt is no longer available.");
  const links = [
    ...(data.learningLinks ?? []),
    {
      timedAttemptId,
      importedAttemptId,
      handle: imported.handle,
      linkedAt: now.toISOString(),
      reflectionSource,
    },
  ];
  return {
    ...data,
    learningLinks: validateLearningLinks(
      links,
      data.problems,
      data.attempts,
      data.codeforces,
    ),
  };
}

export function unlinkLearningAttempts(
  data: Data,
  timedAttemptId: string,
): Data {
  return {
    ...data,
    learningLinks: (data.learningLinks ?? []).filter(
      (link) => link.timedAttemptId !== timedAttemptId,
    ),
  };
}

export function learningHistory(
  data: Data,
  scope: LearningScope = {},
): LearningRecord[] {
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const imported = new Map(
    data.codeforces.practiceAttempts.map((attempt) => [attempt.id, attempt]),
  );
  const reflections = new Map(
    data.codeforces.reflections.map((reflection) => [
      reflection.attemptId,
      reflection,
    ]),
  );
  const links = new Map(
    (data.learningLinks ?? []).map((link) => [link.timedAttemptId, link]),
  );
  const linkedImported = new Set(
    (data.learningLinks ?? []).map((link) => link.importedAttemptId),
  );
  const submissions = new Map(
    data.codeforces.submissions.map((submission) => [
      `${lower(submission.handle)}:${submission.id}`,
      submission,
    ]),
  );
  const accepted = (attempt: ImportedAttempt) =>
    attempt.submissionIds.some(
      (id) =>
        submissions.get(`${lower(attempt.handle)}:${id}`)?.verdict === "OK",
    );
  const records: LearningRecord[] = [];
  for (const attempt of data.attempts) {
    const problem = problems.get(attempt.problemId);
    if (!problem) continue;
    const link = links.get(attempt.id);
    const activity = link && imported.get(link.importedAttemptId);
    const reflection: Attempt | QuickReflection =
      link?.reflectionSource === "codeforces" && activity
        ? (reflections.get(activity.id) ?? attempt)
        : attempt;
    const handle = activity?.handle ?? problem.cfHandle ?? null;
    records.push({
      id: `timed:${attempt.id}`,
      source: activity ? "linked" : "timed",
      problemId: problem.id,
      problemIds: [
        ...new Set([problem.id, ...(activity ? [activity.problemId] : [])]),
      ],
      handle,
      learningKey: learningKey(problem, handle),
      completedAt: attempt.completedAt,
      reflectedAt:
        "savedAt" in reflection ? reflection.savedAt : reflection.completedAt,
      outcome: reflection.outcome,
      difficulty: reflection.difficulty,
      takeaway: reflection.takeaway,
      notes: attempt.notes,
      elapsedMs: attempt.elapsedMs,
      timedAttemptId: attempt.id,
      importedAttemptId: activity?.id ?? null,
      submissionIds: activity ? [...activity.submissionIds] : [],
      accepted: activity ? accepted(activity) : null,
      reflectionPending: false,
      reflectionSource: activity ? link!.reflectionSource : "timed",
    });
  }
  for (const attempt of imported.values()) {
    if (linkedImported.has(attempt.id)) continue;
    const problem = problems.get(attempt.problemId);
    if (!problem) continue;
    const reflection = reflections.get(attempt.id);
    records.push({
      id: `codeforces:${lower(attempt.handle)}:${attempt.id}`,
      source: "codeforces",
      problemId: problem.id,
      problemIds: [problem.id],
      handle: attempt.handle,
      learningKey: learningKey(problem, attempt.handle),
      completedAt: attempt.lastSubmittedAt,
      reflectedAt: reflection?.savedAt ?? null,
      outcome: reflection?.outcome ?? null,
      difficulty: reflection?.difficulty ?? null,
      takeaway: reflection?.takeaway ?? "",
      notes: "",
      elapsedMs: null,
      timedAttemptId: null,
      importedAttemptId: attempt.id,
      submissionIds: [...attempt.submissionIds],
      accepted: accepted(attempt),
      reflectionPending: !reflection,
      reflectionSource: reflection ? "codeforces" : null,
    });
  }
  const handle = Object.hasOwn(scope, "handle")
    ? scope.handle
    : data.codeforces.connectedHandle;
  return records
    .filter(
      (record) =>
        (scope.allProfiles ||
          !record.handle ||
          lower(record.handle) === lower(handle ?? "")) &&
        (!scope.problemId || record.problemIds.includes(scope.problemId)),
    )
    .sort(
      (a, b) =>
        b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id),
    );
}

export function problemLearningHistory(
  data: Data,
  problemId: string,
): LearningRecord[] {
  return learningHistory(data, { problemId, allProfiles: true });
}

export function latestLearningReflection(
  data: Data,
  problemId: string,
): LearningRecord | undefined {
  return problemLearningHistory(data, problemId).filter(
    (record) => record.outcome !== null,
  )[0];
}

export function learningByProblem(data: Data): Map<
  string,
  {
    history: LearningRecord[];
    latestReflection: LearningRecord | undefined;
    state: "fresh" | "pending" | Outcome;
  }
> {
  const grouped = new Map<
    string,
    {
      history: LearningRecord[];
      latestReflection: LearningRecord | undefined;
      state: "fresh" | "pending" | Outcome;
    }
  >();
  for (const record of learningHistory(data, { allProfiles: true })) {
    for (const problemId of record.problemIds) {
      const previous = grouped.get(problemId);
      if (previous) {
        previous.history.push(record);
        if (!previous.latestReflection && record.outcome !== null)
          previous.latestReflection = record;
      } else
        grouped.set(problemId, {
          history: [record],
          latestReflection: record.outcome !== null ? record : undefined,
          state: record.outcome ?? "pending",
        });
    }
  }
  return grouped;
}

export function problemPracticeState(
  data: Data,
  problemId: string,
): "fresh" | "pending" | Outcome {
  const latest = problemLearningHistory(data, problemId)[0];
  return latest ? (latest.outcome ?? "pending") : "fresh";
}

const TOPIC_ALIASES: Record<string, string> = {
  dp: "dynamic programming",
  "dynamic programming": "dynamic programming",
  array: "arrays",
  string: "strings",
  tree: "trees",
  graph: "graphs",
  maths: "math",
  mathematics: "math",
  constructive: "constructive algorithms",
  "bit manipulation": "bitmasks",
  "bit manipulation / bitmasks": "bitmasks",
};
export function normalizedTopic(topic: string): string {
  const normalized = topic.trim().toLowerCase().replace(/\s+/g, " ");
  return TOPIC_ALIASES[normalized] ?? normalized;
}

function localDay(stamp: string): string {
  const date = new Date(stamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function learningStats(data: Data, scope: LearningScope = {}) {
  const history = learningHistory(data, scope);
  const reflected = history.filter((record) => record.outcome !== null);
  const difficulties = new Map<Difficulty, number>();
  const topics = new Map<
    string,
    { topic: string; count: number; reflected: number }
  >();
  const problemMap = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  for (const record of history) {
    if (record.difficulty)
      difficulties.set(
        record.difficulty,
        (difficulties.get(record.difficulty) ?? 0) + 1,
      );
    for (const topic of new Set(
      problemMap.get(record.problemId)?.tags.map(normalizedTopic) ?? [],
    )) {
      const previous = topics.get(topic) ?? { topic, count: 0, reflected: 0 };
      topics.set(topic, {
        topic,
        count: previous.count + 1,
        reflected: previous.reflected + Number(record.outcome !== null),
      });
    }
  }
  // Practice days measure activity: a completed timed session or a fetched
  // submission. They never imply a measured duration or independent solution.
  const days = new Set(
    history
      .filter((record) => record.timedAttemptId)
      .map((record) => localDay(record.completedAt)),
  );
  const importedIds = new Set(
    history.flatMap((record) =>
      record.importedAttemptId ? [record.importedAttemptId] : [],
    ),
  );
  const includedAttempts = data.codeforces.practiceAttempts.filter((attempt) =>
    importedIds.has(attempt.id),
  );
  const submissions = new Map(
    data.codeforces.submissions.map((submission) => [
      `${lower(submission.handle)}:${submission.id}`,
      submission,
    ]),
  );
  for (const attempt of includedAttempts) {
    for (const id of attempt.submissionIds) {
      const submission = submissions.get(`${lower(attempt.handle)}:${id}`);
      if (submission) days.add(localDay(submission.submittedAt));
    }
  }
  return {
    history,
    practiceAttempts: history.length,
    reflected: reflected.length,
    pending: history.length - reflected.length,
    independent: reflected.filter((record) => record.outcome === "independent")
      .length,
    assisted: reflected.filter(
      (record) => record.outcome === "hint" || record.outcome === "editorial",
    ).length,
    unsolved: reflected.filter((record) => record.outcome === "unsolved")
      .length,
    timedSessions: history.filter((record) => record.timedAttemptId).length,
    measuredMinutes: Math.floor(
      history.reduce((sum, record) => sum + (record.elapsedMs ?? 0), 0) / 60000,
    ),
    difficulties: [...difficulties]
      .map(([difficulty, count]) => ({ difficulty, count }))
      .sort((a, b) => b.count - a.count),
    topics: [...topics.values()].sort(
      (a, b) => b.count - a.count || a.topic.localeCompare(b.topic),
    ),
    practiceDays: [...days].sort(),
  };
}

export function learningBreakthroughs(
  data: Data,
  scope: LearningScope = {},
): { problem: Problem; attempt: LearningRecord }[] {
  const groups = new Map<string, LearningRecord[]>();
  for (const record of learningHistory(data, scope)) {
    if (record.outcome === null) continue;
    const previous = groups.get(record.learningKey);
    if (previous) previous.push(record);
    else groups.set(record.learningKey, [record]);
  }
  const wins: { problem: Problem; attempt: LearningRecord }[] = [];
  for (const records of groups.values()) {
    records.sort(
      (a, b) =>
        a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id),
    );
    let struggleAt: string | null = null;
    let success: LearningRecord | undefined;
    for (const record of records) {
      if (
        record.outcome === "independent" &&
        struggleAt &&
        struggleAt < record.completedAt
      ) {
        success = record;
        break;
      }
      if (record.outcome !== "independent" && !struggleAt)
        struggleAt = record.completedAt;
    }
    const problem =
      success &&
      data.problems.find((problem) => problem.id === success.problemId);
    if (problem && success) wins.push({ problem, attempt: success });
  }
  return wins.sort((a, b) =>
    b.attempt.completedAt.localeCompare(a.attempt.completedAt),
  );
}
