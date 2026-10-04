import type { CatalogueProblem, ProblemCatalogue } from "./discovery";
import { CodeforcesError, codeforcesAdapter } from "./codeforces-api";

export const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOGUE_RETRY_MS = 5 * 60 * 1000;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const integer = (
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
const malformed = () =>
  new CodeforcesError(
    "The Codeforces catalogue could not be read safely. Try again later.",
    "temporary",
  );

export function parseProblemCatalogue(result: unknown): CatalogueProblem[] {
  if (
    !object(result) ||
    !Array.isArray(result.problems) ||
    result.problems.length > 100000 ||
    !Array.isArray(result.problemStatistics)
  )
    throw malformed();
  const keys = new Set<string>();
  const problems: CatalogueProblem[] = [];
  for (const problem of result.problems) {
    if (
      !object(problem) ||
      !text(problem.name, 240) ||
      !text(problem.index, 20) ||
      !/^[A-Za-z0-9]+$/.test(problem.index) ||
      !(problem.contestId === undefined || integer(problem.contestId, 1)) ||
      !(
        problem.problemsetName === undefined || text(problem.problemsetName, 60)
      ) ||
      !(problem.rating === undefined || integer(problem.rating, 0, 10000)) ||
      !Array.isArray(problem.tags) ||
      problem.tags.length > 20 ||
      !problem.tags.every((tag) => text(tag, 60)) ||
      !["PROGRAMMING", "QUESTION"].includes(problem.type as string)
    )
      throw malformed();
    const index = problem.index.toUpperCase();
    const key = problem.contestId
      ? `contest:${problem.contestId}:${index}`
      : problem.problemsetName
        ? `set:${problem.problemsetName}:${index}`
        : null;
    if (!key || keys.has(key)) throw malformed();
    keys.add(key);
    // A regular programming problem must have a usable public contest link.
    // Alternate sets and QUESTION objects remain out of practice discovery.
    if (problem.type !== "PROGRAMMING" || !problem.contestId) continue;
    problems.push({
      key,
      title: problem.name,
      code: `${problem.contestId}${index}`,
      url: `https://codeforces.com/problemset/problem/${problem.contestId}/${encodeURIComponent(index)}`,
      rating: (problem.rating as number | undefined) ?? null,
      tags: [...(problem.tags as string[])],
    });
  }
  return problems;
}

/** Public catalogue only: no handle, private data, or credentials enter this cache. */
export function createCatalogueCache({
  load = () => codeforcesAdapter.catalogue(),
  now = Date.now,
  ttl = CATALOGUE_TTL_MS,
  retryAfter = CATALOGUE_RETRY_MS,
}: {
  load?: () => Promise<unknown>;
  now?: () => number;
  ttl?: number;
  retryAfter?: number;
} = {}) {
  let cached: ProblemCatalogue | null = null;
  let inFlight: Promise<ProblemCatalogue> | null = null;
  let retryAt = 0;
  let lastError: Error | null = null;
  async function get(): Promise<ProblemCatalogue> {
    const time = now();
    if (cached && time - Date.parse(cached.fetchedAt) < ttl) return cached;
    if (time < retryAt) {
      if (cached) return { ...cached, stale: true };
      throw lastError ?? malformed();
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const problems = parseProblemCatalogue(await load());
        cached = {
          problems,
          fetchedAt: new Date(now()).toISOString(),
          stale: false,
        };
        retryAt = 0;
        lastError = null;
        return cached;
      } catch (error) {
        lastError = error instanceof Error ? error : malformed();
        retryAt = now() + retryAfter;
        if (cached) return { ...cached, stale: true };
        throw lastError;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }
  return { get };
}

// Next's development reloads and separately bundled route handlers share this
// process singleton. A restart may fetch again; multi-instance deployment needs
// one shared upstream limiter/cache before horizontally scaling this adapter.
const globalCatalogue = globalThis as typeof globalThis & {
  formaCatalogueCache?: ReturnType<typeof createCatalogueCache>;
};
export const catalogueCache = (globalCatalogue.formaCatalogueCache ??=
  createCatalogueCache());
