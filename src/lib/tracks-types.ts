import type { Problem } from "./model";
import { normalizeCodeforcesIdentity } from "./codeforces-identity";

export interface TrackContext {
  trackId: string;
  stageId: string;
  entryId: string;
  trackTitle: string;
  stageTitle: string;
}
export interface Track {
  id: string;
  title: string;
  sourceName: string;
  sourceFingerprint: string;
  createdAt: string;
  stageIds: string[];
}
export interface TrackStage {
  id: string;
  trackId: string;
  title: string;
  description: string;
  suggestedTime: string;
  entryIds: string[];
}
export interface TrackEntry {
  id: string;
  trackId: string;
  stageId: string;
  problemId: string;
  // These are the sheet's metadata, independent of later catalogue metadata.
  title: string;
  url: string;
  code: string;
  rating: number | null;
  pattern: string;
}
export interface TrackImportEntry {
  id: string;
  title: string;
  url: string;
  code: string;
  rating: number | null;
  pattern: string;
}
export interface TrackImportStage {
  id: string;
  title: string;
  description: string;
  suggestedTime: string;
  entries: TrackImportEntry[];
}
export interface TrackImportDraft {
  id: string;
  title: string;
  sourceName: string;
  sourceFingerprint: string;
  stages: TrackImportStage[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const ids = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((id) => text(id, 200, 1)) &&
  new Set(value).size === value.length;
const rating = (value: unknown) =>
  value === null ||
  (typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10000);
const stamp = (value: unknown): value is string =>
  text(value, 40, 10) &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const fail = (): never => {
  throw new Error(
    "Track records have invalid fields, duplicate IDs, or broken stage/problem relationships.",
  );
};

// A historical snapshot deliberately remains valid after a track is removed.
export function validateTrackContext(value: unknown): TrackContext | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value) ||
    !text(value.trackId, 200, 1) ||
    !text(value.stageId, 200, 1) ||
    !text(value.entryId, 200, 1) ||
    !text(value.trackTitle, 240, 1) ||
    !text(value.stageTitle, 240, 1)
  )
    return fail();
  return {
    trackId: value.trackId,
    stageId: value.stageId,
    entryId: value.entryId,
    trackTitle: value.trackTitle,
    stageTitle: value.stageTitle,
  };
}

export function validateTracks(
  input: Record<string, unknown>,
  problems: Problem[],
): {
  tracks: Track[];
  trackStages: TrackStage[];
  trackEntries: TrackEntry[];
  activeTrackId: string | null;
} {
  const rawTracks = input.tracks === undefined ? [] : input.tracks;
  const rawStages = input.trackStages === undefined ? [] : input.trackStages;
  const rawEntries = input.trackEntries === undefined ? [] : input.trackEntries;
  if (
    !Array.isArray(rawTracks) ||
    rawTracks.length > 200 ||
    !Array.isArray(rawStages) ||
    rawStages.length > 2000 ||
    !Array.isArray(rawEntries) ||
    rawEntries.length > 10000
  )
    return fail();
  const tracks: Track[] = rawTracks.map((value) => {
    if (
      !record(value) ||
      !text(value.id, 200, 1) ||
      !text(value.title, 240, 1) ||
      !text(value.sourceName, 240, 1) ||
      !text(value.sourceFingerprint, 200, 1) ||
      !stamp(value.createdAt) ||
      !ids(value.stageIds, 2000) ||
      !value.stageIds.length
    )
      return fail();
    return {
      id: value.id,
      title: value.title,
      sourceName: value.sourceName,
      sourceFingerprint: value.sourceFingerprint,
      createdAt: new Date(value.createdAt).toISOString(),
      stageIds: [...value.stageIds],
    };
  });
  const trackStages: TrackStage[] = rawStages.map((value) => {
    if (
      !record(value) ||
      !text(value.id, 200, 1) ||
      !text(value.trackId, 200, 1) ||
      !text(value.title, 240, 1) ||
      !text(value.description, 5000) ||
      !text(value.suggestedTime, 240) ||
      !ids(value.entryIds, 10000)
    )
      return fail();
    return {
      id: value.id,
      trackId: value.trackId,
      title: value.title,
      description: value.description,
      suggestedTime: value.suggestedTime,
      entryIds: [...value.entryIds],
    };
  });
  const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
  const trackEntries: TrackEntry[] = rawEntries.map((value) => {
    if (
      !record(value) ||
      !text(value.id, 200, 1) ||
      !text(value.trackId, 200, 1) ||
      !text(value.stageId, 200, 1) ||
      !text(value.problemId, 200, 1) ||
      !problemMap.has(value.problemId) ||
      !text(value.title, 240, 1) ||
      !text(value.url, 2000, 1) ||
      !text(value.code, 60, 1) ||
      !/^\d+[A-Z][A-Z0-9]*$/.test(value.code) ||
      !rating(value.rating) ||
      !text(value.pattern, 2000)
    )
      return fail();
    const identity = normalizeCodeforcesIdentity({
      url: value.url,
      code: value.code,
    });
    const problem = problemMap.get(value.problemId)!;
    const normalizedProblem = normalizeCodeforcesIdentity({
      url: problem.url,
      code:
        problem.platform.toLowerCase() === "codeforces"
          ? problem.problemCode
          : "",
    });
    const problemKey = problem.cfKey ?? normalizedProblem?.key;
    if (
      !identity ||
      identity.url !== value.url ||
      identity.code !== value.code ||
      identity.key !== problemKey ||
      (!!problem.cfKey &&
        !!normalizedProblem &&
        problem.cfKey !== normalizedProblem.key)
    )
      return fail();
    return {
      id: value.id,
      trackId: value.trackId,
      stageId: value.stageId,
      problemId: value.problemId,
      title: value.title,
      url: value.url,
      code: value.code,
      rating: value.rating as number | null,
      pattern: value.pattern,
    };
  });
  const trackMap = new Map(tracks.map((value) => [value.id, value]));
  const stageMap = new Map(trackStages.map((value) => [value.id, value]));
  const entryMap = new Map(trackEntries.map((value) => [value.id, value]));
  if (
    trackMap.size !== tracks.length ||
    stageMap.size !== trackStages.length ||
    entryMap.size !== trackEntries.length
  )
    return fail();
  for (const track of tracks)
    for (const id of track.stageIds) {
      if (stageMap.get(id)?.trackId !== track.id) return fail();
    }
  for (const stage of trackStages) {
    if (!trackMap.get(stage.trackId)?.stageIds.includes(stage.id))
      return fail();
    for (const id of stage.entryIds) {
      const entry = entryMap.get(id);
      if (entry?.stageId !== stage.id || entry.trackId !== stage.trackId)
        return fail();
    }
  }
  for (const entry of trackEntries) {
    if (!stageMap.get(entry.stageId)?.entryIds.includes(entry.id))
      return fail();
  }
  const activeTrackId = input.activeTrackId ?? null;
  if (
    !(
      activeTrackId === null ||
      (typeof activeTrackId === "string" && trackMap.has(activeTrackId))
    )
  )
    return fail();
  return { tracks, trackStages, trackEntries, activeTrackId };
}
