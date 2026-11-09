import {
  canonicalProblemIdentity,
  normalizeCodeforcesIdentity,
} from "./codeforces-identity";
import { activeContest, futureUpsolveIdentities } from "./contest-lab";
import {
  catalogueProblemToSaved,
  normalizeTopic,
  type CatalogueProblem,
  type ProblemCatalogue,
} from "./discovery";
import { learningHistory, type LearningRecord } from "./learning";
import type { Data, Problem, Session, TakeawayPracticeContext } from "./model";
import { withPracticeSession } from "./practice-session";
import { sharedPracticeState } from "./practice-state";

const RATING_WINDOW = 200;

export interface TakeawayPracticeSuggestion {
  problem: CatalogueProblem & { rating: number };
  context: TakeawayPracticeContext;
  savedProblemId?: string;
  catalogueProblem?: CatalogueProblem;
  sourceCatalogue?: CatalogueProblem;
}

function identity(problem: Problem): string {
  const canonical = canonicalProblemIdentity(problem);
  if (canonical) return canonical;
  const platform = problem.platform.trim().toLowerCase();
  const code = problem.problemCode.trim().toLowerCase();
  if (code) return `${platform}:code:${code}`;
  if (problem.url) {
    const url = new URL(problem.url);
    return `${platform}:url:${url.hostname}${url.pathname.replace(/\/$/, "")}`;
  }
  return `problem:${problem.id}`;
}

function platform(problem: Problem): string {
  return canonicalProblemIdentity(problem)
    ? "codeforces"
    : problem.platform.trim().toLowerCase();
}

function validCatalogueIdentity(problem: CatalogueProblem): boolean {
  return (
    normalizeCodeforcesIdentity({ url: problem.url })?.key === problem.key &&
    normalizeCodeforcesIdentity({ code: problem.code })?.key === problem.key
  );
}

function topics(tags: string[]): string[] {
  const shared = [...new Set(tags.map(normalizeTopic).filter(Boolean))];
  // Prefer a more descriptive shared tag when a problem also says implementation.
  return shared.sort(
    (a, b) => Number(a === "implementation") - Number(b === "implementation"),
  );
}

function recordedIdentities(data: Data) {
  const ids = new Map(
    data.problems.map((problem) => [problem.id, identity(problem)]),
  );
  const attempted = new Set<string>();
  const records = learningHistory(data, { allProfiles: true });
  for (const problemId of [
    ...records.flatMap((record) => record.problemIds),
    ...data.codeforces.submissions.map((submission) => submission.problemId),
    ...(data.revisions ?? []).map((record) => record.problemId),
  ]) {
    const key = ids.get(problemId);
    if (key) attempted.add(key);
  }
  return { attempted, records };
}

function sourceRecord(data: Data, records: LearningRecord[], id: string) {
  const record = records.find((item) => item.id === id);
  return record?.reflectedAt &&
    record.takeaway.trim() &&
    (!record.handle ||
      record.handle.toLowerCase() === data.codeforces.connectedHandle?.toLowerCase())
    ? record
    : null;
}

function findSuggestion(
  data: Data,
  sourceRecordId: string,
  catalogue: readonly CatalogueProblem[],
  now: Date,
  requestedKey?: string,
): TakeawayPracticeSuggestion | null {
  const { attempted, records } = recordedIdentities(data);
  const record = sourceRecord(data, records, sourceRecordId);
  if (!record) return null;
  const source = data.problems.find((item) => item.id === record.problemId);
  if (!source) return null;
  const sourceKey = identity(source);
  const sourcePlatform = platform(source);
  const catalogueByKey = new Map(catalogue.map((problem) => [problem.key, problem]));
  const sourceMetadata = catalogueByKey.get(sourceKey);
  const sourceCatalogue =
    sourceMetadata && validCatalogueIdentity(sourceMetadata)
      ? sourceMetadata
      : undefined;
  const sourceRating = source.rating ?? sourceCatalogue?.rating;
  const savedTopics = topics(source.tags);
  const sourceTopics = savedTopics.length
    ? savedTopics
    : topics(sourceCatalogue?.tags ?? []);
  if (sourceRating == null || !sourceTopics.length) return null;
  const unavailable = futureUpsolveIdentities(data, now);
  const activeHandle = data.codeforces.connectedHandle?.toLowerCase();
  const savedByKey = new Map<string, Problem>();
  for (const problem of data.problems) {
    if (
      platform(problem) !== sourcePlatform ||
      (problem.cfHandle && problem.cfHandle.toLowerCase() !== activeHandle)
    )
      continue;
    const key = identity(problem);
    if (!sharedPracticeState(data, problem, now).eligible) unavailable.add(key);
    const saved = savedByKey.get(key);
    if (!saved || (saved.cfHandle && !problem.cfHandle))
      savedByKey.set(key, problem);
  }
  const keys = requestedKey
    ? [requestedKey]
    : new Set([
        ...savedByKey.keys(),
        ...(sourcePlatform === "codeforces" ? catalogueByKey.keys() : []),
      ]);
  let best: TakeawayPracticeSuggestion | null = null;
  let bestDistance = Infinity;
  for (const key of keys) {
    if (key === sourceKey || attempted.has(key) || unavailable.has(key)) continue;
    const saved = savedByKey.get(key);
    const catalogueProblem =
      sourcePlatform === "codeforces" ? catalogueByKey.get(key) : undefined;
    if ((!saved && !catalogueProblem) || (saved && !saved.url)) continue;
    const rating = saved?.rating ?? catalogueProblem?.rating;
    if (rating == null) continue;
    const distance = Math.abs(rating - sourceRating);
    if (distance > RATING_WINDOW || distance > bestDistance) continue;
    const tags = saved?.tags.length ? saved.tags : catalogueProblem?.tags ?? [];
    const candidateTopics = topics(tags);
    const topic = sourceTopics.find((value) => candidateTopics.includes(value));
    if (!topic || (catalogueProblem && !validCatalogueIdentity(catalogueProblem))) continue;
    if (best && distance === bestDistance) {
      const currentSaved = Boolean(best.savedProblemId);
      const candidateSaved = Boolean(saved);
      if (
        (currentSaved && !candidateSaved) ||
        (currentSaved === candidateSaved && best.problem.key.localeCompare(key) < 0)
      )
        continue;
    }
    bestDistance = distance;
    best = {
      problem: saved
        ? {
            key,
            title: saved.title,
            code: saved.problemCode,
            url: saved.url,
            rating,
            tags,
          }
        : { ...catalogueProblem!, rating },
      context: {
        sourceRecordId,
        sourceProblemTitle: source.title,
        takeaway: record.takeaway.trim(),
        topic,
      },
      ...(saved ? { savedProblemId: saved.id } : {}),
      ...(catalogueProblem ? { catalogueProblem } : {}),
      ...(sourceCatalogue ? { sourceCatalogue } : {}),
    };
  }
  return best;
}

export function selectTakeawayPractice(
  data: Data,
  sourceRecordId: string,
  catalogue: ProblemCatalogue | null,
): TakeawayPracticeSuggestion | null {
  return findSuggestion(data, sourceRecordId, catalogue?.problems ?? [], new Date());
}

export function withTakeawayPractice(
  data: Data,
  suggestion: TakeawayPracticeSuggestion,
  now: number,
  sessionId: string,
  problemId: string,
): Data {
  const current = findSuggestion(
    data,
    suggestion.context.sourceRecordId,
    [suggestion.sourceCatalogue, suggestion.catalogueProblem].filter(
      (item) => item !== undefined,
    ),
    new Date(now),
    suggestion.problem.key,
  );
  if (
    !current ||
    current.problem.title !== suggestion.problem.title ||
    current.problem.rating !== suggestion.problem.rating ||
    current.context.sourceProblemTitle !== suggestion.context.sourceProblemTitle ||
    current.context.takeaway !== suggestion.context.takeaway ||
    current.context.topic !== suggestion.context.topic
  )
    throw new Error(
      "This match has changed. Look for a new problem from the Journal entry.",
    );

  const saved = data.problems.find(
    (problem) => problem.id === current.savedProblemId,
  );
  if (
    (!saved && data.problems.some((item) => item.id === problemId)) ||
    data.attempts.some((attempt) => attempt.id === sessionId)
  )
    throw new Error(
      "That practice session already exists. Try starting a new session.",
    );
  const problem =
    saved ?? catalogueProblemToSaved(current.problem, problemId, new Date(now));
  const next = withPracticeSession(
    data,
    problem,
    data.settings.defaultDuration,
    now,
    sessionId,
    !saved,
  );
  return { ...next, session: { ...next.session!, takeawayPractice: current.context } };
}

/** During a revision merge, a new session cannot begin against an already
 * recorded attempt or a takeaway that changed on the other device. */
export function takeawayPracticeStartConflict(
  data: Data,
  session: Session,
): boolean {
  const context = session.takeawayPractice;
  if (!context) return false;
  const { attempted, records } = recordedIdentities(data);
  const candidate = data.problems.find((item) => item.id === session.problemId);
  const record = sourceRecord(data, records, context.sourceRecordId);
  const source = record && data.problems.find((item) => item.id === record.problemId);
  return (
    !candidate ||
    !record ||
    !source ||
    !!activeContest(data) ||
    source.title !== context.sourceProblemTitle ||
    record.takeaway.trim() !== context.takeaway ||
    attempted.has(identity(candidate))
  );
}
