import type { Data, Duration, Problem } from "./model";

export interface CatalogueProblem {
  key: string;
  title: string;
  code: string;
  url: string;
  rating: number | null;
  /** Original platform metadata. Normalization never replaces these tags. */
  tags: string[];
}

export interface ProblemCatalogue {
  problems: CatalogueProblem[];
  fetchedAt: string;
  stale: boolean;
}

export function validateCatalogue(value: unknown): ProblemCatalogue {
  if (
    !isObject(value) ||
    !Array.isArray(value.problems) ||
    value.problems.length > 100000 ||
    !stamp(value.fetchedAt) ||
    typeof value.stale !== "boolean"
  )
    throw new Error("The problem catalogue has invalid fields.");
  const keys = new Set<string>();
  const problems: CatalogueProblem[] = value.problems.map((problem) => {
    if (
      !isObject(problem) ||
      !string(problem.key, 100) ||
      !problem.key ||
      keys.has(problem.key) ||
      !string(problem.title, 240) ||
      !problem.title ||
      !string(problem.code, 60) ||
      !problem.code ||
      !string(problem.url, 2000) ||
      !(problem.rating === null || rating(problem.rating)) ||
      !Array.isArray(problem.tags) ||
      problem.tags.length > 20 ||
      !problem.tags.every((tag) => string(tag, 60) && tag.length > 0)
    )
      throw new Error("The problem catalogue has invalid fields.");
    let url: URL;
    try {
      url = new URL(problem.url);
    } catch {
      throw new Error("The problem catalogue has an invalid link.");
    }
    if (
      url.origin !== "https://codeforces.com" ||
      url.username ||
      url.password ||
      !/^\/problemset\/problem\/\d+\/[A-Z0-9]+$/.test(url.pathname)
    )
      throw new Error("The problem catalogue has an invalid link.");
    keys.add(problem.key);
    return {
      key: problem.key,
      title: problem.title,
      code: problem.code,
      url: problem.url,
      rating: problem.rating as number | null,
      tags: [...(problem.tags as string[])],
    };
  });
  return {
    problems,
    fetchedAt: new Date(value.fetchedAt).toISOString(),
    stale: value.stale,
  };
}

export type DismissalReason = "another" | "difficult" | "not_today";
export interface DiscoveryDismissal {
  key: string;
  reason: DismissalReason;
  dismissedAt: string;
  until: string;
}
export interface DiscoveryPreferences {
  minRating: number;
  maxRating: number;
  topic: string;
  selectedKey: string | null;
  selectedOn: string | null;
  dismissals: DiscoveryDismissal[];
}

export const defaultDiscovery = (): DiscoveryPreferences => ({
  minRating: 800,
  maxRating: 1400,
  topic: "",
  selectedKey: null,
  selectedOn: null,
  dismissals: [],
});

const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const futureDay = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return day(next);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const rating = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 10000;
const date = (value: unknown): value is string =>
  string(value, 10) &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  day(new Date(`${value}T12:00:00`)) === value;
const stamp = (value: unknown): value is string =>
  string(value, 40) &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));

export function validateDiscovery(value: unknown): DiscoveryPreferences {
  if (value === undefined) return defaultDiscovery();
  const fail = (): never => {
    throw new Error("The discovery preferences have invalid fields.");
  };
  if (
    !isObject(value) ||
    !rating(value.minRating) ||
    !rating(value.maxRating) ||
    value.minRating > value.maxRating ||
    !string(value.topic, 60) ||
    !(
      value.selectedKey === null ||
      (string(value.selectedKey, 100) && value.selectedKey.length > 0)
    ) ||
    !(value.selectedOn === null || date(value.selectedOn)) ||
    !Array.isArray(value.dismissals) ||
    value.dismissals.length > 1000
  )
    return fail();
  const identities = new Set<string>();
  const dismissals: DiscoveryDismissal[] = [];
  for (const dismissal of value.dismissals) {
    if (
      !isObject(dismissal) ||
      !string(dismissal.key, 100) ||
      !dismissal.key ||
      identities.has(dismissal.key) ||
      !["another", "difficult", "not_today"].includes(
        dismissal.reason as string,
      ) ||
      !stamp(dismissal.dismissedAt) ||
      !date(dismissal.until)
    )
      return fail();
    identities.add(dismissal.key);
    dismissals.push({
      key: dismissal.key,
      reason: dismissal.reason as DismissalReason,
      dismissedAt: new Date(dismissal.dismissedAt).toISOString(),
      until: dismissal.until,
    });
  }
  return {
    minRating: value.minRating,
    maxRating: value.maxRating,
    topic: value.topic,
    selectedKey: value.selectedKey as string | null,
    selectedOn: value.selectedOn as string | null,
    dismissals,
  };
}

const topicAliases: Record<string, string> = {
  dp: "dynamic programming",
  "dynamic programming": "dynamic programming",
  graph: "graphs",
  string: "strings",
  array: "arrays",
  tree: "trees",
  "two pointer": "two pointers",
  "bit manipulation": "bitmasks",
  bitmask: "bitmasks",
  constructive: "constructive algorithms",
  "disjoint set union": "dsu",
  "union find": "dsu",
};

export function normalizeTopic(topic: string): string {
  const normalized = topic
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return topicAliases[normalized] ?? normalized;
}

export function catalogueTopics(catalogue: ProblemCatalogue): string[] {
  return [
    ...new Set(
      catalogue.problems.flatMap((problem) => problem.tags.map(normalizeTopic)),
    ),
  ].sort();
}

/** Match saved manual and imported identities without relying on their titles. */
export function savedCatalogueKey(problem: Problem): string | null {
  if (problem.cfKey) return problem.cfKey;
  if (problem.platform.toLowerCase() !== "codeforces") return null;
  try {
    const url = new URL(problem.url);
    if (!["codeforces.com", "www.codeforces.com"].includes(url.hostname))
      return null;
    const match = url.pathname.match(
      /^\/(?:problemset\/problem\/(\d+)\/([A-Za-z0-9]+)|(?:contest|gym)\/(\d+)\/problem\/([A-Za-z0-9]+))\/?$/,
    );
    if (match)
      return `contest:${Number(match[1] ?? match[3])}:${(match[2] ?? match[4]).toUpperCase()}`;
  } catch {
    /* A code alone may still provide the platform identity. */
  }
  const match = problem.problemCode.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/);
  return match ? `contest:${Number(match[1])}:${match[2].toUpperCase()}` : null;
}

export function knownAcceptedKeys(data: Data): Set<string> {
  const handle = data.codeforces.connectedHandle?.toLowerCase();
  const problems = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const keys = new Set<string>();
  for (const submission of data.codeforces.submissions) {
    if (
      !handle ||
      submission.handle.toLowerCase() !== handle ||
      submission.verdict !== "OK"
    )
      continue;
    const problem = problems.get(submission.problemId);
    const key = problem && savedCatalogueKey(problem);
    if (key) keys.add(key);
  }
  return keys;
}

export function discoveryCoverageNotice(data: Data): string {
  const handle = data.codeforces.connectedHandle;
  if (!handle)
    return "No Codeforces profile is connected. Suggestions can include problems you have solved outside Forma.";
  const profile = data.codeforces.profiles.find(
    (profile) => profile.handle.toLowerCase() === handle.toLowerCase(),
  );
  if (!profile?.historyComplete || profile.gapUntilId !== null)
    return `Known accepted problems for ${handle} are excluded. Imported history is incomplete, so a suggestion may have been solved before.`;
  return `Known accepted problems for ${handle} are excluded using imported history. Newer activity may be missing until you refresh.`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++)
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

export interface FreshRecommendation {
  problem: CatalogueProblem;
  reason: string;
  /** Generic rules, never an inferred claim about the learner's weaknesses. */
  personalized: false;
}

export interface FreshSelection {
  recommendation: FreshRecommendation | null;
  candidateCount: number;
  unratedCount: number;
  coverageNotice: string;
}

export function selectFreshProblem(
  catalogue: ProblemCatalogue,
  data: Data,
  preferences = defaultDiscovery(),
  now = new Date(),
): FreshSelection {
  const today = day(now);
  const handle = data.codeforces.connectedHandle?.toLowerCase();
  const accepted = knownAcceptedKeys(data);
  // A problem already in the active collection belongs to the saved/revisit
  // flow. This also prevents discovery bypassing a deliberate future date.
  const saved = new Set(
    data.problems
      .filter(
        (problem) =>
          !problem.cfHandle || problem.cfHandle.toLowerCase() === handle,
      )
      .map(savedCatalogueKey)
      .filter((key): key is string => key !== null),
  );
  const dismissed = new Set(
    preferences.dismissals
      .filter((dismissal) => dismissal.until >= today)
      .map((dismissal) => dismissal.key),
  );
  const topic = normalizeTopic(preferences.topic);
  const topicMatches = (problem: CatalogueProblem) =>
    !topic || problem.tags.some((tag) => normalizeTopic(tag) === topic);
  const unseen = catalogue.problems.filter(
    (problem) =>
      !accepted.has(problem.key) &&
      !saved.has(problem.key) &&
      !dismissed.has(problem.key) &&
      topicMatches(problem),
  );
  const pool = unseen.filter(
    (problem) =>
      problem.rating !== null &&
      problem.rating >= preferences.minRating &&
      problem.rating <= preferences.maxRating,
  );
  const current =
    preferences.selectedOn === today
      ? pool.find((problem) => problem.key === preferences.selectedKey)
      : undefined;
  // Deterministic daily ordering remains stable through page loads and ordinary
  // sync refreshes. Explicit selectedKey also survives catalogue additions.
  const seed = `${today}:${handle ?? "local"}:${preferences.minRating}:${preferences.maxRating}:${topic}`;
  const problem =
    current ??
    [...pool].sort(
      (left, right) =>
        hash(`${seed}:${left.key}`) - hash(`${seed}:${right.key}`) ||
        left.key.localeCompare(right.key),
    )[0];
  return {
    recommendation: problem
      ? {
          problem,
          reason: `Generic match: ${problem.rating} is in your chosen ${preferences.minRating}–${preferences.maxRating} range${topic ? ", with your chosen topic focus" : ""}. Rating describes difficulty; it does not predict solve time.`,
          personalized: false,
        }
      : null,
    candidateCount: pool.length,
    unratedCount: unseen.filter((problem) => problem.rating === null).length,
    coverageNotice: discoveryCoverageNotice(data),
  };
}

export function retainFreshSelection(
  preferences: DiscoveryPreferences,
  key: string,
  now = new Date(),
): DiscoveryPreferences {
  return { ...preferences, selectedKey: key, selectedOn: day(now) };
}

export function dismissFreshSuggestion(
  preferences: DiscoveryPreferences,
  key: string,
  reason: DismissalReason,
  now = new Date(),
): DiscoveryPreferences {
  const today = day(now);
  const dismissal: DiscoveryDismissal = {
    key,
    reason,
    dismissedAt: now.toISOString(),
    until:
      reason === "not_today"
        ? today
        : futureDay(now, reason === "difficult" ? 14 : 7),
  };
  // Expired dismissals need not accumulate over years. Active dismissals are
  // preserved; the supported cap is surfaced by validation rather than truncation.
  return {
    ...preferences,
    selectedKey: null,
    selectedOn: null,
    dismissals: [
      ...preferences.dismissals.filter(
        (item) => item.key !== key && item.until >= today,
      ),
      dismissal,
    ],
  };
}

export function catalogueProblemToSaved(
  problem: CatalogueProblem,
  id: string,
  now = new Date(),
): Problem {
  return {
    id,
    title: problem.title,
    platform: "Codeforces",
    url: problem.url,
    problemCode: problem.code,
    tags: [...problem.tags],
    rating: problem.rating,
    createdAt: now.toISOString(),
    reviewAt: null,
    reviewCount: 0,
  };
}

export function composePractice(
  duration: Duration,
  revisit: Problem | null,
  fresh: FreshRecommendation | null,
): { kinds: ("revisit" | "fresh")[]; explanation: string } {
  if (duration === 15)
    return {
      kinds: revisit ? ["revisit"] : fresh ? ["fresh"] : [],
      explanation: revisit
        ? "One familiar revisit keeps the short session focused. Stop when your time is up; finishing is optional."
        : "One problem to explore. There is not enough personal timing history to estimate a solve time.",
    };
  if (duration === 60 && revisit && fresh)
    return {
      kinds: ["revisit", "fresh"],
      explanation:
        "Start with a familiar revisit, then explore a fresh problem if time remains. No rating guarantees a solve time.",
    };
  return {
    kinds: fresh ? ["fresh"] : revisit ? ["revisit"] : [],
    explanation:
      "One focused problem, with room to think and reflect. These rules choose session composition, not a predicted completion time.",
  };
}
