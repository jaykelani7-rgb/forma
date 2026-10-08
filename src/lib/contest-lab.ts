import {
  DIFFICULTIES,
  OUTCOMES,
  localDate,
  type Data,
  type Problem,
  type Outcome,
  type Difficulty,
} from "./model";
import {
  validateReflectionMemory,
  type ReflectionMemory,
} from "./memory-types";
import {
  practiceIdentity,
  resolvedPracticeProblems,
  sharedPracticeState,
} from "./practice-state";
import {
  normalizeCodeforcesIdentity,
  canonicalProblemIdentity,
} from "./codeforces-identity";
import { learningHistory } from "./learning";
import type { CatalogueProblem } from "./discovery";
import { validHandle } from "./codeforces-types";

export interface ContestReflection extends ReflectionMemory {
  outcome: Outcome;
  difficulty: Difficulty | null;
  takeaway: string;
  savedAt: string;
}
export interface ContestProblem {
  id: string;
  problemId: string;
  identity: string;
  snapshot: Pick<
    Problem,
    "title" | "platform" | "url" | "problemCode" | "rating" | "tags"
  >;
  hints?: { pattern: string; notes: string };
  status: "not-started" | "working" | "marked-solved";
  notes: string;
  reflection?: ContestReflection;
  reflectionDraft?: ContestReflection;
  evidence: { id: number; submittedAt: string; verdict: string | null }[];
  evidenceChanges: {
    id: string;
    at: string;
    submissionId: number;
    before: string | null;
    after: string | null;
  }[];
  upsolve?: {
    addedAt: string;
    priority: "normal" | "high";
    dueAt: string | null;
    state: "queued" | "removed";
    removedAt?: string;
    sessionId?: string;
    completionId?: string;
  };
}
export interface PracticeContest {
  id: string;
  name: string;
  createdAt: string;
  handle: string | null;
  durationMinutes: number;
  revealHints: boolean;
  source: "manual" | "catalogue";
  state: "draft" | "active" | "finished" | "abandoned";
  startedAt: string | null;
  deadline: string | null;
  endedAt: string | null;
  endReason: "early" | "expired" | "abandoned" | null;
  problems: ContestProblem[];
  review: { wentWell: string; lostTime: string; nextChange: string };
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const stamp = (v: unknown): v is string =>
  text(v, 40, 10) &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string =>
  text(v, 10, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
function fail(): never {
  throw new Error(
    "Contest Lab has invalid fields, timing, evidence, or problem relationships.",
  );
}
export function validateContests(
  value: unknown,
  data: Pick<Data, "problems" | "attempts" | "session" | "codeforces">,
): PracticeContest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5000) return fail();
  const ids = new Set<string>();
  let active = 0;
  return value.map((raw) => {
    if (
      !object(raw) ||
      !text(raw.id, 160, 1) ||
      ids.has(raw.id) ||
      !/^[A-Za-z0-9:_-]+$/.test(raw.id) ||
      !text(raw.name, 160, 1) ||
      !stamp(raw.createdAt) ||
      !(
        raw.handle === null ||
        (text(raw.handle, 24) && validHandle(raw.handle))
      ) ||
      !integer(raw.durationMinutes, 5, 360) ||
      typeof raw.revealHints !== "boolean" ||
      !["manual", "catalogue"].includes(String(raw.source)) ||
      !["draft", "active", "finished", "abandoned"].includes(
        String(raw.state),
      ) ||
      !Array.isArray(raw.problems) ||
      raw.problems.length < 1 ||
      raw.problems.length > 20 ||
      !object(raw.review) ||
      !["wentWell", "lostTime", "nextChange"].every((k) =>
        text((raw.review as Record<string, unknown>)[k], 2000),
      )
    )
      return fail();
    ids.add(raw.id);
    if (raw.state === "draft") {
      if (
        raw.startedAt !== null ||
        raw.deadline !== null ||
        raw.endedAt !== null ||
        raw.endReason !== null
      )
        return fail();
    } else {
      if (
        !stamp(raw.startedAt) ||
        !stamp(raw.deadline) ||
        Date.parse(raw.deadline) !==
          Date.parse(raw.startedAt) + raw.durationMinutes * 60000
      )
        return fail();
      if (raw.state === "active") {
        if (
          ++active > 1 ||
          data.session ||
          raw.endedAt !== null ||
          raw.endReason !== null
        )
          return fail();
      } else if (
        !stamp(raw.endedAt) ||
        Date.parse(raw.endedAt) < Date.parse(raw.startedAt) ||
        Date.parse(raw.endedAt) > Date.parse(raw.deadline) ||
        !["early", "expired", "abandoned"].includes(String(raw.endReason)) ||
        (raw.state === "abandoned") !== (raw.endReason === "abandoned") ||
        (raw.endReason === "expired" && raw.endedAt !== raw.deadline)
      )
        return fail();
    }
    const identities = new Set<string>(),
      rows = new Set<string>();
    const problems = raw.problems.map((p) => {
      if (
        !object(p) ||
        !text(p.id, 160, 1) ||
        rows.has(p.id) ||
        !text(p.problemId, 160, 1) ||
        !text(p.identity, 200, 1) ||
        identities.has(p.identity) ||
        !object(p.snapshot) ||
        !text(p.snapshot.title, 240, 1) ||
        !text(p.snapshot.platform, 80, 1) ||
        !text(p.snapshot.url, 2000) ||
        !text(p.snapshot.problemCode, 60) ||
        !(p.snapshot.rating === null || integer(p.snapshot.rating, 0, 10000)) ||
        !Array.isArray(p.snapshot.tags) ||
        p.snapshot.tags.length > 20 ||
        !p.snapshot.tags.every((t) => text(t, 60)) ||
        !["not-started", "working", "marked-solved"].includes(
          String(p.status),
        ) ||
        !text(p.notes, 10000) ||
        !Array.isArray(p.evidence) ||
        p.evidence.length > 5000 ||
        !Array.isArray(p.evidenceChanges) ||
        p.evidenceChanges.length > 10000
      )
        return fail();
      if (
        p.hints !== undefined &&
        (!object(p.hints) ||
          !text(p.hints.pattern, 2000) ||
          !text(p.hints.notes, 14000))
      )
        return fail();
      const saved = data.problems.find((v) => v.id === p.problemId);
      if (
        !saved ||
        practiceIdentity(saved) !== p.identity ||
        (canonicalProblemIdentity(p.snapshot as unknown as Problem) ??
          `problem:${p.problemId}`) !== p.identity
      )
        return fail();
      if (p.snapshot.url) {
        try {
          if (!["https:", "http:"].includes(new URL(p.snapshot.url).protocol))
            return fail();
        } catch {
          return fail();
        }
      }
      rows.add(p.id);
      identities.add(p.identity);
      const submissionIds = new Set<number>();
      for (const e of p.evidence) {
        if (
          !object(e) ||
          !integer(e.id, 1, Number.MAX_SAFE_INTEGER) ||
          submissionIds.has(e.id) ||
          !stamp(e.submittedAt) ||
          !(e.verdict === null || text(e.verdict, 100)) ||
          !stamp(raw.startedAt) ||
          !stamp(raw.deadline) ||
          Date.parse(e.submittedAt) < Date.parse(raw.startedAt) ||
          Date.parse(e.submittedAt) >
            Date.parse((raw.endedAt ?? raw.deadline) as string)
        )
          return fail();
        const submission = data.codeforces.submissions.find(
          (s) =>
            s.id === e.id &&
            s.handle.toLowerCase() === String(raw.handle).toLowerCase(),
        );
        const problem =
          submission &&
          data.problems.find((v) => v.id === submission.problemId);
        if (
          !submission ||
          !problem ||
          practiceIdentity(problem) !== p.identity ||
          submission.submittedAt !== e.submittedAt ||
          submission.verdict !== e.verdict
        )
          return fail();
        submissionIds.add(e.id);
      }
      const changes = new Set<string>();
      for (const e of p.evidenceChanges) {
        if (
          !object(e) ||
          !text(e.id, 200, 1) ||
          changes.has(e.id) ||
          !stamp(e.at) ||
          !integer(e.submissionId, 1, Number.MAX_SAFE_INTEGER) ||
          !data.codeforces.submissions.some(
            (s) =>
              s.id === e.submissionId &&
              s.handle.toLowerCase() === String(raw.handle).toLowerCase() &&
              Date.parse(s.submittedAt) >=
                Date.parse(raw.startedAt as string) &&
              Date.parse(s.submittedAt) <= Date.parse(raw.deadline as string) &&
              data.problems.some(
                (v) =>
                  v.id === s.problemId && practiceIdentity(v) === p.identity,
              ),
          ) ||
          !(e.before === null || text(e.before, 100)) ||
          !(e.after === null || text(e.after, 100))
        )
          return fail();
        changes.add(e.id);
      }
      for (const reflectionField of ["reflection", "reflectionDraft"]) {
        const reflectionValue = p[reflectionField];
        if (reflectionValue !== undefined) {
          if (
            !object(reflectionValue) ||
            !Object.hasOwn(OUTCOMES, String(reflectionValue.outcome)) ||
            !(
              reflectionValue.difficulty === null ||
              Object.hasOwn(DIFFICULTIES, String(reflectionValue.difficulty))
            ) ||
            !text(reflectionValue.takeaway, 2000) ||
            !stamp(reflectionValue.savedAt) ||
            !stamp(raw.endedAt) ||
            Date.parse(reflectionValue.savedAt) < Date.parse(raw.endedAt)
          )
            return fail();
          validateReflectionMemory(reflectionValue);
        }
      }
      if (p.upsolve !== undefined) {
        const u = p.upsolve;
        if (
          !object(u) ||
          !stamp(u.addedAt) ||
          !stamp(raw.endedAt) ||
          Date.parse(u.addedAt) < Date.parse(raw.endedAt) ||
          !["normal", "high"].includes(String(u.priority)) ||
          !(u.dueAt === null || day(u.dueAt)) ||
          !["queued", "removed"].includes(String(u.state)) ||
          !(u.removedAt === undefined || stamp(u.removedAt)) ||
          (u.state === "removed" && u.removedAt === undefined) ||
          !(u.sessionId === undefined || text(u.sessionId, 160, 1)) ||
          !(u.completionId === undefined || text(u.completionId, 160, 1))
        )
          return fail();
        if (u.completionId) {
          const a = data.attempts.find((v) => v.id === u.completionId),
            problem = a && data.problems.find((v) => v.id === a.problemId);
          if (
            !a ||
            !problem ||
            a.id !== u.sessionId ||
            a.outcome === "unsolved" ||
            practiceIdentity(problem) !== p.identity ||
            Date.parse(a.startedAt) < Date.parse(u.addedAt)
          )
            return fail();
        }
      }
      return {
        id: p.id,
        problemId: p.problemId,
        identity: p.identity,
        snapshot: {
          title: p.snapshot.title,
          platform: p.snapshot.platform,
          url: p.snapshot.url,
          problemCode: p.snapshot.problemCode,
          rating: p.snapshot.rating,
          tags: [...p.snapshot.tags],
        },
        ...(p.hints
          ? {
              hints: {
                pattern: (p.hints as Record<string, unknown>).pattern,
                notes: (p.hints as Record<string, unknown>).notes,
              },
            }
          : {}),
        status: p.status,
        notes: p.notes,
        evidence: p.evidence.map((e) => {
          const v = e as Record<string, unknown>;
          return { id: v.id, submittedAt: v.submittedAt, verdict: v.verdict };
        }),
        evidenceChanges: p.evidenceChanges.map((e) => {
          const v = e as Record<string, unknown>;
          return {
            id: v.id,
            at: v.at,
            submissionId: v.submissionId,
            before: v.before,
            after: v.after,
          };
        }),
        ...(p.reflection
          ? {
              reflection: {
                outcome: (p.reflection as Record<string, unknown>).outcome,
                difficulty: (p.reflection as Record<string, unknown>)
                  .difficulty,
                takeaway: (p.reflection as Record<string, unknown>).takeaway,
                savedAt: (p.reflection as Record<string, unknown>).savedAt,
                ...validateReflectionMemory(p.reflection),
              },
            }
          : {}),
        ...(p.reflectionDraft
          ? {
              reflectionDraft: {
                outcome: (p.reflectionDraft as Record<string, unknown>).outcome,
                difficulty: (p.reflectionDraft as Record<string, unknown>)
                  .difficulty,
                takeaway: (p.reflectionDraft as Record<string, unknown>)
                  .takeaway,
                savedAt: (p.reflectionDraft as Record<string, unknown>).savedAt,
                ...validateReflectionMemory(p.reflectionDraft),
              },
            }
          : {}),
        ...(p.upsolve
          ? {
              upsolve: Object.fromEntries(
                Object.entries(p.upsolve).filter(([key]) =>
                  [
                    "addedAt",
                    "priority",
                    "dueAt",
                    "state",
                    "removedAt",
                    "sessionId",
                    "completionId",
                  ].includes(key),
                ),
              ),
            }
          : {}),
      } as unknown as ContestProblem;
    });
    return {
      id: raw.id,
      name: raw.name,
      createdAt: raw.createdAt,
      handle: raw.handle,
      durationMinutes: raw.durationMinutes,
      revealHints: raw.revealHints,
      source: raw.source,
      state: raw.state,
      startedAt: raw.startedAt,
      deadline: raw.deadline,
      endedAt: raw.endedAt,
      endReason: raw.endReason,
      problems,
      review: {
        wentWell: raw.review.wentWell,
        lostTime: raw.review.lostTime,
        nextChange: raw.review.nextChange,
      },
    } as PracticeContest;
  });
}
export function activeContest(data: Data) {
  return data.contests?.find((c) => c.state === "active");
}
export function contestScope(data: Data, c: PracticeContest) {
  return (
    c.handle?.toLowerCase() === data.codeforces.connectedHandle?.toLowerCase()
  );
}
interface TimedContestEvidence {
  submittedMs: number;
  evidence: ContestProblem["evidence"][number];
}
// Workspace proposals are immutable. Cache one index for each snapshot so
// historical contests do not repeatedly scan every imported submission while
// notes, statuses, or reviews are being saved.
const contestSubmissionIndexes = new WeakMap<
  Data,
  Map<string, Map<string, TimedContestEvidence[]>>
>();
function contestSubmissionIndex(data: Data) {
  const cached = contestSubmissionIndexes.get(data);
  if (cached) return cached;
  const identities = new Map(
    data.problems.map((p) => [p.id, practiceIdentity(p)]),
  );
  const index = new Map<string, Map<string, TimedContestEvidence[]>>();
  for (const s of data.codeforces.submissions) {
    const identity = identities.get(s.problemId);
    if (!identity) continue;
    const handle = s.handle.toLowerCase();
    let problems = index.get(handle);
    if (!problems) {
      problems = new Map();
      index.set(handle, problems);
    }
    let submissions = problems.get(identity);
    if (!submissions) {
      submissions = [];
      problems.set(identity, submissions);
    }
    const submittedAt = s.submittedAt;
    submissions.push({
      submittedMs: Date.parse(submittedAt),
      evidence: { id: s.id, submittedAt, verdict: s.verdict },
    });
  }
  for (const problems of index.values())
    for (const submissions of problems.values())
      submissions.sort(
        (a, b) =>
          a.submittedMs - b.submittedMs || a.evidence.id - b.evidence.id,
      );
  contestSubmissionIndexes.set(data, index);
  return index;
}
function evidenceWindowBound(
  submissions: TimedContestEvidence[],
  timestamp: number,
  inclusiveEnd = false,
) {
  let low = 0,
    high = submissions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      submittedMs = submissions[middle].submittedMs;
    if (submittedMs < timestamp || (inclusiveEnd && submittedMs === timestamp))
      low = middle + 1;
    else high = middle;
  }
  return low;
}
export function contestEvidence(
  data: Data,
  c: PracticeContest,
  p: ContestProblem,
) {
  if (!c.startedAt || !c.deadline || !c.handle) return [];
  const from = Date.parse(c.startedAt),
    to = Date.parse(c.endedAt ?? c.deadline);
  const submissions = contestSubmissionIndex(data)
    .get(c.handle.toLowerCase())
    ?.get(p.identity);
  if (!submissions) return [];
  return submissions
    .slice(
      evidenceWindowBound(submissions, from),
      evidenceWindowBound(submissions, to, true),
    )
    .sort((a, b) => a.evidence.id - b.evidence.id)
    .map(({ evidence }) => ({ ...evidence }));
}
export function reconcileContests(data: Data, now = new Date()): Data {
  let changed = false;
  const contests = (data.contests ?? []).map((original) => {
    let c = original;
    if (c.state === "active" && Date.parse(c.deadline!) <= now.getTime()) {
      c = {
        ...c,
        state: "finished",
        endedAt: c.deadline,
        endReason: "expired",
      };
      changed = true;
    }
    if (c.state === "draft") return c;
    const problems = c.problems.map((p) => {
      const evidence = contestEvidence(data, c, p);
      let next = p;
      if (JSON.stringify(evidence) !== JSON.stringify(p.evidence)) {
        const changes = evidence
          .filter(
            (e) => p.evidence.find((v) => v.id === e.id)?.verdict !== e.verdict,
          )
          .map((e, index) => ({
            id: `${e.id}:${p.evidenceChanges.length + index}`,
            at: now.toISOString(),
            submissionId: e.id,
            before: p.evidence.find((v) => v.id === e.id)?.verdict ?? null,
            after: e.verdict,
          }));
        next = {
          ...next,
          evidence,
          evidenceChanges: [...p.evidenceChanges, ...changes],
        };
        changed = true;
      }
      if (next.upsolve?.sessionId && !next.upsolve.completionId) {
        const a = data.attempts.find((a) => a.id === next.upsolve!.sessionId);
        if (
          a &&
          a.outcome !== "unsolved" &&
          Date.parse(a.startedAt) >= Date.parse(next.upsolve.addedAt) &&
          data.problems.some(
            (v) => v.id === a.problemId && practiceIdentity(v) === p.identity,
          )
        ) {
          next = { ...next, upsolve: { ...next.upsolve, completionId: a.id } };
          changed = true;
        }
      }
      return next;
    });
    return problems.some((p, i) => p !== c.problems[i])
      ? { ...c, problems }
      : c;
  });
  return changed ? { ...data, contests } : data;
}
export function contestLockedSetup(c: PracticeContest) {
  return {
    handle: c.handle,
    durationMinutes: c.durationMinutes,
    revealHints: c.revealHints,
    source: c.source,
    problems: c.problems.map((p) => ({
      id: p.id,
      problemId: p.problemId,
      identity: p.identity,
      snapshot: p.snapshot,
      hints: p.hints,
    })),
  };
}
export function editContest(
  data: Data,
  id: string,
  fn: (c: PracticeContest) => PracticeContest,
): Data {
  if (!data.contests?.some((c) => c.id === id))
    throw new Error("This contest is no longer in this workspace.");
  return {
    ...data,
    contests: data.contests.map((c) => {
      if (c.id !== id) return c;
      const next = fn(c);
      if (
        c.state !== "draft" &&
        JSON.stringify(contestLockedSetup(c)) !==
          JSON.stringify(contestLockedSetup(next))
      )
        throw new Error(
          "The contest’s problem set, hints, profile, and duration are locked after starting.",
        );
      return next;
    }),
  };
}
export function startContest(data: Data, id: string, now = new Date()): Data {
  if (data.session || activeContest(data))
    throw new Error(
      "Finish or abandon your open practice session or contest first.",
    );
  return editContest(data, id, (c) => {
    if (c.state !== "draft")
      throw new Error("This contest has already started.");
    if (!contestScope(data, c))
      throw new Error(
        "Switch back to the profile used to create this set before starting.",
      );
    return {
      ...c,
      state: "active",
      startedAt: now.toISOString(),
      deadline: new Date(
        now.getTime() + c.durationMinutes * 60000,
      ).toISOString(),
    };
  });
}
export function endContest(
  data: Data,
  id: string,
  reason: "early" | "abandoned",
  now = new Date(),
): Data {
  const current = reconcileContests(data, now);
  return editContest(current, id, (c) =>
    c.state !== "active"
      ? c
      : {
          ...c,
          state: reason === "abandoned" ? "abandoned" : "finished",
          endedAt: new Date(
            Math.max(
              Date.parse(c.startedAt!),
              Math.min(now.getTime(), Date.parse(c.deadline!)),
            ),
          ).toISOString(),
          endReason: reason,
        },
  );
}
export function contestHints(data: Data, problem: Problem) {
  const identity = practiceIdentity(problem);
  const entry = data.trackEntries?.find(
    (e) =>
      normalizeCodeforcesIdentity({ url: e.url, code: e.code })?.key ===
      identity,
  );
  const record = learningHistory(data)
    .filter((r) =>
      data.problems.some(
        (p) => p.id === r.problemId && practiceIdentity(p) === identity,
      ),
    )
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  return {
    pattern: entry?.pattern ?? "",
    notes: record
      ? [record.approach, record.notes, record.takeaway]
          .filter(Boolean)
          .join("\n")
          .slice(0, 14000)
      : "",
  };
}
export function reviseContestSetup(
  data: Data,
  id: string,
  name: string,
  duration: number,
  selected: Problem[],
  reveal: boolean,
  source: PracticeContest["source"],
  now = new Date(),
) {
  const previous = data.contests?.find((c) => c.id === id);
  if (!previous || previous.state !== "draft" || !contestScope(data, previous))
    throw new Error(
      "Only an unstarted contest in its original profile can be edited.",
    );
  const next = createContest(
    { ...data, contests: data.contests!.filter((c) => c.id !== id) },
    id,
    name,
    duration,
    selected,
    reveal,
    source,
    now,
  );
  return editContest(next, id, (c) => ({
    ...c,
    createdAt: previous.createdAt,
  }));
}
export function createContest(
  data: Data,
  id: string,
  name: string,
  durationMinutes: number,
  selected: Problem[],
  revealHints: boolean,
  source: PracticeContest["source"],
  now = new Date(),
): Data {
  if (data.contests?.some((c) => c.id === id)) return data;
  if (
    !name.trim() ||
    selected.length < 1 ||
    selected.length > 20 ||
    new Set(selected.map(practiceIdentity)).size !== selected.length ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    durationMinutes > 360
  )
    throw new Error("Choose a name, 1–20 unique problems, and 5–360 minutes.");
  const c: PracticeContest = {
    id,
    name: name.trim(),
    createdAt: now.toISOString(),
    handle: data.codeforces.connectedHandle,
    durationMinutes,
    revealHints,
    source,
    state: "draft",
    startedAt: null,
    deadline: null,
    endedAt: null,
    endReason: null,
    review: { wentWell: "", lostTime: "", nextChange: "" },
    problems: selected.map((p, i) => ({
      id: `${id}:${i}`,
      problemId: p.id,
      identity: practiceIdentity(p),
      snapshot: {
        title: p.title,
        platform: p.platform,
        url: p.url,
        problemCode: p.problemCode,
        rating: p.rating,
        tags: [...p.tags],
      },
      hints: contestHints(data, p),
      status: "not-started",
      notes: "",
      evidence: [],
      evidenceChanges: [],
    })),
  };
  return {
    ...data,
    problems: [
      ...data.problems,
      ...selected.filter((p) => !data.problems.some((v) => v.id === p.id)),
    ],
    contests: [...(data.contests ?? []), c],
  };
}
export function generateContestProblems(
  data: Data,
  catalogue: CatalogueProblem[],
  count: number,
  min: number | null,
  max: number | null,
  excludeAccepted: boolean,
  excludePracticed: boolean,
): CatalogueProblem[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 20 ||
    (min !== null && (!Number.isInteger(min) || min < 0 || min > 10000)) ||
    (max !== null && (!Number.isInteger(max) || max < 0 || max > 10000)) ||
    (min !== null && max !== null && min > max)
  )
    throw new Error("Choose 1–20 problems and a valid rating range.");
  const handle = data.codeforces.connectedHandle?.toLowerCase();
  const accepted = new Set(
    data.codeforces.submissions
      .filter((s) => s.handle.toLowerCase() === handle && s.verdict === "OK")
      .flatMap((s) => {
        const p = data.problems.find((p) => p.id === s.problemId);
        return p ? [practiceIdentity(p)] : [];
      }),
  );
  const practiced = new Set(
    learningHistory(data).flatMap((r) => {
      const p = data.problems.find((p) => p.id === r.problemId);
      return p ? [practiceIdentity(p)] : [];
    }),
  );
  for (const c of data.contests ?? [])
    if (contestScope(data, c) && c.state !== "draft")
      for (const p of c.problems)
        if (p.status !== "not-started" || p.evidence.length)
          practiced.add(p.identity);
  const unique = new Map<string, CatalogueProblem>();
  for (const p of catalogue) {
    const identity = canonicalProblemIdentity({
      url: p.url,
      problemCode: p.code,
      platform: "Codeforces",
    } as Problem);
    if (
      identity &&
      !unique.has(identity) &&
      !(excludeAccepted && accepted.has(identity)) &&
      !(excludePracticed && practiced.has(identity)) &&
      (min === null || (p.rating !== null && p.rating >= min)) &&
      (max === null || (p.rating !== null && p.rating <= max))
    )
      unique.set(identity, p);
  }
  const sorted = [...unique.values()].sort(
    (a, b) =>
      (a.rating ?? 10001) - (b.rating ?? 10001) || a.key.localeCompare(b.key),
  );
  if (sorted.length < count)
    throw new Error(
      `Only ${sorted.length} matching problems are available. Lower the count, widen the rating range, or explicitly change exclusions.`,
    );
  return sorted.slice(0, count);
}
export function queueUpsolve(
  data: Data,
  contestId: string,
  rowId: string,
  priority: "normal" | "high",
  dueAt: string | null,
  now = new Date(),
): Data {
  return editContest(data, contestId, (c) => {
    if (!c.endedAt)
      throw new Error("Finish the contest before adding upsolves.");
    if (!contestScope(data, c))
      throw new Error(
        "Switch back to this contest’s profile to schedule an upsolve.",
      );
    return {
      ...c,
      problems: c.problems.map((p) => {
        if (p.id !== rowId) return p;
        if (
          p.reflection?.outcome === "independent" ||
          (!p.reflection && p.evidence.some((e) => e.verdict === "OK"))
        )
          throw new Error("Upsolves are for unfinished or assisted problems.");
        return {
          ...p,
          upsolve:
            p.upsolve?.state === "queued"
              ? { ...p.upsolve, priority, dueAt }
              : {
                  addedAt: now.toISOString(),
                  priority,
                  dueAt,
                  state: "queued",
                },
        };
      }),
    };
  });
}
export function futureUpsolveIdentities(data: Data, now = new Date()) {
  const today = localDate(now);
  return new Set(
    (data.contests ?? [])
      .filter((c) => contestScope(data, c))
      .flatMap((c) =>
        c.problems
          .filter(
            (p) =>
              p.upsolve?.state === "queued" &&
              !p.upsolve.completionId &&
              !!p.upsolve.dueAt &&
              p.upsolve.dueAt > today,
          )
          .map((p) => p.identity),
      ),
  );
}
export function eligibleUpsolves(data: Data, now = new Date()) {
  const today = localDate(now),
    future = futureUpsolveIdentities(data, now),
    allowed = resolvedPracticeProblems(data, now);
  return (data.contests ?? [])
    .filter((c) => contestScope(data, c))
    .flatMap((c) =>
      c.problems.flatMap((p) => {
        const u = p.upsolve,
          problem = allowed.find((v) => practiceIdentity(v) === p.identity);
        if (
          !u ||
          u.state !== "queued" ||
          u.completionId ||
          !problem ||
          future.has(p.identity) ||
          (u.dueAt && u.dueAt > today)
        )
          return [];
        const state = sharedPracticeState(data, problem, now);
        if (
          state.archived ||
          state.skipped ||
          (state.deferredUntil && state.deferredUntil > today) ||
          (state.codingAt && state.codingAt > today)
        )
          return [];
        return [{ contest: c, row: p, problem }];
      }),
    )
    .sort(
      (a, b) =>
        Number(b.row.upsolve!.priority === "high") -
          Number(a.row.upsolve!.priority === "high") ||
        (a.row.upsolve!.dueAt ?? "").localeCompare(
          b.row.upsolve!.dueAt ?? "",
        ) ||
        a.row.id.localeCompare(b.row.id),
    );
}
