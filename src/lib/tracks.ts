import { localDate, validateData } from "./model";
import { sharedPracticeState } from "./practice-state";
import type { Data, Problem } from "./model";
import { learningHistory } from "./learning";
import type { LearningRecord } from "./learning";
import {
  canonicalProblemIdentity,
  normalizeCodeforcesIdentity,
} from "./codeforces-identity";
import { entryNeedsReview, trackEntryIdentity } from "./track-studio";
import { validateTrackEntrySource } from "./tracks-types";
import {
  findEquivalentSharedTracks,
  isSharedTrackDraft,
  sharedTrackFingerprint,
} from "./shared-tracks";
import type {
  Track,
  TrackContext,
  TrackEntry,
  TrackImportDraft,
  TrackStage,
} from "./tracks-types";

export function trackEntries(data: Data, trackId: string): TrackEntry[] {
  const track = data.tracks?.find((value) => value.id === trackId);
  return track?.stageIds.flatMap((id) => stageEntries(data, id)) ?? [];
}
export function stageEntries(data: Data, stageId: string): TrackEntry[] {
  const stage = data.trackStages?.find((value) => value.id === stageId);
  const entries = new Map(data.trackEntries?.map((value) => [value.id, value]));
  return (
    stage?.entryIds.flatMap((id) =>
      entries.has(id) ? [entries.get(id)!] : [],
    ) ?? []
  );
}
export function trackDraft(data: Data, trackId: string): TrackImportDraft {
  const track = data.tracks?.find((value) => value.id === trackId);
  if (!track) throw new Error("This track is no longer available.");
  const stages = new Map(data.trackStages?.map((value) => [value.id, value]));
  return {
    id: track.id,
    title: track.title,
    sourceName: track.sourceName,
    sourceFingerprint: track.sourceFingerprint,
    ...(track.shareDescription !== undefined
      ? { shareDescription: track.shareDescription }
      : {}),
    ...(track.sourceNotes !== undefined
      ? { sourceNotes: track.sourceNotes }
      : {}),
    stages: track.stageIds.map((id) => {
      const stage = stages.get(id)!;
      return {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        suggestedTime: stage.suggestedTime,
        ...(stage.sourceNotes !== undefined
          ? { sourceNotes: stage.sourceNotes }
          : {}),
        entries: stageEntries(data, id).map((entry) => ({
          id: entry.id,
          title: entry.title,
          url: entry.url,
          code: entry.code,
          rating: entry.rating,
          pattern: entry.pattern,
          ...(entry.source !== undefined
            ? { source: validateTrackEntrySource(entry.source), reviewed: true }
            : {}),
        })),
      };
    }),
  };
}
export function copyTrackDraft(draft: TrackImportDraft): TrackImportDraft {
  return {
    ...draft,
    id: crypto.randomUUID(),
    stages: draft.stages.map((stage) => ({
      ...stage,
      id: crypto.randomUUID(),
      entries: stage.entries.map((entry) => ({
        ...entry,
        id: crypto.randomUUID(),
      })),
    })),
  };
}
export function findDuplicateTracks(
  data: Data,
  draft: TrackImportDraft,
): Track[] {
  if (isSharedTrackDraft(draft)) return findEquivalentSharedTracks(data, draft);
  return (data.tracks ?? []).filter(
    (track) => track.sourceFingerprint === draft.sourceFingerprint,
  );
}
function entryKey(entry: Pick<TrackEntry, "url" | "code">): string {
  const identity = normalizeCodeforcesIdentity({
    url: entry.url,
    code: entry.code,
  });
  if (!identity)
    throw new Error(
      "Correct each unresolved Codeforces problem before saving the track.",
    );
  return identity.key;
}
function sameIdentity(problem: Problem, key: string): boolean {
  return problemIdentity(problem) === key;
}
function problemIdentity(problem: Problem): string | undefined {
  return canonicalProblemIdentity(problem);
}
function profileAvailable(data: Data, problem: Problem): boolean {
  return (
    !problem.cfHandle ||
    problem.cfHandle.toLowerCase() ===
      data.codeforces.connectedHandle?.toLowerCase()
  );
}
function personalProblem(
  entry: Pick<TrackEntry, "title" | "url" | "code" | "rating">,
  createdAt: string,
): Problem {
  const identity = normalizeCodeforcesIdentity({
    url: entry.url,
    code: entry.code,
  })!;
  return {
    id: `track-problem:${identity.key}`,
    title: entry.title,
    platform: "Codeforces",
    url: identity.url,
    problemCode: identity.code,
    tags: [],
    rating: entry.rating,
    createdAt,
    reviewAt: null,
    reviewCount: 0,
  };
}
function newPersonalProblem(
  problems: Problem[],
  entry: Pick<TrackEntry, "id" | "title" | "url" | "code" | "rating">,
  createdAt: string,
): Problem {
  const problem = personalProblem(entry, createdAt);
  if (!problems.some((value) => value.id === problem.id)) return problem;
  let hash = 2166136261;
  for (const char of entry.id)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const base = `${problem.id}:${(hash >>> 0).toString(36)}`;
  let id = base,
    suffix = 1;
  while (problems.some((value) => value.id === id)) id = `${base}:${suffix++}`;
  return { ...problem, id };
}
function normalizeDraft(draft: TrackImportDraft): TrackImportDraft {
  if (
    draft.stages.length > 100 ||
    draft.stages.reduce((sum, stage) => sum + stage.entries.length, 0) > 1000
  )
    throw new Error(
      "A practice sheet supports up to 100 stages and 1,000 problems.",
    );
  const normalized: TrackImportDraft = {
    id: draft.id,
    title: draft.title.trim(),
    sourceName: draft.sourceName,
    sourceFingerprint: draft.sourceFingerprint,
    ...(draft.shareDescription !== undefined
      ? { shareDescription: draft.shareDescription }
      : {}),
    ...(draft.sourceNotes !== undefined
      ? { sourceNotes: draft.sourceNotes }
      : {}),
    stages: draft.stages.map((stage) => ({
      id: stage.id,
      title: stage.title.trim(),
      description: stage.description,
      suggestedTime: stage.suggestedTime,
      ...(stage.sourceNotes !== undefined
        ? { sourceNotes: stage.sourceNotes }
        : {}),
      entries: stage.entries
        .filter((entry) => !entry.excluded)
        .map((entry) => {
          const identity = trackEntryIdentity(entry);
          if (!identity)
            throw new Error(
              "Correct each unresolved Codeforces problem before saving the track. Enter a recognised ID or supported URL, and make sure both identify the same problem.",
            );
          if (!entry.title.trim())
            throw new Error(
              "Enter a title for each included problem, or explicitly exclude it from this track.",
            );
          if (entryNeedsReview(entry))
            throw new Error(
              "Review each flagged source entry before saving. Check its identity against the source and mark it reviewed, correct its identity, or explicitly exclude it.",
            );
          return {
            id: entry.id,
            title: entry.title.trim(),
            url: identity.url,
            code: identity.code,
            rating: entry.rating,
            pattern: entry.pattern,
            ...(entry.source !== undefined
              ? { source: validateTrackEntrySource(entry.source) }
              : {}),
          };
        }),
    })),
  };
  if (isSharedTrackDraft(normalized))
    normalized.sourceFingerprint = sharedTrackFingerprint(normalized);
  return normalized;
}
function applyDraft(
  data: Data,
  rawDraft: TrackImportDraft,
  existing: Track | undefined,
  now: Date,
): Data {
  const draft = normalizeDraft(rawDraft);
  const createdAt = existing?.createdAt ?? now.toISOString();
  const problems = [...data.problems];
  const previousEntries = new Map(
    data.trackEntries
      ?.filter((entry) => entry.trackId === draft.id)
      .map((entry) => [entry.id, entry]),
  );
  const entries: TrackEntry[] = [];
  const stages: TrackStage[] = draft.stages.map((stage) => {
    for (const entry of stage.entries) {
      const key = entryKey(entry);
      const previous = previousEntries.get(entry.id);
      const preferred =
        previous &&
        problems.find(
          (problem) =>
            problem.id === previous.problemId && sameIdentity(problem, key),
        );
      let problem =
        preferred ??
        problems.find(
          (problem) => !problem.cfHandle && sameIdentity(problem, key),
        ) ??
        problems.find(
          (problem) =>
            profileAvailable(data, problem) && sameIdentity(problem, key),
        );
      if (!problem) {
        problem = newPersonalProblem(problems, entry, createdAt);
        problems.push(problem);
      }
      entries.push({
        ...entry,
        trackId: draft.id,
        stageId: stage.id,
        problemId: problem.id,
      });
    }
    return {
      id: stage.id,
      trackId: draft.id,
      title: stage.title,
      description: stage.description,
      suggestedTime: stage.suggestedTime,
      ...(stage.sourceNotes !== undefined
        ? { sourceNotes: stage.sourceNotes }
        : {}),
      entryIds: stage.entries.map((entry) => entry.id),
    };
  });
  const track: Track = {
    id: draft.id,
    title: draft.title,
    sourceName: existing?.sourceName ?? draft.sourceName,
    sourceFingerprint: isSharedTrackDraft(draft)
      ? draft.sourceFingerprint
      : (existing?.sourceFingerprint ?? draft.sourceFingerprint),
    createdAt,
    stageIds: stages.map((stage) => stage.id),
    ...(draft.shareDescription !== undefined
      ? { shareDescription: draft.shareDescription }
      : {}),
    ...(draft.sourceNotes !== undefined
      ? { sourceNotes: draft.sourceNotes }
      : {}),
  };
  return validateData({
    ...data,
    problems,
    tracks: [
      ...(data.tracks ?? []).filter((value) => value.id !== draft.id),
      track,
    ],
    trackStages: [
      ...(data.trackStages ?? []).filter((value) => value.trackId !== draft.id),
      ...stages,
    ],
    trackEntries: [
      ...(data.trackEntries ?? []).filter(
        (value) => value.trackId !== draft.id,
      ),
      ...entries,
    ],
    activeTrackId: isSharedTrackDraft(draft)
      ? (data.activeTrackId ?? null)
      : (data.activeTrackId ?? draft.id),
  });
}
export function importTrack(
  data: Data,
  draft: TrackImportDraft,
  options: { duplicates: "reject" | "copy" } = { duplicates: "reject" },
  now = new Date(),
): Data {
  // A retained preview is a single operation even after an optimistic failed save.
  const existing = data.tracks?.find((track) => track.id === draft.id);
  if (existing) {
    if (
      JSON.stringify(normalizeDraft(trackDraft(data, draft.id))) ===
      JSON.stringify(normalizeDraft(draft))
    )
      return data;
    // Corrections made to a retained failed preview replace that same operation.
    return applyDraft(data, draft, existing, now);
  }
  if (
    options.duplicates === "reject" &&
    findDuplicateTracks(data, draft).length
  )
    throw new Error(
      "This sheet is already in your tracks. Open it or choose to import a separate copy.",
    );
  return applyDraft(data, draft, undefined, now);
}
export function updateTrack(
  data: Data,
  draft: TrackImportDraft,
  now = new Date(),
): Data {
  const existing = data.tracks?.find((track) => track.id === draft.id);
  if (!existing) throw new Error("This track is no longer available.");
  return applyDraft(data, draft, existing, now);
}
export function removeTrack(data: Data, trackId: string): Data {
  return {
    ...data,
    tracks: (data.tracks ?? []).filter((track) => track.id !== trackId),
    trackStages: (data.trackStages ?? []).filter(
      (stage) => stage.trackId !== trackId,
    ),
    trackEntries: (data.trackEntries ?? []).filter(
      (entry) => entry.trackId !== trackId,
    ),
    activeTrackId: data.activeTrackId === trackId ? null : data.activeTrackId,
  };
}
export function trackContextForEntry(
  data: Data,
  entryId: string,
): TrackContext | null {
  const entry = data.trackEntries?.find((value) => value.id === entryId);
  const track =
    entry && data.tracks?.find((value) => value.id === entry.trackId);
  const stage =
    entry && data.trackStages?.find((value) => value.id === entry.stageId);
  return entry && track && stage
    ? {
        trackId: track.id,
        stageId: stage.id,
        entryId: entry.id,
        trackTitle: track.title,
        stageTitle: stage.title,
      }
    : null;
}
interface ProgressIndex {
  problems: Map<string, Problem[]>;
  history: Map<string, LearningRecord[]>;
}
const progressIndexes = new WeakMap<Data, ProgressIndex>();
function progressIndex(data: Data): ProgressIndex {
  const cached = progressIndexes.get(data);
  if (cached) return cached;
  const problemMap = new Map(
    data.problems.map((problem) => [problem.id, problem]),
  );
  const problems = new Map<string, Problem[]>();
  for (const problem of data.problems) {
    const key = problemIdentity(problem);
    if (key && profileAvailable(data, problem))
      problems.set(key, [...(problems.get(key) ?? []), problem]);
  }
  const history = new Map<string, LearningRecord[]>();
  for (const record of learningHistory(data)) {
    const keys = new Set(
      record.problemIds.flatMap((id) => {
        const problem = problemMap.get(id);
        const key = problem && problemIdentity(problem);
        return key ? [key] : [];
      }),
    );
    for (const key of keys) {
      const group = history.get(key);
      if (group) group.push(record);
      else history.set(key, [record]);
    }
  }
  const index = { problems, history };
  progressIndexes.set(data, index);
  return index;
}
function matchingProblems(data: Data, entry: TrackEntry): Problem[] {
  return progressIndex(data).problems.get(entryKey(entry)) ?? [];
}
export function trackProblem(
  data: Data,
  entry: TrackEntry,
  now = new Date(),
): { problem: Problem; fresh: boolean } {
  const candidates = matchingProblems(data, entry);
  const decision =
    candidates[0] &&
    sharedPracticeState(data, candidates[0], now).codingProblem;
  const problem =
    decision ??
    candidates.find((value) => value.id === entry.problemId) ??
    candidates.find((value) => !value.cfHandle) ??
    candidates[0];
  return problem
    ? { problem, fresh: false }
    : {
        problem: newPersonalProblem(
          data.problems,
          entry,
          data.tracks?.find((track) => track.id === entry.trackId)?.createdAt ??
            now.toISOString(),
        ),
        fresh: true,
      };
}
export interface TrackEntryProgress {
  attempted: boolean;
  notStarted: boolean;
  accepted: boolean;
  reflected: boolean;
  independent: boolean;
  assisted: boolean;
  unsolved: boolean;
  revisitDue: boolean;
  reviewAt: string | null;
  latestOutcome: LearningRecord["outcome"];
  history: LearningRecord[];
  takeaways: string[];
  measuredMinutes: number;
}
export function trackEntryProgress(
  data: Data,
  entry: TrackEntry,
  now = new Date(),
): TrackEntryProgress {
  const key = entryKey(entry);
  const history = progressIndex(data).history.get(key) ?? [];
  const latest = history.find((record) => record.outcome !== null);
  const anchor = matchingProblems(data, entry)[0];
  const state = anchor && sharedPracticeState(data, anchor, now);
  const reviewAt = state && !state.archived ? state.codingAt : null;
  return {
    attempted: history.length > 0,
    notStarted: history.length === 0,
    accepted: history.some((record) => record.accepted === true),
    reflected: !!latest,
    independent: latest?.outcome === "independent",
    assisted: latest?.outcome === "hint" || latest?.outcome === "editorial",
    unsolved: latest?.outcome === "unsolved",
    revisitDue: !!reviewAt && reviewAt <= localDate(now),
    reviewAt,
    latestOutcome: latest?.outcome ?? null,
    history,
    takeaways: [
      ...new Set(
        history
          .filter((record) => record.outcome !== null && record.takeaway.trim())
          .map((record) => record.takeaway),
      ),
    ],
    measuredMinutes: Math.floor(
      history.reduce((sum, record) => sum + (record.elapsedMs ?? 0), 0) / 60000,
    ),
  };
}
export function trackProgress(data: Data, trackId: string, now = new Date()) {
  const entries = trackEntries(data, trackId);
  const progress = entries.map((entry) => ({
    entry,
    progress: trackEntryProgress(data, entry, now),
  }));
  const records = new Map(
    progress.flatMap(({ progress }) =>
      progress.history.map((record) => [record.id, record] as const),
    ),
  );
  const latest = [...records.values()].sort((a, b) =>
    b.completedAt.localeCompare(a.completedAt),
  )[0];
  const timed =
    latest?.timedAttemptId &&
    data.attempts.find((attempt) => attempt.id === latest.timedAttemptId);
  const lastEntry =
    (timed &&
      entries.find((entry) => entry.id === timed.trackContext?.entryId)) ??
    progress.find(({ progress }) =>
      progress.history.some((record) => record.id === latest?.id),
    )?.entry;
  const lastStage =
    lastEntry &&
    data.trackStages?.find((stage) => stage.id === lastEntry.stageId);
  return {
    total: entries.length,
    attempted: progress.filter(({ progress }) => progress.attempted).length,
    accepted: progress.filter(({ progress }) => progress.accepted).length,
    reflected: progress.filter(({ progress }) => progress.reflected).length,
    independent: progress.filter(({ progress }) => progress.independent).length,
    assisted: progress.filter(({ progress }) => progress.assisted).length,
    unsolved: progress.filter(({ progress }) => progress.unsolved).length,
    revisitDue: progress.filter(({ progress }) => progress.revisitDue).length,
    measuredMinutes: Math.floor(
      [...records.values()].reduce(
        (sum, record) => sum + (record.elapsedMs ?? 0),
        0,
      ) / 60000,
    ),
    lastPractised:
      latest && lastEntry && lastStage
        ? {
            entry: lastEntry,
            stage: lastStage,
            completedAt: latest.completedAt,
          }
        : null,
  };
}
export function nextTrackEntry(
  data: Data,
  trackId: string,
  now = new Date(),
  stageId?: string,
): {
  track: Track;
  stage: TrackStage;
  entry: TrackEntry;
  problem: Problem;
  fresh: boolean;
  reason: string;
  revisit: boolean;
} | null {
  const track = data.tracks?.find((value) => value.id === trackId);
  if (!track) return null;
  const candidates = trackEntries(data, trackId)
    .filter((entry) => !stageId || entry.stageId === stageId)
    .map((entry) => ({
      entry,
      progress: trackEntryProgress(data, entry, now),
      ...trackProblem(data, entry, now),
    }))
    .filter(({ problem }) => sharedPracticeState(data, problem, now).eligible);
  const due = candidates
    .filter(({ progress }) => progress.revisitDue)
    .sort((a, b) =>
      a.progress.reviewAt!.localeCompare(b.progress.reviewAt!),
    )[0];
  const selected =
    due ?? candidates.find(({ progress }) => !progress.independent);
  const stage =
    selected &&
    data.trackStages?.find((value) => value.id === selected.entry.stageId);
  if (!selected || !stage) return null;
  const reason = selected.progress.revisitDue
    ? "This revisit is ready. Try the problem again using your existing review schedule."
    : selected.progress.assisted
      ? "Your last solve used assistance. Give this problem another independent try before moving on."
      : selected.progress.unsolved
        ? "Your last attempt was unfinished. Take another look when you have space to explore."
        : selected.progress.accepted
          ? "Accepted on Codeforces; understanding is still unreflected. Try independently or reflect on your activity."
          : selected.progress.attempted
            ? "You have attempted this problem. Give it a deliberate try and capture what you learn."
            : "The next untouched problem in your track's order. Start with the examples and explore the approach.";
  return {
    track,
    stage,
    entry: selected.entry,
    problem: selected.problem,
    fresh: selected.fresh,
    reason,
    revisit: selected.progress.revisitDue,
  };
}
