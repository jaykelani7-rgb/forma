import {
  activeContest,
  eligibleUpsolves,
  futureUpsolveIdentities,
} from "./contest-lab";
import {
  elapsed,
  dateFromDay,
  localDate,
  matchesFocus,
  shortDate,
  type Data,
  type Problem,
} from "./model";
import {
  learningHistory,
  learningParticipationDays,
  type LearningRecord,
} from "./learning";
import type { RevisionRecord } from "./memory-types";
import {
  practiceIdentity,
  resolvedPracticeProblems,
  sharedPracticeState,
} from "./practice-state";
import {
  nextTrackEntry,
  stageEntries,
  trackContextForEntry,
  trackEntries,
  trackEntryProgress,
  trackProblem,
} from "./tracks";
import {
  practicePlanId,
  validatePracticePreferences,
  type PlanActivity,
  type PlanCompletion,
  type PlanEvidence,
  type PlanKind,
  type PracticePlan,
  type PracticePlanItem,
  type PracticePreferences,
} from "./practice-plan-types";
import type { TrackContext } from "./tracks-types";

export interface PracticeCandidate {
  key: string;
  identity: string;
  problem: Problem;
  fresh: boolean;
  kind: PlanKind;
  activity: PlanActivity;
  reason: string;
  evidence: PlanEvidence[];
  dueAt: string | null;
  relatedCodingAt?: string;
  relatedRecallAt?: string;
  suggestedMinutes: number;
  sourceTimeSuggestion?: string;
  trackContext?: TrackContext;
  position?: { index: number; total: number };
  sessionId?: string;
  upsolvePriority?: "normal" | "high";
}
export const PRACTICE_PLAN_RULES = {
  maximumActivities: 3,
  minimumMinutes: 5,
  recallMinutes: 10,
  returnAfterDays: 7,
} as const;
export function practicePreferences(data: Data): PracticePreferences {
  return (
    data.settings.practicePreferences ?? {
      dailyMinutes: data.settings.defaultDuration,
      preferredDays: [0, 1, 2, 3, 4, 5, 6],
      mode: "mixed",
      targetDate: null,
    }
  );
}
export function setPracticePreferences(
  data: Data,
  value: PracticePreferences,
): Data {
  return {
    ...data,
    settings: {
      ...data.settings,
      practicePreferences: validatePracticePreferences(value),
    },
  };
}
function contextFor(data: Data, problem: Problem) {
  const entry =
    data.activeTrackId &&
    trackEntries(data, data.activeTrackId).find((entry) => {
      const associated = trackProblem(data, entry).problem;
      return practiceIdentity(associated) === practiceIdentity(problem);
    });
  const trackContext = entry && trackContextForEntry(data, entry.id);
  if (!entry || !trackContext) return {};
  const ordered = stageEntries(data, entry.stageId);
  return {
    trackContext,
    position: {
      index: ordered.findIndex((value) => value.id === entry.id) + 1,
      total: ordered.length,
    },
  };
}
interface HistoryIndex {
  records: LearningRecord[];
  currentIdentities: Set<string>;
  completionHandles: Map<string, string | null>;
  latestReflection: Map<string, LearningRecord>;
  byIdentity: Map<string, LearningRecord[]>;
  revisionsByIdentity: Map<string, RevisionRecord[]>;
}
const historyIndexes = new WeakMap<Data, HistoryIndex>();
function historyFor(data: Data): HistoryIndex {
  const retained = historyIndexes.get(data);
  if (retained) return retained;
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const allRecords = learningHistory(data, { allProfiles: true });
  const records = allRecords.filter(
    (record) =>
      !record.handle ||
      record.handle.toLowerCase() ===
        data.codeforces.connectedHandle?.toLowerCase(),
  );
  const latestReflection = new Map<string, LearningRecord>();
  const byIdentity = new Map<string, LearningRecord[]>();
  const completionHandles = new Map<string, string | null>();
  for (const record of allRecords) {
    if (record.timedAttemptId)
      completionHandles.set(`attempt:${record.timedAttemptId}`, record.handle);
    if (record.importedAttemptId)
      completionHandles.set(
        `reflection:${record.importedAttemptId}`,
        record.handle,
      );
    const problem = problems.get(record.problemId);
    if (!problem) continue;
    const identity = practiceIdentity(problem);
    const group = byIdentity.get(identity) ?? [];
    group.push(record);
    byIdentity.set(identity, group);
    if (
      record.outcome === null ||
      (record.handle &&
        record.handle.toLowerCase() !==
          data.codeforces.connectedHandle?.toLowerCase())
    )
      continue;
    const previous = latestReflection.get(identity);
    if (
      !previous ||
      (record.reflectedAt ?? record.completedAt) >
        (previous.reflectedAt ?? previous.completedAt) ||
      ((record.reflectedAt ?? record.completedAt) ===
        (previous.reflectedAt ?? previous.completedAt) &&
        record.id < previous.id)
    )
      latestReflection.set(identity, record);
  }
  const revisionsByIdentity = new Map<string, RevisionRecord[]>();
  for (const record of data.revisions ?? []) {
    completionHandles.set(`revision:${record.id}`, record.handle);
    const problem = problems.get(record.problemId);
    if (!problem) continue;
    const identity = practiceIdentity(problem),
      group = revisionsByIdentity.get(identity) ?? [];
    group.push(record);
    revisionsByIdentity.set(identity, group);
  }
  const currentIdentities = new Set(
    records.flatMap((record) => {
      const problem = problems.get(record.problemId);
      return problem ? [practiceIdentity(problem)] : [];
    }),
  );
  const index = {
    records,
    currentIdentities,
    completionHandles,
    latestReflection,
    byIdentity,
    revisionsByIdentity,
  };
  historyIndexes.set(data, index);
  return index;
}
function reflectionEvidence(data: Data, identity: string): PlanEvidence[] {
  const record = historyFor(data).latestReflection.get(identity);
  if (!record) return [];
  const descriptions = {
    independent: "Your last reflection recorded an independent solve.",
    hint: "Your last reflection recorded hint assistance.",
    editorial: "Your last reflection recorded editorial assistance.",
    unsolved: "Your last reflection recorded an unfinished attempt.",
  };
  if (record.contestSource)
    return [
      {
        type: "contest",
        label: `${descriptions[record.outcome!]} ${record.reflectionSource === "contest" ? "Confirmed in" : "From imported activity supporting"} contest “${record.contestSource.name}”.`,
        recordId: record.id,
        day: localDate(new Date(record.completedAt)),
      },
    ];
  return [
    {
      type: "attempt",
      label: descriptions[record.outcome!],
      recordId: record.timedAttemptId ?? record.importedAttemptId ?? record.id,
      day: localDate(new Date(record.reflectedAt ?? record.completedAt)),
    },
  ];
}
/** One candidate service for Today and deliberate replacement. Coding and recall
 * dates remain separate; identity deduplication happens when selecting a plan. */
export function practiceCandidates(
  data: Data,
  now = new Date(),
): PracticeCandidate[] {
  if (activeContest(data)) return [];
  const today = localDate(now),
    prefs = practicePreferences(data);
  const candidates: PracticeCandidate[] = [];
  const session = data.session;
  const active =
    session &&
    data.problems.find((problem) => problem.id === session.problemId);
  if (session && active) {
    const identity = practiceIdentity(active);
    candidates.push({
      key: `session:${session.id}`,
      identity,
      problem: active,
      fresh: false,
      kind: "session",
      activity: "coding",
      reason:
        "Your unfinished session has saved notes and a timer. Resume it first.",
      evidence: [
        {
          type: "session",
          label: "This unfinished session is still open.",
          recordId: session.id,
          day: localDate(new Date(session.startedAt)),
        },
      ],
      dueAt: null,
      suggestedMinutes: Math.max(
        5,
        Math.min(
          prefs.dailyMinutes,
          Math.ceil(
            (session.targetMinutes * 60000 - elapsed(session, now.getTime())) /
              60000,
          ),
        ),
      ),
      sessionId: session.id,
      ...(session.trackContext ? { trackContext: session.trackContext } : {}),
    });
  }
  if (
    active?.cfHandle &&
    active.cfHandle.toLowerCase() !==
      data.codeforces.connectedHandle?.toLowerCase()
  )
    return candidates;
  const futureUpsolves = futureUpsolveIdentities(data, now);
  const resolved = resolvedPracticeProblems(data, now);
  const allowed = resolved.filter((problem) => {
    const state = sharedPracticeState(data, problem, now);
    return (
      !state.archived &&
      !state.skipped &&
      (!state.deferredUntil || state.deferredUntil <= today)
    );
  });
  const matching = allowed.filter((problem) =>
    matchesFocus(problem, data.settings.focus),
  );
  const relevant = new Set(
    (matching.length ? matching : allowed).map(practiceIdentity),
  );
  for (const problem of allowed) {
    const state = sharedPracticeState(data, problem, now),
      identity = practiceIdentity(problem);
    const related = {
      ...(state.codingAt && state.codingAt <= today
        ? { relatedCodingAt: state.codingAt }
        : {}),
      ...(state.recallAt && state.recallAt <= today
        ? { relatedRecallAt: state.recallAt }
        : {}),
    };
    if (
      state.codingAt &&
      state.codingAt <= today &&
      relevant.has(identity) &&
      !futureUpsolves.has(identity)
    )
      candidates.push({
        key: `coding:${identity}`,
        identity,
        problem,
        fresh: false,
        kind: "coding",
        activity: "coding",
        reason:
          state.codingAt === today
            ? "Your coding revisit is due today."
            : `Your coding revisit was scheduled for ${shortDate(state.codingAt)}.`,
        evidence: [
          {
            type: "schedule",
            label: `Coding revisit date: ${state.codingAt}.`,
            day: state.codingAt,
          },
          ...reflectionEvidence(data, identity),
        ],
        dueAt: state.codingAt,
        suggestedMinutes: data.settings.defaultDuration,
        ...related,
        ...contextFor(data, problem),
      });
    if (
      state.recallAt &&
      state.recallAt <= today &&
      state.recallActivity &&
      relevant.has(identity)
    ) {
      const latest = (data.revisions ?? [])
        .filter(
          (record) =>
            state.problems.some((copy) => copy.id === record.problemId) &&
            (!record.handle ||
              record.handle.toLowerCase() ===
                data.codeforces.connectedHandle?.toLowerCase()),
        )
        .sort(
          (a, b) =>
            b.completedAt.localeCompare(a.completedAt) ||
            b.id.localeCompare(a.id),
        )[0];
      candidates.push({
        key: `recall:${identity}`,
        identity,
        problem,
        fresh: false,
        kind: "recall",
        activity: state.recallActivity,
        reason:
          state.recallAt === today
            ? "This written recall was scheduled for today."
            : `This written recall was scheduled for ${shortDate(state.recallAt)}.`,
        evidence: [
          {
            type: "schedule",
            label: `Written recall date: ${state.recallAt}.`,
            day: state.recallAt,
          },
          ...(latest
            ? [
                {
                  type: "revision" as const,
                  label: "The latest saved written recall set this date.",
                  recordId: latest.id,
                  day: localDate(new Date(latest.completedAt)),
                },
              ]
            : []),
        ],
        dueAt: state.recallAt,
        suggestedMinutes: PRACTICE_PLAN_RULES.recallMinutes,
        ...related,
        ...contextFor(data, problem),
      });
    }
  }
  for (const { contest, row, problem } of eligibleUpsolves(data, now)) {
    const identity = practiceIdentity(problem);
    candidates.unshift({
      key: `upsolve:${row.id}`,
      identity,
      problem,
      fresh: false,
      kind: "coding",
      activity: "coding",
      upsolvePriority: row.upsolve!.priority,
      reason: `Upsolve from ${contest.name}: ${row.reflection ? (row.reflection.outcome === "unsolved" ? "unfinished" : row.reflection.outcome === "independent" ? "deliberately queued" : "assisted") : "unfinished"} contest problem. Saved upsolve priority: ${row.upsolve!.priority}.`,
      evidence: [
        {
          type: "collection",
          label: `Contest Lab / ${contest.name}. Original contest result stays separate.`,
          recordId: contest.id,
        },
        {
          type: "collection",
          label: `Upsolve priority at selection: ${row.upsolve!.priority}.`,
          recordId: row.id,
        },
      ],
      dueAt: row.upsolve!.dueAt ?? today,
      suggestedMinutes: data.settings.defaultDuration,
      ...contextFor(data, problem),
    });
  }
  const next =
    data.activeTrackId && nextTrackEntry(data, data.activeTrackId, now);
  if (next) {
    const identity = practiceIdentity(next.problem),
      state = sharedPracticeState(data, next.problem, now);
    // Due revisits already have their schedule-backed candidate.
    if (
      (!state.codingAt || state.codingAt > today) &&
      !futureUpsolves.has(identity)
    )
      candidates.push({
        key: `track:${next.entry.id}`,
        identity,
        problem: next.problem,
        fresh: next.fresh,
        kind: "track",
        activity: "coding",
        reason: `This is the next eligible problem in ${next.stage.title}.`,
        evidence: [
          {
            type: "track",
            label: `Selected in ${next.track.title} / ${next.stage.title} using saved track order.`,
            recordId: next.entry.id,
          },
          ...reflectionEvidence(data, identity),
        ],
        dueAt: null,
        suggestedMinutes: data.settings.defaultDuration,
        ...(next.stage.suggestedTime
          ? { sourceTimeSuggestion: next.stage.suggestedTime }
          : {}),
        trackContext: trackContextForEntry(data, next.entry.id)!,
        ...contextFor(data, next.problem),
        ...(state.recallAt && state.recallAt <= today
          ? { relatedRecallAt: state.recallAt }
          : {}),
      });
  }
  const completedActive = new Set(
    data.activeTrackId
      ? trackEntries(data, data.activeTrackId)
          .filter((entry) => {
            const progress = trackEntryProgress(data, entry, now);
            return progress.independent && !progress.revisitDue;
          })
          .map((entry) =>
            practiceIdentity(trackProblem(data, entry, now).problem),
          )
      : [],
  );
  const collected = allowed.filter(
    (problem) =>
      relevant.has(practiceIdentity(problem)) &&
      !futureUpsolves.has(practiceIdentity(problem)) &&
      sharedPracticeState(data, problem, now).eligible &&
      !completedActive.has(practiceIdentity(problem)) &&
      (!problem.cfHandle ||
        data.attempts.some((attempt) => attempt.problemId === problem.id)),
  );
  for (const problem of collected) {
    const identity = practiceIdentity(problem);
    if (
      candidates.some(
        (candidate) =>
          candidate.identity === identity && candidate.activity === "coding",
      )
    )
      continue;
    const evidence = reflectionEvidence(data, identity);
    candidates.push({
      key: `collection:${identity}`,
      identity,
      problem,
      fresh: false,
      kind: "collection",
      activity: "coding",
      reason: historyFor(data).currentIdentities.has(identity)
        ? "A familiar eligible problem from your saved collection."
        : "An untouched eligible problem from your saved collection.",
      evidence: [
        {
          type: "collection",
          label:
            "This problem is saved in your collection and is eligible today.",
          recordId: problem.id,
        },
        ...evidence,
      ],
      dueAt: null,
      suggestedMinutes: data.settings.defaultDuration,
    });
  }
  const rank = (candidate: PracticeCandidate) =>
    candidate.kind === "session"
      ? 0
      : candidate.kind === "coding" || candidate.kind === "recall"
        ? 1
        : candidate.kind === "track"
          ? 2
          : 3;
  return candidates.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueAt ?? "").localeCompare(b.dueAt ?? "") ||
      Number(a.kind === "recall") - Number(b.kind === "recall") ||
      Number(!a.key.startsWith("upsolve:")) -
        Number(!b.key.startsWith("upsolve:")) ||
      Number(b.upsolvePriority === "high") -
        Number(a.upsolvePriority === "high") ||
      a.identity.localeCompare(b.identity) ||
      a.key.localeCompare(b.key),
  );
}
function planHandle(data: Data): string | null {
  const active =
    data.session &&
    data.problems.find((problem) => problem.id === data.session!.problemId);
  return (
    active?.cfHandle?.toLowerCase() ??
    data.codeforces.connectedHandle?.toLowerCase() ??
    null
  );
}
export function currentPracticePlan(
  data: Data,
  now = new Date(),
): PracticePlan | null {
  const id = practicePlanId(localDate(now), planHandle(data));
  return data.practicePlans?.find((plan) => plan.id === id) ?? null;
}
function savePlan(data: Data, plan: PracticePlan): Data {
  const previous = data.practicePlans?.find((value) => value.id === plan.id);
  if (previous && JSON.stringify(previous) === JSON.stringify(plan))
    return data;
  if (plan.items.length > 100 || plan.messages.length > 100)
    throw new Error(
      "This day has reached the supported 100 plan decisions. Your existing plan and learning records are preserved.",
    );
  if (!previous && (data.practicePlans?.length ?? 0) >= 5000)
    throw new Error(
      "This workspace has reached 5,000 saved day plans. Export your notebook before changing its history.",
    );
  return {
    ...data,
    practicePlans: [
      ...(data.practicePlans ?? []).filter((value) => value.id !== plan.id),
      plan,
    ],
  };
}
function asItem(
  candidate: PracticeCandidate,
  plan: PracticePlan,
  now: Date,
  minutes: number,
  deliberate = false,
): PracticePlanItem {
  return {
    id: `${plan.id}:item:${plan.nextSequence}`,
    candidateKey: candidate.key,
    problemId: candidate.problem.id,
    identity: candidate.identity,
    kind: candidate.kind,
    activity: candidate.activity,
    timeboxMinutes: minutes,
    reason: candidate.reason,
    evidence: candidate.evidence,
    selectedAt: now.toISOString(),
    status: "pending",
    ...(candidate.dueAt ? { scheduleAt: candidate.dueAt } : {}),
    ...(candidate.relatedCodingAt
      ? { relatedCodingAt: candidate.relatedCodingAt }
      : {}),
    ...(candidate.relatedRecallAt
      ? { relatedRecallAt: candidate.relatedRecallAt }
      : {}),
    ...(candidate.trackContext ? { trackContext: candidate.trackContext } : {}),
    ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {}),
    ...(candidate.upsolvePriority
      ? { upsolvePriority: candidate.upsolvePriority }
      : {}),
    ...(deliberate ? { deliberate: true } : {}),
  };
}
function ordered(
  candidates: PracticeCandidate[],
  mode: PracticePreferences["mode"],
) {
  if (mode === "mixed") return candidates;
  const first = candidates[0],
    track = candidates.find((candidate) => candidate.kind === "track");
  return [
    ...(first ? [first] : []),
    ...(track && track !== first ? [track] : []),
    ...candidates.filter(
      (candidate) => candidate !== first && candidate !== track,
    ),
  ];
}
function allocated(plan: PracticePlan): number {
  return plan.items
    .filter((item) => item.status === "pending" || item.status === "completed")
    .reduce((sum, item) => sum + item.timeboxMinutes, 0);
}
function addCandidates(
  data: Data,
  plan: PracticePlan,
  now: Date,
  count: number,
): PracticePlan {
  let next = plan;
  const identities = new Set(
    plan.items
      .filter((item) => item.status !== "stale")
      .map((item) => item.identity),
  );
  for (const candidate of ordered(
    practiceCandidates(data, now),
    practicePreferences(data).mode,
  )) {
    if (
      count <= 0 ||
      next.items.filter((item) => item.status === "pending").length >=
        PRACTICE_PLAN_RULES.maximumActivities
    )
      break;
    if (identities.has(candidate.identity)) continue;
    const available = next.budgetMinutes - allocated(next);
    if (available < 5) break;
    const item = asItem(
      candidate,
      next,
      now,
      Math.max(5, Math.min(candidate.suggestedMinutes, available)),
    );
    next = {
      ...next,
      items: [...next.items, item],
      nextSequence: next.nextSequence + 1,
    };
    identities.add(candidate.identity);
    count--;
  }
  return next;
}
function completionFor(
  data: Data,
  plan: PracticePlan,
  item: PracticePlanItem,
): PlanCompletion | null {
  const inScope = (handle: string | null | undefined) =>
    !handle || handle.toLowerCase() === plan.handle?.toLowerCase();
  const onPlanDay = (stamp: string) =>
    new Date(Date.parse(stamp) - plan.timezoneOffset * 60000)
      .toISOString()
      .slice(0, 10) === plan.day;
  if (item.activity !== "coding") {
    const record = (
      historyFor(data).revisionsByIdentity.get(item.identity) ?? []
    )
      .filter(
        (record) =>
          inScope(record.handle) &&
          record.activity === item.activity &&
          record.completedAt >= item.selectedAt &&
          onPlanDay(record.completedAt),
      )
      .sort(
        (a, b) =>
          a.completedAt.localeCompare(b.completedAt) ||
          a.id.localeCompare(b.id),
      )[0];
    return record
      ? {
          type: "revision",
          recordId: record.id,
          completedAt: record.completedAt,
        }
      : null;
  }
  const records = (historyFor(data).byIdentity.get(item.identity) ?? []).filter(
    (record) => inScope(record.handle),
  );
  const candidates: PlanCompletion[] = records.flatMap<PlanCompletion>(
    (record) => {
      if (
        record.timedAttemptId &&
        ((record.completedAt >= item.selectedAt &&
          onPlanDay(record.completedAt)) ||
          record.timedAttemptId === item.sessionId)
      )
        return [
          {
            type: "attempt" as const,
            recordId: record.timedAttemptId,
            completedAt: record.completedAt,
          },
        ];
      if (
        record.importedAttemptId &&
        record.reflectionSource === "codeforces" &&
        record.outcome !== null &&
        record.reflectedAt &&
        record.reflectedAt >= item.selectedAt &&
        onPlanDay(record.reflectedAt)
      )
        return [
          {
            type: "reflection" as const,
            recordId: record.importedAttemptId,
            completedAt: record.reflectedAt,
          },
        ];
      return [];
    },
  );
  return (
    candidates.sort(
      (a, b) =>
        a.completedAt.localeCompare(b.completedAt) ||
        a.recordId.localeCompare(b.recordId),
    )[0] ?? null
  );
}
function staleReason(
  data: Data,
  item: PracticePlanItem,
  candidate: PracticeCandidate | undefined,
  now: Date,
): string | null {
  const problem =
    data.problems.find((problem) => problem.id === item.problemId) ??
    (candidate?.fresh ? candidate.problem : undefined);
  if (
    data.session &&
    practiceIdentity(
      data.problems.find((problem) => problem.id === data.session!.problemId)!,
    ) === item.identity
  )
    return null;
  if (problem && practiceIdentity(problem) !== item.identity)
    return "The problem identity was edited. Its pending activity was replaced while keeping the original selection evidence.";
  if (!problem)
    return "The referenced problem is no longer available. A pending activity was replaced.";
  if (
    item.trackContext &&
    !data.trackEntries?.some(
      (entry) =>
        entry.id === item.trackContext!.entryId &&
        practiceIdentity(trackProblem(data, entry, now).problem) ===
          item.identity,
    )
  )
    return "This track membership was removed or changed. A pending activity was replaced.";
  const state = sharedPracticeState(data, problem, now);
  if (
    state.archived ||
    state.skipped ||
    (state.deferredUntil && state.deferredUntil > localDate(now))
  )
    return "This problem was archived, skipped, or deferred. A pending activity was replaced.";
  if (
    !candidate ||
    candidate.activity !== item.activity ||
    (item.scheduleAt && candidate.dueAt !== item.scheduleAt)
  )
    return "The schedule or eligible track order changed. A pending activity was replaced.";
  return null;
}
function upsolvePriorityChangeReason(
  item: PracticePlanItem,
  candidate: PracticeCandidate | undefined,
  plan: PracticePlan,
  unselectedHighPriorityDates: Set<string | null>,
) {
  if (
    !candidate?.upsolvePriority ||
    item.deliberate ||
    item.sessionId ||
    plan.status === "ended"
  )
    return null;
  if ((item.upsolvePriority ?? "normal") !== candidate.upsolvePriority)
    return item.upsolvePriority
      ? "This upsolve’s priority changed. Its automatic choice was replaced while retaining the original selection evidence."
      : "This older automatic choice did not save its upsolve priority. It was refreshed with the current priority while retaining the original selection evidence.";
  if (candidate.upsolvePriority === "high") return null;
  return unselectedHighPriorityDates.has(candidate.dueAt)
    ? "A high-priority upsolve now precedes this automatic choice under the same scheduling conditions. The original selection evidence is retained."
    : null;
}
/** Pure, retry-safe reconciliation. Refreshes keep the same selections; only
 * saved activity evidence completes items. Stale pending rows remain visible. */
export function reconcilePracticePlan(data: Data, now = new Date()): Data {
  // Completion evidence is scoped to each saved plan, including the plan from
  // before midnight or from an archived profile. No activity record is copied.
  let completedChanged = false;
  const completedPlans = data.practicePlans?.map((plan) => {
    let changed = false;
    const messages = [...plan.messages];
    const items = plan.items.map((item) => {
      if (item.status === "completed" && item.completion) {
        const handle = historyFor(data).completionHandles.get(
          `${item.completion.type}:${item.completion.recordId}`,
        );
        if (handle && handle.toLowerCase() !== plan.handle?.toLowerCase()) {
          changed = true;
          const reason =
            "This saved activity was explicitly linked to another profile. Its original completion evidence is retained without adding participation to this profile.";
          if (!messages.includes(reason)) messages.push(reason);
          return {
            ...item,
            status: "stale" as const,
            changeReason: reason,
            decisionAt: now.toISOString(),
          };
        }
      }
      if (item.status !== "pending") return item;
      const completion = completionFor(data, plan, item);
      if (!completion) return item;
      changed = true;
      return { ...item, status: "completed" as const, completion };
    });
    if (!changed) return plan;
    completedChanged = true;
    return { ...plan, items, messages, updatedAt: now.toISOString() };
  });
  if (completedChanged) data = { ...data, practicePlans: completedPlans };
  const previous = currentPracticePlan(data, now),
    prefs = practicePreferences(data);
  if (!previous) {
    let plan: PracticePlan = {
      id: practicePlanId(localDate(now), planHandle(data)),
      day: localDate(now),
      handle: planHandle(data),
      timezoneOffset: now.getTimezoneOffset(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      budgetMinutes: prefs.dailyMinutes,
      availabilityOverride: false,
      status: "active",
      items: [],
      nextSequence: 0,
      messages: [],
    };
    if (prefs.preferredDays.includes(now.getDay()) || data.session)
      plan = addCandidates(
        data,
        plan,
        now,
        data.session && !prefs.preferredDays.includes(now.getDay())
          ? 1
          : PRACTICE_PLAN_RULES.maximumActivities,
      );
    return savePlan(data, plan);
  }
  const candidates = new Map(
    practiceCandidates(data, now).map((candidate) => [
      candidate.key,
      candidate,
    ]),
  );
  const retainedIdentities = new Set(
    previous.items
      .filter(
        (item) =>
          item.status !== "stale" &&
          (item.status !== "pending" ||
            item.deliberate ||
            item.sessionId ||
            item.upsolvePriority === "high"),
      )
      .map((item) => item.identity),
  );
  const unselectedHighPriorityDates = new Set(
    [...candidates.values()]
      .filter(
        (candidate) =>
          candidate.upsolvePriority === "high" &&
          !retainedIdentities.has(candidate.identity),
      )
      .map((candidate) => candidate.dueAt),
  );
  let replacementCount = 0,
    changed = false;
  const messages = [...previous.messages];
  const items = previous.items.map((item) => {
    if (item.status !== "pending") return item;
    if (
      previous.handle !==
        (data.codeforces.connectedHandle?.toLowerCase() ?? null) &&
      data.session &&
      item.identity !==
        practiceIdentity(
          data.problems.find(
            (problem) => problem.id === data.session!.problemId,
          )!,
        )
    )
      return item;
    const completion = completionFor(data, previous, item);
    if (completion) {
      changed = true;
      return { ...item, status: "completed" as const, completion };
    }
    const activeProblem =
      data.session &&
      data.problems.find((problem) => problem.id === data.session!.problemId);
    if (
      activeProblem &&
      item.activity === "coding" &&
      practiceIdentity(activeProblem) === item.identity &&
      item.sessionId !== data.session!.id
    ) {
      changed = true;
      return { ...item, sessionId: data.session!.id };
    }
    if (
      activeProblem &&
      item.activity !== "coding" &&
      !item.deliberate &&
      practiceIdentity(activeProblem) === item.identity
    ) {
      changed = true;
      const reason =
        "A coding session was started for this problem. Its written recall remains separately due in your backlog.";
      if (!messages.includes(reason)) messages.push(reason);
      return {
        ...item,
        status: "stale" as const,
        changeReason: reason,
        decisionAt: now.toISOString(),
      };
    }
    const candidate = candidates.get(item.candidateKey);
    const reason =
      staleReason(data, item, candidate, now) ??
      upsolvePriorityChangeReason(
        item,
        candidate,
        previous,
        unselectedHighPriorityDates,
      );
    if (!reason) return item;
    changed = true;
    replacementCount++;
    if (!messages.includes(reason)) messages.push(reason);
    return {
      ...item,
      status: "stale" as const,
      changeReason: reason,
      decisionAt: now.toISOString(),
    };
  });
  let next = changed
    ? { ...previous, items, messages, updatedAt: now.toISOString() }
    : previous;
  if (
    next.status === "active" &&
    (replacementCount ||
      (next.items.length === 0 &&
        (prefs.preferredDays.includes(now.getDay()) ||
          next.availabilityOverride)))
  )
    next = addCandidates(
      data,
      next,
      now,
      replacementCount || PRACTICE_PLAN_RULES.maximumActivities,
    );
  // A new unfinished session takes priority, including manual starts and midnight.
  const sessionCandidate = [...candidates.values()].find(
    (candidate) => candidate.kind === "session",
  );
  if (
    sessionCandidate &&
    !next.items.some(
      (item) =>
        item.status === "pending" &&
        item.identity === sessionCandidate.identity &&
        item.activity === "coding",
    )
  ) {
    const available = Math.max(5, next.budgetMinutes - allocated(next));
    const item = asItem(
      sessionCandidate,
      next,
      now,
      Math.min(sessionCandidate.suggestedMinutes, available),
    );
    next = {
      ...next,
      items: [item, ...next.items],
      nextSequence: next.nextSequence + 1,
      updatedAt: now.toISOString(),
    };
  }
  return savePlan(data, next);
}
export function resolvePlanProblem(
  data: Data,
  item: PracticePlanItem,
): {
  problem: Problem;
  fresh: boolean;
  trackContext?: TrackContext;
  position?: { index: number; total: number };
} | null {
  const active =
    data.session &&
    data.problems.find((problem) => problem.id === data.session!.problemId);
  const owningPlan = data.practicePlans?.find((plan) =>
    plan.items.some((value) => value.id === item.id),
  );
  if (
    item.activity === "coding" &&
    active &&
    practiceIdentity(active) === item.identity &&
    (!active.cfHandle ||
      active.cfHandle.toLowerCase() === owningPlan?.handle?.toLowerCase())
  )
    return {
      problem: active,
      fresh: false,
      ...(data.session?.trackContext
        ? { trackContext: data.session.trackContext }
        : {}),
    };
  const problem = data.problems.find(
    (problem) =>
      problem.id === item.problemId &&
      practiceIdentity(problem) === item.identity,
  );
  if (problem)
    return {
      problem,
      fresh: false,
      ...(item.trackContext ? { trackContext: item.trackContext } : {}),
    };
  const entry =
    item.trackContext &&
    data.trackEntries?.find((entry) => entry.id === item.trackContext!.entryId);
  if (!entry) return null;
  const resolved = trackProblem(data, entry);
  return practiceIdentity(resolved.problem) === item.identity
    ? { ...resolved, trackContext: item.trackContext }
    : null;
}
function existing(data: Data, now: Date): { data: Data; plan: PracticePlan } {
  const next = reconcilePracticePlan(data, now);
  return { data: next, plan: currentPracticePlan(next, now)! };
}
export function setPlanAvailability(
  data: Data,
  minutes: number,
  now = new Date(),
): Data {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180)
    throw new Error("Choose an available time budget from 5 to 180 minutes.");
  const current = existing(data, now);
  let plan = {
    ...current.plan,
    budgetMinutes: minutes,
    availabilityOverride: true,
    updatedAt: now.toISOString(),
  };
  // Deliberate choices and completed evidence survive an availability change.
  let available = Math.max(
    0,
    minutes -
      plan.items
        .filter((item) => item.status === "completed")
        .reduce((sum, item) => sum + item.timeboxMinutes, 0),
  );
  plan = {
    ...plan,
    items: plan.items.map((item) => {
      if (item.status !== "pending") return item;
      if (available < 5 && !item.sessionId)
        return {
          ...item,
          status: "stale" as const,
          changeReason:
            "The available time was reduced. This activity remains in your backlog.",
          decisionAt: now.toISOString(),
        };
      const allocation = item.sessionId
        ? Math.max(5, Math.min(item.timeboxMinutes, available))
        : Math.min(item.timeboxMinutes, available);
      available -= allocation;
      return { ...item, timeboxMinutes: allocation };
    }),
  };
  if (
    plan.status === "active" &&
    (minutes > current.plan.budgetMinutes ||
      !plan.items.some((item) => item.status === "pending"))
  )
    plan = addCandidates(
      current.data,
      plan,
      now,
      PRACTICE_PLAN_RULES.maximumActivities,
    );
  return savePlan(current.data, plan);
}
export function setPlanTimebox(
  data: Data,
  itemId: string,
  minutes: number,
  now = new Date(),
): Data {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180)
    throw new Error("Choose a planned timebox from 5 to 180 minutes.");
  const current = existing(data, now);
  const item = current.plan.items.find((item) => item.id === itemId);
  if (!item || item.status !== "pending")
    throw new Error("This activity is no longer pending.");
  return savePlan(current.data, {
    ...current.plan,
    updatedAt: now.toISOString(),
    items: current.plan.items.map((item) =>
      item.id === itemId
        ? { ...item, timeboxMinutes: minutes, deliberate: true }
        : item,
    ),
  });
}
export function markPlanStarted(
  data: Data,
  itemId: string,
  sessionId: string,
  now = new Date(),
): Data {
  const plan = currentPracticePlan(data, now);
  if (!plan || !data.session || data.session.id !== sessionId)
    throw new Error("The saved session is no longer available.");
  const item = plan.items.find(
    (item) => item.id === itemId && item.status === "pending",
  );
  const problem = data.problems.find(
    (problem) => problem.id === data.session!.problemId,
  );
  if (
    !item ||
    !problem ||
    item.identity !== practiceIdentity(problem) ||
    item.activity !== "coding"
  )
    throw new Error("The session does not match this planned activity.");
  return savePlan(data, {
    ...plan,
    updatedAt: now.toISOString(),
    items: plan.items.map((value) =>
      value.id === itemId ? { ...value, sessionId } : value,
    ),
  });
}
export function replacePlanItem(
  data: Data,
  itemId: string,
  candidateKey: string,
  now = new Date(),
): Data {
  const current = existing(data, now),
    item = current.plan.items.find(
      (item) => item.id === itemId && item.status === "pending",
    );
  if (!item) throw new Error("This planned activity is no longer pending.");
  if (item.candidateKey === candidateKey) return current.data;
  const candidate = practiceCandidates(current.data, now).find(
    (candidate) => candidate.key === candidateKey,
  );
  if (!candidate)
    throw new Error("That alternative is no longer eligible today.");
  if (
    data.session &&
    item.identity ===
      practiceIdentity(
        data.problems.find(
          (problem) => problem.id === data.session!.problemId,
        )!,
      )
  )
    throw new Error(
      "Finish or pause your current session before replacing its plan item.",
    );
  if (
    current.plan.items.some(
      (value) =>
        value.status === "pending" &&
        value.id !== itemId &&
        value.identity === candidate.identity &&
        value.activity === candidate.activity,
    )
  )
    throw new Error("This activity is already in today’s plan.");
  const replacement = asItem(
    candidate,
    current.plan,
    now,
    item.timeboxMinutes,
    true,
  );
  return savePlan(current.data, {
    ...current.plan,
    updatedAt: now.toISOString(),
    nextSequence: current.plan.nextSequence + 1,
    items: current.plan.items.flatMap((value) =>
      value.id === itemId
        ? [
            {
              ...value,
              status: "stale" as const,
              deliberate: true,
              decisionAt: now.toISOString(),
              changeReason: "You chose a different eligible activity.",
            },
            replacement,
          ]
        : [value],
    ),
  });
}
export function decidePlanItem(
  data: Data,
  itemId: string,
  decision: "skip" | "defer",
  until?: string,
  now = new Date(),
): Data {
  const current = existing(data, now),
    item = current.plan.items.find((item) => item.id === itemId);
  if (!item || item.status !== "pending") return current.data;
  if (
    decision === "defer" &&
    (!until ||
      !/^\d{4}-\d{2}-\d{2}$/.test(until) ||
      until <= localDate(now) ||
      !Number.isFinite(Date.parse(`${until}T12:00:00`)) ||
      localDate(new Date(`${until}T12:00:00`)) !== until)
  )
    throw new Error("Choose a valid future day for this deferral.");
  const problems = current.data.problems.map((problem) =>
    practiceIdentity(problem) === item.identity &&
    (!problem.cfHandle ||
      problem.cfHandle.toLowerCase() ===
        data.codeforces.connectedHandle?.toLowerCase())
      ? {
          ...problem,
          ...(decision === "skip"
            ? { skippedOn: localDate(now) }
            : { deferredUntil: until }),
        }
      : problem,
  );
  const next = savePlan(
    { ...current.data, problems },
    {
      ...current.plan,
      updatedAt: now.toISOString(),
      items: current.plan.items.map((value) =>
        value.id === itemId
          ? {
              ...value,
              status: decision === "skip" ? "skipped" : "deferred",
              deliberate: true,
              decisionAt: now.toISOString(),
              ...(until ? { deferredUntil: until } : {}),
              changeReason:
                decision === "skip"
                  ? "You skipped this activity for today. No learning result was created."
                  : `You deferred this activity until ${until}. Its coding and recall dates were retained.`,
            }
          : value,
      ),
    },
  );
  return next;
}
export function endPracticePlan(data: Data, now = new Date()): Data {
  const current = existing(data, now);
  return current.plan.status === "ended"
    ? current.data
    : savePlan(current.data, {
        ...current.plan,
        status: "ended",
        updatedAt: now.toISOString(),
      });
}
export function continuePracticePlan(data: Data, now = new Date()): Data {
  const current = existing(data, now);
  let plan: PracticePlan = {
    ...current.plan,
    status: "active" as const,
    updatedAt: now.toISOString(),
  };
  if (!plan.items.some((item) => item.status === "pending")) {
    // An explicit extra uses a new editable allocation; it is never measured time.
    const needed = Math.max(5, data.settings.defaultDuration);
    plan = {
      ...plan,
      budgetMinutes: Math.min(
        180,
        Math.max(plan.budgetMinutes, allocated(plan) + needed),
      ),
    };
    plan = addCandidates(current.data, plan, now, 1);
  }
  return savePlan(current.data, plan);
}
export function practicePlanView(data: Data, now = new Date()) {
  const plan = currentPracticePlan(data, now),
    candidates = practiceCandidates(data, now);
  const pending = plan?.items.filter((item) => item.status === "pending") ?? [];
  const activeIdentity =
    data.session &&
    data.problems.find((problem) => problem.id === data.session!.problemId);
  const primary = activeIdentity
    ? (pending.find(
        (item) =>
          item.identity === practiceIdentity(activeIdentity) &&
          item.activity === "coding",
      ) ??
      pending[0] ??
      null)
    : plan?.status === "ended"
      ? null
      : (pending[0] ?? null);
  const history = learningParticipationDays(data);
  const recall = (data.revisions ?? [])
    .filter(
      (record) =>
        !record.handle ||
        record.handle.toLowerCase() ===
          data.codeforces.connectedHandle?.toLowerCase(),
    )
    .map((record) => localDate(new Date(record.completedAt)));
  const latest = [...history, ...recall]
    .filter((day) => day <= localDate(now))
    .sort()
    .at(-1);
  const latestDate = latest ? dateFromDay(latest) : null;
  const dayDistance = latestDate
    ? Math.floor(
        (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
          Date.UTC(
            latestDate.getFullYear(),
            latestDate.getMonth(),
            latestDate.getDate(),
          )) /
          86400000,
      )
    : 0;
  return {
    plan,
    primary,
    remaining: pending.filter((item) => item.id !== primary?.id),
    completed: plan?.items.filter((item) => item.status === "completed") ?? [],
    candidates,
    backlogCount: new Set(
      candidates
        .filter(
          (candidate) =>
            candidate.kind === "coding" || candidate.kind === "recall",
        )
        .map((candidate) => candidate.identity),
    ).size,
    preferredDay: practicePreferences(data).preferredDays.includes(
      now.getDay(),
    ),
    restart:
      latest && dayDistance >= PRACTICE_PLAN_RULES.returnAfterDays
        ? { days: dayDistance, lastPractisedAt: latest }
        : null,
    allocatedMinutes: plan ? allocated(plan) : 0,
    timezoneChanged: !!plan && plan.timezoneOffset !== now.getTimezoneOffset(),
  };
}
