import {
  learningHistory,
  normalizedTopic,
  type LearningRecord,
  type LearningScope,
} from "./learning";
import { memoryPeriod } from "./memory";
import {
  MISTAKES,
  type MistakeCategory,
  type RevisionRecord,
} from "./memory-types";
import { localDate, type Data, type Problem } from "./model";
import { practiceIdentity, sharedPracticeState } from "./practice-state";

/** Transparent observation thresholds, not assessments of ability. */
export const INSIGHT_RULES = {
  repeatedLabels: 2,
  limitedTopicEvents: 1,
} as const;

export function memoryRecordAnchor(
  kind: "practice" | "revision",
  recordId: string,
) {
  return `record-${kind}-${recordId}`;
}

export function learningEvidenceHref(
  problemId: string,
  kind: "practice" | "revision" | "schedule",
  recordId: string | null,
  handle: string | null,
) {
  const query = new URLSearchParams({
    from: "/progress",
    profile: handle ?? "",
  });
  const anchor =
    kind === "schedule" || !recordId
      ? "memory-revision"
      : memoryRecordAnchor(kind, recordId);
  return `/problems/${encodeURIComponent(problemId)}?${query}#${encodeURIComponent(anchor)}`;
}

/** Evidence links can select a saved profile, without changing the active profile. */
export function learningEvidenceProfile(data: Data, requested: string) {
  if (requested === "") return { valid: true, handle: null } as const;
  const profile = data.codeforces.profiles.find(
    (item) => item.handle.toLowerCase() === requested.toLowerCase(),
  );
  return profile
    ? ({ valid: true, handle: profile.handle } as const)
    : ({ valid: false, handle: undefined } as const);
}

export interface DueLearningActivity {
  identity: string;
  problem: Problem;
  date: string;
  record: LearningRecord | RevisionRecord | null;
}

export function learningInsights(
  data: Data,
  from: string,
  to: string,
  scope: Pick<LearningScope, "handle"> = {},
  now = new Date(),
) {
  const period = memoryPeriod(data, from, to, scope);
  const history = learningHistory(data, scope);
  const handle =
    (scope.handle === undefined
      ? data.codeforces.connectedHandle
      : scope.handle
    )?.toLowerCase() ?? null;
  const asOf = localDate(now);
  const problemMap = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const mistakes = (Object.keys(MISTAKES) as MistakeCategory[])
    .map((category) => ({
      category,
      records: period.history.filter(
        (record) =>
          record.outcome !== null && record.mistakes?.includes(category),
      ),
    }))
    .filter((item) => item.records.length >= INSIGHT_RULES.repeatedLabels)
    .sort(
      (a, b) =>
        b.records.length - a.records.length ||
        Object.keys(MISTAKES).indexOf(a.category) -
          Object.keys(MISTAKES).indexOf(b.category),
    );

  const assistedByIdentity = new Map<string, LearningRecord[]>();
  for (const record of history) {
    if (record.outcome !== "hint" && record.outcome !== "editorial") continue;
    const problem = problemMap.get(record.problemId);
    if (!problem) continue;
    const identity = practiceIdentity(problem);
    const rows = assistedByIdentity.get(identity) ?? [];
    rows.push(record);
    assistedByIdentity.set(identity, rows);
  }
  const transitions = period.independentAfterAssistance.flatMap(
    ({ problem, attempt }) => {
      const assisted = assistedByIdentity
        .get(practiceIdentity(problem))
        ?.find((earlier) => {
          return (
            earlier.completedAt < attempt.completedAt &&
            (!earlier.handle ||
              !attempt.handle ||
              earlier.handle.toLowerCase() === attempt.handle.toLowerCase())
          );
        });
      return assisted ? [{ problem, independent: attempt, assisted }] : [];
    },
  );

  // Current saved tags describe recorded coverage; they are not evidence of understanding.
  const topics = new Map<string, Map<string, Problem>>();
  for (const problem of data.problems) {
    if (
      problem.archived ||
      (problem.cfHandle && problem.cfHandle.toLowerCase() !== handle)
    )
      continue;
    for (const topic of new Set(
      problem.tags.map(normalizedTopic).filter(Boolean),
    )) {
      const related = topics.get(topic) ?? new Map<string, Problem>();
      const key = practiceIdentity(problem);
      const previous = related.get(key);
      if (!previous || (previous.cfHandle && !problem.cfHandle))
        related.set(key, problem);
      topics.set(topic, related);
    }
  }
  const recordsByTopic = new Map<string, LearningRecord[]>();
  for (const record of period.history) {
    for (const topic of new Set(
      record.problemIds
        .flatMap((id) => problemMap.get(id)?.tags ?? [])
        .map(normalizedTopic),
    )) {
      const records = recordsByTopic.get(topic) ?? [];
      records.push(record);
      recordsByTopic.set(topic, records);
    }
  }
  const limitedTopics = [...topics]
    .map(([topic, problems]) => ({
      topic,
      problems: [...problems.values()].sort((a, b) => a.id.localeCompare(b.id)),
      records: recordsByTopic.get(topic) ?? [],
    }))
    .filter((topic) => topic.records.length <= INSIGHT_RULES.limitedTopicEvents)
    .sort(
      (a, b) =>
        a.records.length - b.records.length || a.topic.localeCompare(b.topic),
    );

  const groups = new Map<string, Problem>();
  for (const problem of data.problems) {
    if (problem.cfHandle && problem.cfHandle.toLowerCase() !== handle) continue;
    const identity = practiceIdentity(problem);
    const previous = groups.get(identity);
    if (!previous || (previous.cfHandle && !problem.cfHandle))
      groups.set(identity, problem);
  }
  const dueCoding: DueLearningActivity[] = [],
    dueRecall: DueLearningActivity[] = [];
  const latestRevisions = new Map<string, RevisionRecord>();
  for (const revision of data.revisions ?? []) {
    const problem = problemMap.get(revision.problemId);
    if (
      !problem ||
      (problem.cfHandle && problem.cfHandle.toLowerCase() !== handle) ||
      (revision.handle && revision.handle.toLowerCase() !== handle)
    )
      continue;
    const identity = practiceIdentity(problem);
    const previous = latestRevisions.get(identity);
    if (
      !previous ||
      revision.completedAt > previous.completedAt ||
      (revision.completedAt === previous.completedAt &&
        revision.id.localeCompare(previous.id) < 0)
    )
      latestRevisions.set(identity, revision);
  }
  for (const [identity, problem] of groups) {
    const state = sharedPracticeState(data, problem, now, scope);
    if (
      state.archived ||
      state.skipped ||
      (state.deferredUntil && state.deferredUntil > asOf)
    )
      continue;
    if (state.codingAt && state.codingAt <= asOf) {
      // The saved schedule is the evidence; a nearby attempt is not its provenance.
      dueCoding.push({
        identity,
        problem: state.codingProblem ?? problem,
        date: state.codingAt,
        record: null,
      });
    }
    if (state.recallAt && state.recallAt <= asOf) {
      const record = latestRevisions.get(identity) ?? null;
      dueRecall.push({
        identity,
        problem: record
          ? (problemMap.get(record.problemId) ?? problem)
          : problem,
        date: state.recallAt,
        record,
      });
    }
  }
  const order = (a: DueLearningActivity, b: DueLearningActivity) =>
    a.date.localeCompare(b.date) || a.identity.localeCompare(b.identity);
  return {
    from,
    to,
    asOf,
    history: period.history,
    revisions: period.revisions,
    recallOutcomes: period.outcomes,
    mistakes,
    transitions,
    limitedTopics,
    dueCoding: dueCoding.sort(order),
    dueRecall: dueRecall.sort(order),
  };
}
