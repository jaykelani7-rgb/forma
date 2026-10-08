import type { Problem } from "./model";
import { validateTrackContext, type TrackContext } from "./tracks-types";

export const MISTAKES = {
  statement: "Misunderstood statement",
  approach: "Wrong approach",
  invariant: "Incorrect invariant",
  edges: "Missed edge case",
  indexing: "Off-by-one or indexing",
  numeric: "Overflow or numeric type",
  complexity: "Complexity or time limit",
  implementation: "Implementation bug",
  other: "Other",
} as const;
export type MistakeCategory = keyof typeof MISTAKES;
export interface ReflectionMemory {
  mistakes?: MistakeCategory[];
  mistakeNote?: string;
  approach?: string;
}
export type MemoryFields = ReflectionMemory;
export const REVISION_ACTIVITIES = {
  explain: "Explain the approach or invariant",
  complexity: "Recall complexity and important edge cases",
} as const;
export const RECALL_OUTCOMES = {
  independent: "Recalled independently",
  cue: "Needed a cue",
  unrecalled: "Could not recall yet",
} as const;
export const DEFAULT_RECALL_DAYS = { independent: 7, cue: 3, unrecalled: 1 };
export type RecallDays = typeof DEFAULT_RECALL_DAYS;
export interface RevisionRecord {
  id: string;
  problemId: string;
  /** Null is personal notebook evidence; a handle keeps profile evidence scoped. */
  handle: string | null;
  activity: keyof typeof REVISION_ACTIVITIES;
  outcome: keyof typeof RECALL_OUTCOMES;
  response: string;
  cue: string;
  completedAt: string;
  nextReviewAt: string | null;
  trackContext?: TrackContext;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
const fail = (message: string): never => {
  throw new Error(message);
};

export function validateReflectionMemory(value: unknown): ReflectionMemory {
  if (!object(value)) return fail("The reflection memory fields are invalid.");
  if (
    !(
      value.mistakes === undefined ||
      (Array.isArray(value.mistakes) &&
        value.mistakes.length <= 9 &&
        new Set(value.mistakes).size === value.mistakes.length &&
        value.mistakes.every(
          (category) =>
            typeof category === "string" && Object.hasOwn(MISTAKES, category),
        ))
    ) ||
    !(value.mistakeNote === undefined || text(value.mistakeNote, 2000)) ||
    !(value.approach === undefined || text(value.approach, 2000))
  )
    return fail(
      "Reflection memory needs recognised, unique mistake labels and explanations no longer than 2,000 characters.",
    );
  return {
    ...(value.mistakes !== undefined
      ? { mistakes: [...value.mistakes] as MistakeCategory[] }
      : {}),
    ...(value.mistakeNote !== undefined
      ? { mistakeNote: value.mistakeNote as string }
      : {}),
    ...(value.approach !== undefined
      ? { approach: value.approach as string }
      : {}),
  };
}

export function validateRecallDays(value: unknown): RecallDays {
  if (value === undefined) return { ...DEFAULT_RECALL_DAYS };
  if (
    !object(value) ||
    !Object.keys(DEFAULT_RECALL_DAYS).every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isInteger(value[key]) &&
        value[key] >= 1 &&
        value[key] <= 90,
    )
  )
    return fail("Recall defaults must be whole numbers from 1 to 90 days.");
  return {
    independent: value.independent as number,
    cue: value.cue as number,
    unrecalled: value.unrecalled as number,
  };
}

export function validateRevisions(
  value: unknown,
  problems: Problem[],
  handles: string[],
): RevisionRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50000)
    return fail("Revision records are invalid or exceed the supported limit.");
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
  const profiles = new Set(handles.map((handle) => handle.toLowerCase()));
  const ids = new Set<string>();
  return value.map((revision) => {
    if (
      !object(revision) ||
      !text(revision.id, 100, 1) ||
      ids.has(revision.id) ||
      !text(revision.problemId, 200, 1) ||
      !problemMap.has(revision.problemId) ||
      !(
        revision.handle === null ||
        (text(revision.handle, 24, 3) &&
          profiles.has(revision.handle.toLowerCase()))
      ) ||
      typeof revision.activity !== "string" ||
      !Object.hasOwn(REVISION_ACTIVITIES, revision.activity) ||
      typeof revision.outcome !== "string" ||
      !Object.hasOwn(RECALL_OUTCOMES, revision.outcome) ||
      !text(revision.response, 10000) ||
      !text(revision.cue, 2000) ||
      !text(revision.completedAt, 40) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(revision.completedAt) ||
      !Number.isFinite(Date.parse(revision.completedAt)) ||
      !(
        revision.nextReviewAt === null ||
        (text(revision.nextReviewAt, 10, 10) &&
          /^\d{4}-\d{2}-\d{2}$/.test(revision.nextReviewAt) &&
          Number.isFinite(Date.parse(`${revision.nextReviewAt}T12:00:00Z`)) &&
          new Date(`${revision.nextReviewAt}T12:00:00Z`)
            .toISOString()
            .slice(0, 10) === revision.nextReviewAt)
      )
    )
      return fail(
        "A revision has invalid fields, duplicate IDs, or missing problem/profile provenance.",
      );
    const problem = problemMap.get(revision.problemId)!;
    if (
      problem.cfHandle &&
      problem.cfHandle.toLowerCase() !== revision.handle?.toLowerCase()
    )
      return fail(
        "A revision cannot be attributed to a different Codeforces profile.",
      );
    ids.add(revision.id);
    return {
      id: revision.id,
      problemId: revision.problemId,
      handle: revision.handle as string | null,
      activity: revision.activity as RevisionRecord["activity"],
      outcome: revision.outcome as RevisionRecord["outcome"],
      response: revision.response,
      cue: revision.cue,
      completedAt: new Date(revision.completedAt).toISOString(),
      nextReviewAt: revision.nextReviewAt as string | null,
      ...(revision.trackContext !== undefined
        ? { trackContext: validateTrackContext(revision.trackContext) }
        : {}),
    };
  });
}
