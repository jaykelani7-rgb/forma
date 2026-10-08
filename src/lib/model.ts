import { validateContests, type PracticeContest } from "./contest-lab";
import {
  CodeforcesData,
  DEFAULT_REVIEW_DAYS,
  ReviewDays,
  emptyCodeforces,
  validateCodeforces,
} from "./codeforces-types";
import {
  LearningLink,
  learningBreakthroughs,
  learningByProblem,
  latestLearningReflection,
  validateLearningLinks,
} from "./learning";
import {
  DiscoveryPreferences,
  defaultDiscovery,
  validateDiscovery,
} from "./discovery";
import {
  ReminderPreferences,
  defaultReminder,
  validateReminder,
} from "./reminders";
import {
  Track,
  TrackStage,
  TrackEntry,
  TrackContext,
  validateTrackContext,
  validateTracks,
} from "./tracks-types";
import {
  type ReflectionMemory,
  type RevisionRecord,
  type RecallDays,
  DEFAULT_RECALL_DAYS,
  validateReflectionMemory,
  validateRevisions,
  validateRecallDays,
} from "./memory-types";
import {
  validatePracticePlans,
  validatePracticePreferences,
  type PracticePlan,
  type PracticePreferences,
} from "./practice-plan-types";
import {
  resolvedCodingQueue,
  resolvedPracticeProblems,
  sharedPracticeState,
} from "./practice-state";
// Rename the product here; navigation, exports, and metadata use this value.
export const BRAND = "Forma";
export const OUTCOMES = {
  independent: "Solved independently",
  hint: "Needed a hint",
  editorial: "Needed the editorial",
  unsolved: "Not solved yet",
} as const;
export const DIFFICULTIES = {
  approach: "Finding the approach",
  coding: "Turning the idea into code",
  edges: "Edge cases",
  complexity: "Complexity",
  debugging: "Implementation / debugging",
} as const;
export type Outcome = keyof typeof OUTCOMES;
export type Difficulty = keyof typeof DIFFICULTIES;
export type Focus = "cp" | "placement" | "mixed";
export type Theme = "light" | "dark" | "system";
export type Duration = 15 | 30 | 60;
export interface Problem {
  id: string;
  title: string;
  platform: string;
  url: string;
  problemCode: string;
  tags: string[];
  rating: number | null;
  createdAt: string;
  reviewAt: string | null;
  reviewCount: number;
  cfHandle?: string;
  cfKey?: string;
  reviewManual?: boolean;
  reviewAttemptId?: string;
  reviewCompletedAt?: string;
  reviewUpdatedAt?: string;
  revisionCue?: string;
  // Absent fields in older notebooks mean eligible for automatic practice.
  archived?: boolean;
  deferredUntil?: string | null;
  skippedOn?: string | null;
}
export interface Attempt extends ReflectionMemory {
  id: string;
  problemId: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  outcome: Outcome;
  difficulty: Difficulty | null;
  takeaway: string;
  notes: string;
  trackContext?: TrackContext;
}
export interface Session {
  id: string;
  problemId: string;
  startedAt: string;
  runningSince: number | null;
  elapsedMs: number;
  targetMinutes: number;
  notes: string;
  timerVisible: boolean;
  phase: "focus" | "reflection";
  trackContext?: TrackContext;
}
export interface Settings {
  displayName: string;
  weeklyGoal: number;
  defaultDuration: Duration;
  focus: Focus;
  reviewDays: ReviewDays;
  reminder?: ReminderPreferences;
  textSize?: "comfortable" | "large";
  recallDays?: RecallDays;
  practicePreferences?: PracticePreferences;
}
export interface Data {
  schemaVersion: 2;
  codeforces: CodeforcesData;
  problems: Problem[];
  attempts: Attempt[];
  session: Session | null;
  settings: Settings;
  learningLinks?: LearningLink[];
  discovery?: DiscoveryPreferences;
  tracks?: Track[];
  trackStages?: TrackStage[];
  trackEntries?: TrackEntry[];
  activeTrackId?: string | null;
  revisions?: RevisionRecord[];
  practicePlans?: PracticePlan[];
  contests?: PracticeContest[];
}
export const emptyData = (): Data => ({
  schemaVersion: 2,
  codeforces: emptyCodeforces(),
  problems: [],
  attempts: [],
  session: null,
  learningLinks: [],
  discovery: defaultDiscovery(),
  tracks: [],
  trackStages: [],
  trackEntries: [],
  activeTrackId: null,
  revisions: [],
  settings: {
    displayName: "",
    weeklyGoal: 4,
    defaultDuration: 30,
    focus: "mixed",
    reviewDays: { ...DEFAULT_REVIEW_DAYS },
    reminder: defaultReminder(),
    textSize: "comfortable",
    recallDays: { ...DEFAULT_RECALL_DAYS },
  },
});
export const uid = () => crypto.randomUUID();
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}
export function dateFromDay(day: string): Date {
  return new Date(`${day}T12:00:00`);
}
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date.length === 10 ? dateFromDay(date) : new Date(date));
}
export function reviewLabel(date: string, now = new Date()): string {
  const today = localDate(now);
  if (date <= today) return "Ready for another try";
  if (date === localDate(addDays(now, 1))) return "Tomorrow";
  return shortDate(date);
}
export function elapsed(session: Session, now = Date.now()): number {
  return (
    session.elapsedMs +
    (session.runningSince === null
      ? 0
      : Math.max(0, now - session.runningSince))
  );
}
export function clockTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function latestAttempt(
  data: Data,
  problemId: string,
): Attempt | undefined {
  return data.attempts
    .filter((a) => a.problemId === problemId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
}
export function visibleProblems(data: Data): Problem[] {
  return data.problems.filter(
    (p) =>
      !p.cfHandle ||
      p.cfHandle.toLowerCase() ===
        data.codeforces.connectedHandle?.toLowerCase(),
  );
}
export function latestReflection(
  data: Data,
  problemId: string,
):
  | {
      completedAt: string;
      outcome: Outcome;
      difficulty: Difficulty | null;
      takeaway: string;
    }
  | undefined {
  const reflection = latestLearningReflection(data, problemId);
  return reflection?.outcome
    ? {
        completedAt: reflection.completedAt,
        outcome: reflection.outcome,
        difficulty: reflection.difficulty,
        takeaway: reflection.takeaway,
      }
    : undefined;
}
export function reviewQueue(data: Data, now = new Date()): Problem[] {
  return resolvedCodingQueue(data, now);
}
export function automaticPracticeEligible(
  problem: Problem,
  now = new Date(),
): boolean {
  const today = localDate(now);
  return (
    !problem.archived &&
    (!problem.reviewAt || problem.reviewAt <= today) &&
    (!problem.deferredUntil || problem.deferredUntil <= today) &&
    problem.skippedOn !== today
  );
}
function changeProblem(
  data: Data,
  problemId: string,
  change: (problem: Problem) => Problem,
): Data {
  if (!data.problems.some((problem) => problem.id === problemId))
    throw new Error("This problem is no longer available.");
  return {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === problemId ? change(problem) : problem,
    ),
  };
}
export function completeRevisit(
  data: Data,
  problemId: string,
  now = new Date(),
): Data {
  return changeProblem(data, problemId, (problem) => {
    const retained = { ...problem };
    delete retained.reviewAttemptId;
    return {
      ...retained,
      reviewAt: null,
      reviewManual: true,
      reviewCompletedAt: now.toISOString(),
      reviewUpdatedAt: now.toISOString(),
    };
  });
}
export function rescheduleProblem(
  data: Data,
  problemId: string,
  day: string,
  now = new Date(),
): Data {
  if (!date(day)) throw new Error("Choose a valid revisit date.");
  return changeProblem(data, problemId, (problem) => ({
    ...problem,
    reviewAt: day,
    reviewManual: true,
    reviewUpdatedAt: now.toISOString(),
  }));
}
export function skipRecommendation(
  data: Data,
  problemId: string,
  now = new Date(),
): Data {
  return changeProblem(data, problemId, (problem) => ({
    ...problem,
    skippedOn: localDate(now),
  }));
}
export function archiveProblem(
  data: Data,
  problemId: string,
  archived = true,
): Data {
  return changeProblem(data, problemId, (problem) => ({
    ...problem,
    archived,
  }));
}
export function deferProblem(
  data: Data,
  problemId: string,
  until: string | null,
): Data {
  if (until !== null && !date(until))
    throw new Error("Choose a valid practice date.");
  return changeProblem(data, problemId, (problem) => ({
    ...problem,
    deferredUntil: until,
  }));
}
// A transparent spaced-review rule. Missed dates remain available without penalties.
export function nextReview(
  problem: Problem,
  outcome: Outcome,
  now = new Date(),
  days: ReviewDays = DEFAULT_REVIEW_DAYS,
): Pick<Problem, "reviewAt" | "reviewCount"> {
  if (outcome === "independent") {
    if (!problem.reviewAt) return { reviewAt: null, reviewCount: 0 };
    return {
      reviewAt: localDate(
        addDays(now, Math.min(30, 7 * 2 ** problem.reviewCount)),
      ),
      reviewCount: problem.reviewCount + 1,
    };
  }
  return { reviewAt: localDate(addDays(now, days[outcome])), reviewCount: 0 };
}
const CP_TAGS = [
  "greedy",
  "number theory",
  "math",
  "combinatorics",
  "constructive",
  "constructive algorithms",
  "dp",
  "dynamic programming",
  "graphs",
  "binary search",
  "bit manipulation",
];
const PLACEMENT_TAGS = [
  "arrays",
  "array",
  "strings",
  "string",
  "linked list",
  "trees",
  "tree",
  "stack",
  "queue",
  "hashing",
  "two pointers",
  "sliding window",
  "sorting",
  "matrix",
  "binary search",
  "dynamic programming",
  "dp",
  "graphs",
];
export function matchesFocus(problem: Problem, focus: Focus): boolean {
  if (focus === "mixed") return true;
  const tags = focus === "cp" ? CP_TAGS : PLACEMENT_TAGS;
  return problem.tags.some((tag) => tags.includes(tag.toLowerCase()));
}
export function suggestion(
  data: Data,
  now = new Date(),
): {
  problem: Problem;
  reason: string;
  focusFallback: boolean;
  revisit: boolean;
} | null {
  const available = resolvedPracticeProblems(data, now)
    .filter((p) => sharedPracticeState(data, p, now).eligible)
    .filter(
      (p) =>
        !p.cfHandle ||
        p.reviewAt ||
        data.attempts.some((a) => a.problemId === p.id),
    );
  if (!available.length) return null;
  const matching = available.filter((p) =>
    matchesFocus(p, data.settings.focus),
  );
  const focusFallback = matching.length === 0;
  const pool = matching.length ? matching : available;
  const learning = learningByProblem(data);
  const ready = pool
    .filter((p) => p.reviewAt && p.reviewAt <= localDate(now))
    .sort((a, b) => a.reviewAt!.localeCompare(b.reviewAt!));
  const fresh = pool.filter((p) => !learning.has(p.id));
  const problem =
    ready[0] ??
    fresh[0] ??
    [...pool].sort((a, b) =>
      (learning.get(a.id)?.history[0]?.completedAt ?? "").localeCompare(
        learning.get(b.id)?.history[0]?.completedAt ?? "",
      ),
    )[0];
  const attempt = learning.get(problem.id)?.latestReflection;
  const reasons: Record<Difficulty, string> = {
    approach:
      "Your last reflection mentioned finding the approach. Give yourself space to explore it before a hint.",
    coding:
      "Your last reflection mentioned turning the idea into code. Give the implementation a little attention.",
    edges:
      "Your last reflection mentioned edge cases. Check the boundaries deliberately this time.",
    complexity:
      "Your last reflection mentioned complexity. Revisit the trade-offs and constraints.",
    debugging:
      "Your last reflection mentioned implementation or debugging. Try checking one small step at a time.",
  };
  return {
    problem,
    focusFallback,
    revisit: learning.has(problem.id),
    reason: attempt?.difficulty
      ? reasons[attempt.difficulty]
      : attempt
        ? "A familiar problem, a fresh attempt. See what you can do without your previous notes."
        : learning.has(problem.id)
          ? "You’ve attempted this problem; its reflection is pending. Try it deliberately, or reflect on the activity first."
          : "A fresh problem from your collection. Start with the examples and follow your curiosity.",
  };
}
export function weekStart(now = new Date()): Date {
  const start = addDays(now, -((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  return start;
}
export function weekActivity(data: Data, now = new Date()) {
  const start = weekStart(now);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const day = localDate(date);
    return {
      date,
      day,
      count: data.attempts.filter(
        (a) => localDate(new Date(a.completedAt)) === day,
      ).length,
      today: day === localDate(now),
      future: day > localDate(now),
    };
  });
}
export function breakthroughs(data: Data) {
  return learningBreakthroughs(data);
}

export function createDemo(now = new Date()): Data {
  const data = emptyData();
  const seed: [string, string, string, string, string[], number | null][] = [
    [
      "diagonal",
      "Diagonal Traverse",
      "LeetCode",
      "498",
      ["Arrays", "Matrix"],
      null,
    ],
    [
      "ribbon",
      "Cut Ribbon",
      "Codeforces",
      "189A",
      ["Dynamic programming", "Brute force"],
      1300,
    ],
    [
      "window",
      "Longest Substring Without Repeating Characters",
      "LeetCode",
      "3",
      ["Strings", "Sliding window"],
      null,
    ],
    ["sum", "Two Sum", "LeetCode", "1", ["Arrays", "Hashing"], null],
    [
      "watermelon",
      "Watermelon",
      "Codeforces",
      "4A",
      ["Math", "Brute force"],
      800,
    ],
    ["boredom", "Boredom", "Codeforces", "455A", ["Dynamic programming"], 1500],
    [
      "search",
      "Search in Rotated Sorted Array",
      "LeetCode",
      "33",
      ["Arrays", "Binary search"],
      null,
    ],
    [
      "tree",
      "Binary Tree Level Order Traversal",
      "LeetCode",
      "102",
      ["Trees", "Queue"],
      null,
    ],
  ];
  const slugs: Record<string, string> = {
    diagonal: "diagonal-traverse",
    window: "longest-substring-without-repeating-characters",
    sum: "two-sum",
    search: "search-in-rotated-sorted-array",
    tree: "binary-tree-level-order-traversal",
  };
  data.problems = seed.map(
    ([id, title, platform, problemCode, tags, rating]) => ({
      id,
      title,
      platform,
      problemCode,
      tags,
      rating,
      url:
        platform === "Codeforces"
          ? `https://codeforces.com/problemset/problem/${problemCode.replace(/[A-Z]/g, "")}/${problemCode.match(/[A-Z]/)?.[0]}`
          : `https://leetcode.com/problems/${slugs[id]}/`,
      createdAt: addDays(now, -35).toISOString(),
      reviewAt: null,
      reviewCount: 0,
    }),
  );
  function attempt(
    problemId: string,
    days: number,
    outcome: Outcome,
    difficulty: Difficulty | null,
    takeaway: string,
    minutes = 30,
  ) {
    const date = addDays(now, days);
    date.setHours(10, 30, 0, 0);
    // Sample records stay in the past even when exploring early in the morning.
    if (date > now) date.setTime(now.getTime() - 3600000);
    data.attempts.push({
      id: `demo-${data.attempts.length}`,
      problemId,
      startedAt: new Date(date.getTime() - minutes * 60000).toISOString(),
      completedAt: date.toISOString(),
      elapsedMs: minutes * 60000,
      outcome,
      difficulty,
      takeaway,
      notes: "",
    });
  }
  attempt(
    "sum",
    -30,
    "hint",
    "approach",
    "Think about what has already been seen.",
  );
  attempt(
    "diagonal",
    -28,
    "editorial",
    "coding",
    "Track direction separately from row and column.",
  );
  attempt(
    "watermelon",
    -27,
    "independent",
    null,
    "Check the smallest even number too.",
    15,
  );
  attempt(
    "ribbon",
    -25,
    "unsolved",
    "approach",
    "Try defining the state before the recurrence.",
  );
  attempt(
    "window",
    -24,
    "hint",
    "edges",
    "Shrink the window until the repeated character is gone.",
  );
  attempt(
    "sum",
    -23,
    "independent",
    null,
    "A complement lookup replaces the inner loop.",
    15,
  );
  attempt(
    "ribbon",
    -21,
    "editorial",
    "coding",
    "Unreachable states need a different initial value.",
  );
  attempt(
    "boredom",
    -20,
    "unsolved",
    "approach",
    "Group identical values before thinking about choices.",
  );
  attempt("search", -18, "hint", "edges", "One half is always sorted.");
  attempt(
    "window",
    -16,
    "independent",
    null,
    "Move the left pointer only forward.",
  );
  attempt(
    "boredom",
    -15,
    "hint",
    "complexity",
    "The recurrence resembles house robber.",
  );
  attempt(
    "diagonal",
    -14,
    "hint",
    "coding",
    "Write out the four boundary transitions.",
  );
  attempt(
    "search",
    -12,
    "independent",
    null,
    "Identify the sorted half, then narrow the interval.",
  );
  attempt(
    "watermelon",
    -10,
    "independent",
    null,
    "Even and greater than two.",
    15,
  );
  const weekday = (now.getDay() + 6) % 7;
  // Three completed sessions in the visible week (or fewer at the start of a week).
  for (const day of [0, 2, 4].filter((d) => d <= weekday)) {
    const offset = day - weekday;
    if (day === 0)
      attempt(
        "ribbon",
        offset,
        "hint",
        "coding",
        "Use dp[length] for the greatest number of pieces.",
      );
    if (day === 2)
      attempt(
        "diagonal",
        offset,
        "hint",
        "coding",
        "The idea is clear; practise the loops independently.",
      );
    if (day === 4)
      attempt(
        "boredom",
        offset,
        "independent",
        null,
        "Once grouped, the choices become much simpler.",
        28,
      );
  }
  for (const [id, offset, count] of [
    ["diagonal", 0, 0],
    ["ribbon", 1, 0],
    ["window", 3, 1],
  ] as [string, number, number][]) {
    const p = data.problems.find((p) => p.id === id)!;
    p.reviewAt = localDate(addDays(now, offset));
    p.reviewCount = count;
  }
  return data;
}

// Imports are untrusted. Validate types, sizes, relationships, URLs, and session state.
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown, max: number, min = 0): value is string {
  return (
    typeof value === "string" && value.length >= min && value.length <= max
  );
}
function num(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
function iso(value: unknown): value is string {
  return (
    str(value, 40, 10) &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function date(value: unknown): value is string {
  return (
    str(value, 10, 10) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    localDate(dateFromDay(value)) === value
  );
}
export function safeUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function validateData(input: unknown): Data {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!record(input) || ![1, 2].includes(input.schemaVersion as number))
    return fail(
      "This is not a supported Forma export (schema version 1 or 2).",
    );
  if (
    !Array.isArray(input.problems) ||
    input.problems.length > 10000 ||
    !Array.isArray(input.attempts) ||
    input.attempts.length > 50000
  )
    return fail(
      "Problem or attempt records are missing, or the file is too large.",
    );
  const ids = new Set<string>();
  const platformIds = new Set<string>();
  for (const p of input.problems) {
    if (
      !record(p) ||
      !str(p.id, 200, 1) ||
      ids.has(p.id) ||
      !str(p.title, 240, 1) ||
      !str(p.platform, 60, 1) ||
      !str(p.url, 2000) ||
      !safeUrl(p.url) ||
      !str(p.problemCode, 60) ||
      !Array.isArray(p.tags) ||
      p.tags.length > 20 ||
      !p.tags.every((t) => str(t, 60, 1)) ||
      !(
        p.rating === null ||
        (num(p.rating, 0, 10000) && Number.isInteger(p.rating))
      ) ||
      !iso(p.createdAt) ||
      !(p.reviewAt === null || date(p.reviewAt)) ||
      !num(p.reviewCount, 0, 10000) ||
      !Number.isInteger(p.reviewCount)
    )
      return fail(
        "A problem has invalid fields, a duplicate ID, or an unsafe link.",
      );
    if (
      input.schemaVersion === 2 &&
      (!(
        p.cfHandle === undefined ||
        (str(p.cfHandle, 24, 3) && /^[A-Za-z0-9_.-]+$/.test(p.cfHandle))
      ) ||
        !(p.cfKey === undefined || str(p.cfKey, 100, 1)) ||
        Boolean(p.cfHandle) !== Boolean(p.cfKey) ||
        !(
          p.reviewManual === undefined || typeof p.reviewManual === "boolean"
        ) ||
        !(p.reviewAttemptId === undefined || str(p.reviewAttemptId, 100, 1)))
    )
      return fail("A problem has invalid profile or review fields.");
    if (
      !(p.archived === undefined || typeof p.archived === "boolean") ||
      !(
        p.deferredUntil === undefined ||
        p.deferredUntil === null ||
        date(p.deferredUntil)
      ) ||
      !(p.skippedOn === undefined || p.skippedOn === null || date(p.skippedOn))
    )
      return fail("A problem has invalid automatic-practice preferences.");
    if (!(p.reviewCompletedAt === undefined || iso(p.reviewCompletedAt)))
      return fail("A problem has an invalid revisit completion timestamp.");
    if (!(p.reviewUpdatedAt === undefined || iso(p.reviewUpdatedAt)))
      return fail("A problem has an invalid revisit decision timestamp.");
    if (!(p.revisionCue === undefined || str(p.revisionCue, 2000)))
      return fail("A revision cue must be no longer than 2,000 characters.");
    if (input.schemaVersion === 2 && typeof p.cfHandle === "string") {
      const key = `${p.cfHandle.toLowerCase()}:${p.cfKey}`;
      if (platformIds.has(key))
        return fail("A problem has a duplicate platform identity.");
      platformIds.add(key);
    }
    ids.add(p.id);
  }
  const attemptIds = new Set<string>();
  for (const a of input.attempts) {
    if (
      !record(a) ||
      !str(a.id, 100, 1) ||
      attemptIds.has(a.id) ||
      !str(a.problemId, 200, 1) ||
      !ids.has(a.problemId) ||
      !iso(a.startedAt) ||
      !iso(a.completedAt) ||
      Date.parse(a.completedAt) < Date.parse(a.startedAt) ||
      !num(a.elapsedMs, 0, 31536000000) ||
      typeof a.outcome !== "string" ||
      !Object.hasOwn(OUTCOMES, a.outcome) ||
      !(
        a.difficulty === null ||
        (typeof a.difficulty === "string" &&
          Object.hasOwn(DIFFICULTIES, a.difficulty))
      ) ||
      !str(a.takeaway, 300) ||
      !str(a.notes, 50000)
    )
      return fail(
        "An attempt has invalid fields or refers to a missing problem.",
      );
    attemptIds.add(a.id);
    validateTrackContext(a.trackContext);
    validateReflectionMemory(a);
  }
  const s = input.settings;
  if (
    !record(s) ||
    !str(s.displayName, 60) ||
    !num(s.weeklyGoal, 1, 14) ||
    !Number.isInteger(s.weeklyGoal) ||
    ![15, 30, 60].includes(s.defaultDuration as number) ||
    !["cp", "placement", "mixed"].includes(s.focus as string)
  )
    return fail("The settings in this file are invalid.");
  if (
    !(
      s.textSize === undefined ||
      ["comfortable", "large"].includes(s.textSize as string)
    )
  )
    return fail("The text size preference in this file is invalid.");
  const days = input.schemaVersion === 1 ? DEFAULT_REVIEW_DAYS : s.reviewDays;
  const recallDays = validateRecallDays(s.recallDays);
  if (
    !record(days) ||
    !["unsolved", "editorial", "hint"].every(
      (k) => num(days[k], 1, 90) && Number.isInteger(days[k]),
    )
  )
    return fail("The revisit defaults are invalid.");
  const session = input.session;
  if (
    session !== null &&
    (!record(session) ||
      !str(session.id, 100, 1) ||
      !str(session.problemId, 200, 1) ||
      !ids.has(session.problemId) ||
      !iso(session.startedAt) ||
      !(
        session.runningSince === null ||
        num(session.runningSince, 0, 8640000000000000)
      ) ||
      !num(session.elapsedMs, 0, 31536000000) ||
      !(
        num(session.targetMinutes, 1, 180) &&
        Number.isInteger(session.targetMinutes)
      ) ||
      !str(session.notes, 50000) ||
      typeof session.timerVisible !== "boolean" ||
      !["focus", "reflection"].includes(session.phase as string) ||
      (session.phase === "reflection" && session.runningSince !== null))
  )
    return fail("The active session in this file is invalid.");
  if (record(session)) validateTrackContext(session.trackContext);
  // Reconstruct only known fields, discarding unknown imported properties.
  const problems: Problem[] = input.problems.map((p) => ({
    id: p.id,
    title: p.title,
    platform: p.platform,
    url: p.url,
    problemCode: p.problemCode,
    tags: [...p.tags],
    rating: p.rating,
    createdAt: new Date(p.createdAt).toISOString(),
    reviewAt: p.reviewAt,
    reviewCount: p.reviewCount,
    ...(input.schemaVersion === 2 && p.cfHandle
      ? { cfHandle: p.cfHandle, cfKey: p.cfKey }
      : {}),
    ...(input.schemaVersion === 2 && p.reviewManual !== undefined
      ? { reviewManual: p.reviewManual }
      : input.schemaVersion === 1 && p.reviewAt
        ? { reviewManual: true }
        : {}),
    ...(input.schemaVersion === 2 && p.reviewAttemptId
      ? { reviewAttemptId: p.reviewAttemptId }
      : {}),
    ...(p.archived !== undefined ? { archived: p.archived } : {}),
    ...(p.deferredUntil !== undefined
      ? { deferredUntil: p.deferredUntil }
      : {}),
    ...(p.skippedOn !== undefined ? { skippedOn: p.skippedOn } : {}),
    ...(p.reviewCompletedAt !== undefined
      ? { reviewCompletedAt: new Date(p.reviewCompletedAt).toISOString() }
      : {}),
    ...(p.reviewUpdatedAt !== undefined
      ? { reviewUpdatedAt: new Date(p.reviewUpdatedAt).toISOString() }
      : {}),
    ...(p.revisionCue !== undefined ? { revisionCue: p.revisionCue } : {}),
  }));
  const codeforces =
    input.schemaVersion === 1
      ? emptyCodeforces()
      : validateCodeforces(input.codeforces, problems);
  const attempts: Attempt[] = input.attempts.map((a) => ({
    id: a.id,
    problemId: a.problemId,
    startedAt: new Date(a.startedAt).toISOString(),
    completedAt: new Date(a.completedAt).toISOString(),
    elapsedMs: a.elapsedMs,
    outcome: a.outcome,
    difficulty: a.difficulty,
    takeaway: a.takeaway,
    notes: a.notes,
    ...validateReflectionMemory(a),
    ...(a.trackContext !== undefined
      ? { trackContext: validateTrackContext(a.trackContext) }
      : {}),
  }));
  const revisions = validateRevisions(
    input.revisions,
    problems,
    codeforces.profiles.map((profile) => profile.handle),
  );
  const learningLinks = validateLearningLinks(
    input.learningLinks,
    problems,
    attempts,
    codeforces,
  );
  return {
    schemaVersion: 2,
    codeforces,
    problems,
    attempts,
    ...(input.practicePlans !== undefined
      ? {
          practicePlans: validatePracticePlans(input.practicePlans, {
            problems,
            attempts,
            revisions,
            codeforces,
            learningLinks,
          }),
        }
      : {}),
    ...(input.contests !== undefined
      ? {
          contests: validateContests(input.contests, {
            problems,
            attempts,
            session: input.session as Session | null,
            codeforces,
          }),
        }
      : {}),
    revisions,
    ...validateTracks(input, problems),
    learningLinks,
    discovery: validateDiscovery(input.discovery),
    settings: {
      displayName: s.displayName,
      weeklyGoal: s.weeklyGoal,
      defaultDuration: s.defaultDuration,
      focus: s.focus,
      reviewDays: {
        unsolved: days.unsolved,
        editorial: days.editorial,
        hint: days.hint,
      },
      reminder: validateReminder(s.reminder),
      textSize: s.textSize ?? "comfortable",
      recallDays,
      ...(s.practicePreferences !== undefined
        ? {
            practicePreferences: validatePracticePreferences(
              s.practicePreferences,
            ),
          }
        : {}),
    } as Settings,
    session:
      session === null
        ? null
        : ({
            id: session.id,
            problemId: session.problemId,
            startedAt: new Date(session.startedAt as string).toISOString(),
            runningSince: session.runningSince,
            elapsedMs: session.elapsedMs,
            targetMinutes: session.targetMinutes,
            notes: session.notes,
            timerVisible: session.timerVisible,
            phase: session.phase,
            ...(session.trackContext !== undefined
              ? { trackContext: validateTrackContext(session.trackContext) }
              : {}),
          } as Session),
  };
}
