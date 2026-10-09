import type { Problem } from "./model";
import {
  canonicalProblemIdentity,
  normalizeCodeforcesIdentity,
} from "./codeforces-identity";

export type TrackSourceKind = "docx" | "pdf-text" | "ocr" | "paste" | "manual";
export interface TrackEntrySource {
  kind: TrackSourceKind;
  page?: number;
  location: string;
  text: string;
  confidence?: number;
  reviewReasons?: string[];
}

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
  sourceNotes?: string;
  shareDescription?: string;
}
export interface TrackStage {
  id: string;
  trackId: string;
  title: string;
  description: string;
  suggestedTime: string;
  entryIds: string[];
  sourceNotes?: string;
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
  source?: TrackEntrySource;
}
export interface TrackImportEntry {
  id: string;
  title: string;
  url: string;
  code: string;
  rating: number | null;
  pattern: string;
  source?: TrackEntrySource;
  /** Only an explicit exclusion removes a detected candidate from saved membership. */
  excluded?: boolean;
  reviewed?: boolean;
}
export interface TrackImportStage {
  id: string;
  title: string;
  description: string;
  suggestedTime: string;
  entries: TrackImportEntry[];
  sourceNotes?: string;
}
export interface TrackImportDraft {
  id: string;
  title: string;
  sourceName: string;
  sourceFingerprint: string;
  stages: TrackImportStage[];
  sourceNotes?: string;
  shareDescription?: string;
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

export function validateTrackEntrySource(
  value: unknown,
): TrackEntrySource | undefined {
  if (value === undefined) return undefined;
  if (
    !record(value) ||
    !["docx", "pdf-text", "ocr", "paste", "manual"].includes(
      value.kind as string,
    ) ||
    !text(value.location, 500, 1) ||
    !text(value.text, 10000) ||
    !(
      value.page === undefined ||
      (Number.isInteger(value.page) &&
        Number(value.page) >= 1 &&
        Number(value.page) <= 10000)
    ) ||
    !(
      value.confidence === undefined ||
      (typeof value.confidence === "number" &&
        Number.isFinite(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 100)
    ) ||
    !(
      value.reviewReasons === undefined ||
      (Array.isArray(value.reviewReasons) &&
        value.reviewReasons.length <= 20 &&
        value.reviewReasons.every((reason) => text(reason, 500, 1)))
    )
  )
    return fail();
  return {
    kind: value.kind as TrackSourceKind,
    location: value.location,
    text: value.text,
    ...(value.page !== undefined ? { page: value.page as number } : {}),
    ...(value.confidence !== undefined
      ? { confidence: value.confidence as number }
      : {}),
    ...(value.reviewReasons !== undefined
      ? { reviewReasons: [...value.reviewReasons] as string[] }
      : {}),
  };
}

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
      !(value.sourceNotes === undefined || text(value.sourceNotes, 5000)) ||
      !(
        value.shareDescription === undefined ||
        text(value.shareDescription, 5000)
      )
    )
      return fail();
    return {
      id: value.id,
      title: value.title,
      sourceName: value.sourceName,
      sourceFingerprint: value.sourceFingerprint,
      createdAt: new Date(value.createdAt).toISOString(),
      stageIds: [...value.stageIds],
      ...(value.sourceNotes !== undefined
        ? { sourceNotes: value.sourceNotes as string }
        : {}),
      ...(value.shareDescription !== undefined
        ? { shareDescription: value.shareDescription as string }
        : {}),
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
      !ids(value.entryIds, 10000) ||
      !(value.sourceNotes === undefined || text(value.sourceNotes, 5000))
    )
      return fail();
    return {
      id: value.id,
      trackId: value.trackId,
      title: value.title,
      description: value.description,
      suggestedTime: value.suggestedTime,
      entryIds: [...value.entryIds],
      ...(value.sourceNotes !== undefined
        ? { sourceNotes: value.sourceNotes as string }
        : {}),
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
    const problemKey = canonicalProblemIdentity(problem);
    if (
      !identity ||
      identity.url !== value.url ||
      identity.code !== value.code ||
      identity.key !== problemKey
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
      ...(value.source !== undefined
        ? { source: validateTrackEntrySource(value.source) }
        : {}),
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
