import type { Data } from "./model";
import { canonicalProblemIdentity } from "./codeforces-identity";
import { validateTrackContext, type TrackContext } from "./tracks-types";

export interface PracticePreferences {
  dailyMinutes: number;
  /** JavaScript local-calendar weekday: Sunday = 0, Saturday = 6. */
  preferredDays: number[];
  mode: "track" | "mixed";
  targetDate: string | null;
}
export type PlanActivity = "coding" | "explain" | "complexity";
export type PlanKind = "session" | "coding" | "recall" | "track" | "collection";
export interface PlanEvidence {
  type:
    | "schedule"
    | "attempt"
    | "contest"
    | "revision"
    | "track"
    | "session"
    | "collection";
  label: string;
  recordId?: string;
  day?: string;
}
export interface PlanCompletion {
  type: "attempt" | "reflection" | "revision";
  recordId: string;
  completedAt: string;
}
export interface PracticePlanItem {
  id: string;
  candidateKey: string;
  problemId: string;
  identity: string;
  kind: PlanKind;
  activity: PlanActivity;
  timeboxMinutes: number;
  reason: string;
  evidence: PlanEvidence[];
  selectedAt: string;
  status: "pending" | "completed" | "skipped" | "deferred" | "stale";
  scheduleAt?: string;
  relatedCodingAt?: string;
  relatedRecallAt?: string;
  trackContext?: TrackContext;
  sessionId?: string;
  upsolvePriority?: "normal" | "high";
  deliberate?: boolean;
  decisionAt?: string;
  deferredUntil?: string;
  changeReason?: string;
  completion?: PlanCompletion;
}
export interface PracticePlan {
  id: string;
  day: string;
  handle: string | null;
  timezoneOffset: number;
  createdAt: string;
  updatedAt: string;
  budgetMinutes: number;
  availabilityOverride: boolean;
  status: "active" | "ended";
  items: PracticePlanItem[];
  nextSequence: number;
  messages: string[];
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const stamp = (v: unknown): v is string =>
  text(v, 40, 10) &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string =>
  text(v, 10, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T12:00:00Z`)) &&
  new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const fail = (message: string): never => {
  throw new Error(message);
};
export function validatePracticePreferences(
  value: unknown,
): PracticePreferences {
  if (
    !obj(value) ||
    !integer(value.dailyMinutes, 5, 180) ||
    !Array.isArray(value.preferredDays) ||
    value.preferredDays.length > 7 ||
    new Set(value.preferredDays).size !== value.preferredDays.length ||
    !value.preferredDays.every((v) => integer(v, 0, 6)) ||
    !["track", "mixed"].includes(value.mode as string) ||
    !(value.targetDate === null || day(value.targetDate))
  )
    return fail(
      "Practice preferences need a 5–180 minute budget, unique practice days, and a valid optional target date.",
    );
  return {
    dailyMinutes: value.dailyMinutes,
    preferredDays: [...value.preferredDays].sort((a, b) => a - b),
    mode: value.mode as PracticePreferences["mode"],
    targetDate: value.targetDate as string | null,
  };
}
export function practicePlanId(day: string, handle: string | null): string {
  return `plan:${day}:${handle ? `cf:${handle.toLowerCase()}` : "notebook"}`;
}
export function validatePracticePlans(
  value: unknown,
  data: Pick<
    Data,
    "problems" | "attempts" | "revisions" | "codeforces" | "learningLinks"
  >,
): PracticePlan[] {
  if (!Array.isArray(value) || value.length > 5000)
    return fail(
      "Practice plans exceed the supported 5,000 day plans or have invalid fields.",
    );
  const ids = new Set<string>();
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const attempts = new Map(
    data.attempts.map((attempt) => [attempt.id, attempt]),
  );
  const revisions = new Map(
    (data.revisions ?? []).map((record) => [record.id, record]),
  );
  const imported = new Map(
    data.codeforces.practiceAttempts.map((record) => [record.id, record]),
  );
  const reflections = new Map(
    data.codeforces.reflections.map((record) => [record.attemptId, record]),
  );
  const linked = new Map(
    data.learningLinks?.map((link) => [link.timedAttemptId, link]),
  );
  const handles = new Set(
    data.codeforces.profiles.map((profile) => profile.handle.toLowerCase()),
  );
  return value.map((raw) => {
    if (
      !obj(raw) ||
      !day(raw.day) ||
      !(
        raw.handle === null ||
        (text(raw.handle, 24, 3) &&
          /^[A-Za-z0-9_.-]+$/.test(raw.handle) &&
          handles.has(raw.handle.toLowerCase()))
      ) ||
      raw.id !== practicePlanId(raw.day, raw.handle as string | null) ||
      ids.has(raw.id as string) ||
      !integer(raw.timezoneOffset, -840, 840) ||
      !stamp(raw.createdAt) ||
      !stamp(raw.updatedAt) ||
      !integer(raw.budgetMinutes, 5, 180) ||
      typeof raw.availabilityOverride !== "boolean" ||
      !["active", "ended"].includes(raw.status as string) ||
      !integer(raw.nextSequence, 0, 100000) ||
      !Array.isArray(raw.items) ||
      raw.items.length > 100 ||
      !Array.isArray(raw.messages) ||
      raw.messages.length > 100 ||
      !raw.messages.every((message) => text(message, 1000))
    )
      return fail(
        "A practice plan has invalid calendar, profile, availability, or lifecycle fields.",
      );
    ids.add(raw.id as string);
    const itemIds = new Set<string>();
    const items = raw.items.map((item) => {
      if (
        !obj(item) ||
        !text(item.id, 200, 1) ||
        itemIds.has(item.id) ||
        !text(item.candidateKey, 400, 1) ||
        !text(item.problemId, 200, 1) ||
        !text(item.identity, 300, 1) ||
        !(
          (item.identity.startsWith("problem:") && item.identity.length > 8) ||
          /^(?:contest|gym):[1-9]\d{0,8}:[A-Z]\d{0,9}$/.test(item.identity)
        ) ||
        !["session", "coding", "recall", "track", "collection"].includes(
          item.kind as string,
        ) ||
        !["coding", "explain", "complexity"].includes(
          item.activity as string,
        ) ||
        (item.kind === "recall") !== (item.activity !== "coding") ||
        !(
          item.upsolvePriority === undefined ||
          (["normal", "high"].includes(String(item.upsolvePriority)) &&
            item.candidateKey.startsWith("upsolve:") &&
            item.kind === "coding" &&
            item.activity === "coding")
        ) ||
        !integer(item.timeboxMinutes, 5, 180) ||
        !text(item.reason, 1000, 1) ||
        !stamp(item.selectedAt) ||
        !["pending", "completed", "skipped", "deferred", "stale"].includes(
          item.status as string,
        ) ||
        !Array.isArray(item.evidence) ||
        item.evidence.length > 20 ||
        ![
          item.scheduleAt,
          item.relatedCodingAt,
          item.relatedRecallAt,
          item.deferredUntil,
        ].every((value) => value === undefined || day(value)) ||
        !(item.sessionId === undefined || text(item.sessionId, 100, 1)) ||
        !(
          item.deliberate === undefined || typeof item.deliberate === "boolean"
        ) ||
        !(item.decisionAt === undefined || stamp(item.decisionAt)) ||
        !(item.changeReason === undefined || text(item.changeReason, 1000))
      )
        return fail(
          "A planned activity has invalid references, allocation, or evidence.",
        );
      const prefix = `${raw.id}:item:`;
      const sequence = item.id.startsWith(prefix)
        ? Number(item.id.slice(prefix.length))
        : NaN;
      if (
        !Number.isInteger(sequence) ||
        sequence < 0 ||
        sequence >= (raw.nextSequence as number) ||
        item.id !== `${prefix}${sequence}`
      )
        return fail(
          "A planned activity has invalid stable identity or sequence references.",
        );
      itemIds.add(item.id);
      const evidence = item.evidence.map((source) => {
        if (
          !obj(source) ||
          ![
            "schedule",
            "attempt",
            "contest",
            "revision",
            "track",
            "session",
            "collection",
          ].includes(source.type as string) ||
          !text(source.label, 1000, 1) ||
          !(source.recordId === undefined || text(source.recordId, 200, 1)) ||
          !(source.day === undefined || day(source.day))
        )
          return fail("A planned explanation has invalid evidence fields.");
        return {
          type: source.type,
          label: source.label,
          ...(source.recordId !== undefined
            ? { recordId: source.recordId }
            : {}),
          ...(source.day !== undefined ? { day: source.day } : {}),
        } as PlanEvidence;
      });
      let completion: PlanCompletion | undefined;
      if (
        item.status === "completed" ||
        (item.status === "stale" && item.completion !== undefined)
      ) {
        const done = item.completion;
        if (
          !obj(done) ||
          !["attempt", "reflection", "revision"].includes(
            done.type as string,
          ) ||
          !text(done.recordId, 200, 1) ||
          !stamp(done.completedAt)
        )
          return fail(
            "Plan completion must reference an actual saved activity record.",
          );
        const record =
          done.type === "attempt"
            ? attempts.get(done.recordId)
            : done.type === "revision"
              ? revisions.get(done.recordId)
              : imported.get(done.recordId);
        const problem = record && problems.get(record.problemId);
        const recordTime =
          done.type === "reflection"
            ? reflections.get(done.recordId)?.savedAt
            : record && "completedAt" in record
              ? record.completedAt
              : undefined;
        const recordHandle =
          done.type === "attempt"
            ? (linked.get(done.recordId)?.handle ?? problem?.cfHandle)
            : record && "handle" in record
              ? record.handle
              : undefined;
        // A deliberate later link may move an originally personal timed event
        // to another profile. The original plan snapshot remains verifiable,
        // and reconciliation moves it out of that profile’s completed summary.
        const laterReattribution =
          done.type === "attempt" &&
          !problem?.cfHandle &&
          linked.has(done.recordId) &&
          Date.parse(linked.get(done.recordId)!.linkedAt) >
            Date.parse(done.completedAt);
        const identity =
          problem &&
          (canonicalProblemIdentity(problem) ?? `problem:${problem.id}`);
        if (
          !record ||
          !problem ||
          identity !== item.identity ||
          !recordTime ||
          (done.type === "reflection"
            ? Date.parse(recordTime) < Date.parse(done.completedAt)
            : Date.parse(recordTime) !== Date.parse(done.completedAt)) ||
          (recordHandle &&
            recordHandle.toLowerCase() !==
              (raw.handle as string | null)?.toLowerCase() &&
            !laterReattribution) ||
          (done.type === "revision") !== (item.activity !== "coding") ||
          (new Date(
            Date.parse(done.completedAt) -
              (raw.timezoneOffset as number) * 60000,
          )
            .toISOString()
            .slice(0, 10) !== raw.day &&
            !(item.sessionId === done.recordId && done.type === "attempt")) ||
          (Date.parse(done.completedAt) < Date.parse(item.selectedAt) &&
            !(item.sessionId === done.recordId && done.type === "attempt"))
        )
          return fail(
            "Plan completion must match this activity’s saved identity, profile, and date.",
          );
        completion = {
          type: done.type as PlanCompletion["type"],
          recordId: done.recordId,
          completedAt: new Date(done.completedAt).toISOString(),
        };
      } else if (item.completion !== undefined)
        return fail(
          "Only a recorded completion or retained stale completion can have completion evidence.",
        );
      return {
        id: item.id,
        candidateKey: item.candidateKey,
        problemId: item.problemId,
        identity: item.identity,
        kind: item.kind as PlanKind,
        activity: item.activity as PlanActivity,
        timeboxMinutes: item.timeboxMinutes,
        reason: item.reason,
        evidence,
        selectedAt: new Date(item.selectedAt).toISOString(),
        status: item.status as PracticePlanItem["status"],
        ...(item.scheduleAt !== undefined
          ? { scheduleAt: item.scheduleAt }
          : {}),
        ...(item.relatedCodingAt !== undefined
          ? { relatedCodingAt: item.relatedCodingAt }
          : {}),
        ...(item.relatedRecallAt !== undefined
          ? { relatedRecallAt: item.relatedRecallAt }
          : {}),
        ...(item.trackContext !== undefined
          ? { trackContext: validateTrackContext(item.trackContext) }
          : {}),
        ...(item.sessionId !== undefined ? { sessionId: item.sessionId } : {}),
        ...(item.upsolvePriority !== undefined
          ? { upsolvePriority: item.upsolvePriority }
          : {}),
        ...(item.deliberate !== undefined
          ? { deliberate: item.deliberate }
          : {}),
        ...(item.decisionAt !== undefined
          ? { decisionAt: new Date(item.decisionAt).toISOString() }
          : {}),
        ...(item.deferredUntil !== undefined
          ? { deferredUntil: item.deferredUntil }
          : {}),
        ...(item.changeReason !== undefined
          ? { changeReason: item.changeReason }
          : {}),
        ...(completion ? { completion } : {}),
      } as PracticePlanItem;
    });
    return {
      id: raw.id,
      day: raw.day,
      handle: raw.handle,
      timezoneOffset: raw.timezoneOffset,
      createdAt: new Date(raw.createdAt).toISOString(),
      updatedAt: new Date(raw.updatedAt).toISOString(),
      budgetMinutes: raw.budgetMinutes,
      availabilityOverride: raw.availabilityOverride,
      status: raw.status,
      items,
      nextSequence: raw.nextSequence,
      messages: [...raw.messages],
    } as PracticePlan;
  });
}
