import type { Data, Problem } from "./model";
import { canonicalProblemIdentity } from "./codeforces-identity";
import { trackDraftReview, trackEntryIdentity } from "./track-studio";
import type {
  Track,
  TrackEntry,
  TrackStage,
  TrackImportDraft,
  TrackImportEntry,
} from "./tracks-types";

export const SHARED_TRACK_FORMAT = "forma-track";
export const SHARED_TRACK_VERSION = 1;
export const SHARED_TRACK_EXTENSION = ".forma-track.json";
export const SHARED_TRACK_FINGERPRINT_PREFIX = "shared-track-v1:";
export const SHARED_TRACK_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxStages: 100,
  maxProblems: 1000,
  maxTitleCharacters: 240,
  maxDescriptionCharacters: 5000,
  maxSuggestedTimeCharacters: 240,
  maxHintCharacters: 2000,
  maxCodeCharacters: 60,
  maxURLCharacters: 2000,
} as const;

export interface SharedTrackProblem {
  title: string;
  code: string;
  url: string;
  rating: number | null;
  hint?: string;
}
export interface SharedTrackFile {
  format: typeof SHARED_TRACK_FORMAT;
  version: typeof SHARED_TRACK_VERSION;
  track: {
    title: string;
    shareDescription?: string;
    stages: {
      title: string;
      description?: string;
      suggestedTime: string;
      problems: SharedTrackProblem[];
    }[];
  };
}
export interface SharedTrackExportOptions {
  includeDescriptions?: boolean;
  includeHints?: boolean;
  /** Only explicitly supplied text can override the stored share description. */
  shareDescription?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(
      "Shared track fields must contain only curriculum content.",
    );
}
function text(
  value: unknown,
  maximum: number,
  label: string,
  required = false,
) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim())
  )
    throw new Error(
      `${label} must be ${required ? "nonempty " : ""}text up to ${maximum.toLocaleString("en-US")} characters.`,
    );
  return value.trim().normalize("NFC");
}
function optionalText(value: unknown, maximum: number, label: string) {
  return value === undefined ? "" : text(value, maximum, label);
}
function safeURL(value: unknown) {
  const url = optionalText(
    value,
    SHARED_TRACK_LIMITS.maxURLCharacters,
    "Problem URL",
  );
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (
      ["https:", "http:"].includes(parsed.protocol) &&
      /^(www\.)?codeforces\.com$/i.test(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      /^\/(?:problemset\/problem\/|contest\/|gym\/)/i.test(parsed.pathname)
    )
      return url;
  } catch {
    /* Preserve no unsafe or arbitrary destination. */
  }
  throw new Error(
    "Use a safe Codeforces problem URL without credentials or a custom port. Other destinations are not imported.",
  );
}
function isWorkspaceBackup(value: Record<string, unknown>) {
  return (
    value.schemaVersion !== undefined ||
    value.codeforces !== undefined ||
    value.attempts !== undefined ||
    value.problems !== undefined ||
    (record(value.data) && value.data.schemaVersion !== undefined)
  );
}
function document(value: unknown): SharedTrackFile {
  if (!record(value))
    throw new Error("Choose a valid Forma shared track JSON file.");
  if (isWorkspaceBackup(value))
    throw new Error(
      "This is a private workspace backup. Restore it in Settings instead of importing it as a shared track.",
    );
  if (value.format !== SHARED_TRACK_FORMAT)
    throw new Error(
      "This file is not a Forma shared track. Choose a .forma-track.json file.",
    );
  if (value.version !== SHARED_TRACK_VERSION)
    throw new Error(
      "This shared track version is not supported. Forma supports version 1.",
    );
  fields(value, ["format", "version", "track", "exportedAt"]);
  if (
    value.exportedAt !== undefined &&
    (typeof value.exportedAt !== "string" ||
      value.exportedAt.length > 40 ||
      !Number.isFinite(Date.parse(value.exportedAt)))
  )
    throw new Error("The shared track export time is malformed.");
  if (!record(value.track))
    throw new Error("A shared track must contain its curriculum.");
  fields(value.track, ["title", "shareDescription", "stages"]);
  const title = text(value.track.title, 240, "Track title", true),
    shareDescription = optionalText(
      value.track.shareDescription,
      5000,
      "Share description",
    );
  if (
    !Array.isArray(value.track.stages) ||
    value.track.stages.length > SHARED_TRACK_LIMITS.maxStages
  )
    throw new Error("A shared track supports up to 100 ordered stages.");
  let membershipCount = 0;
  const stages = value.track.stages.map((stage) => {
    if (!record(stage))
      throw new Error("Each shared track stage must be an object.");
    fields(stage, ["title", "description", "suggestedTime", "problems"]);
    if (!Array.isArray(stage.problems))
      throw new Error("Each stage must contain an ordered problems list.");
    membershipCount += stage.problems.length;
    if (membershipCount > SHARED_TRACK_LIMITS.maxProblems)
      throw new Error(
        "A shared track supports up to 1,000 problem memberships.",
      );
    const description = optionalText(
      stage.description,
      5000,
      "Stage description",
    );
    return {
      title: text(stage.title, 240, "Stage title", true),
      ...(description ? { description } : {}),
      suggestedTime: optionalText(
        stage.suggestedTime,
        240,
        "Suggested practice time",
      ),
      problems: stage.problems.map((problem) => {
        if (!record(problem))
          throw new Error("Each shared problem membership must be an object.");
        fields(problem, ["title", "code", "url", "rating", "hint"]);
        if (
          !(
            problem.rating === undefined ||
            problem.rating === null ||
            (typeof problem.rating === "number" &&
              Number.isInteger(problem.rating) &&
              problem.rating >= 0 &&
              problem.rating <= 10000)
          )
        )
          throw new Error(
            "A source rating must be an integer from 0 to 10,000, or null.",
          );
        const hint = optionalText(problem.hint, 2000, "Pattern hint");
        return {
          title: text(problem.title, 240, "Problem title", true),
          code: optionalText(problem.code, 60, "Problem ID"),
          url: safeURL(problem.url),
          rating: (problem.rating ?? null) as number | null,
          ...(hint ? { hint } : {}),
        };
      }),
    };
  });
  return {
    format: SHARED_TRACK_FORMAT,
    version: SHARED_TRACK_VERSION,
    track: { title, ...(shareDescription ? { shareDescription } : {}), stages },
  };
}
interface CurriculumIndex {
  tracks: Map<string, Track>;
  stages: Map<string, TrackStage>;
  entries: Map<string, TrackEntry>;
}
function curriculumIndex(data: Data): CurriculumIndex {
  return {
    tracks: new Map(data.tracks?.map((track) => [track.id, track])),
    stages: new Map(data.trackStages?.map((stage) => [stage.id, stage])),
    entries: new Map(data.trackEntries?.map((entry) => [entry.id, entry])),
  };
}
function localDraft(
  data: Data,
  id: string,
  index = curriculumIndex(data),
): TrackImportDraft {
  const track = index.tracks.get(id);
  if (!track) throw new Error("This track is no longer available.");
  const { stages, entries } = index;
  return {
    id: track.id,
    title: track.title,
    sourceName: track.sourceName,
    sourceFingerprint: track.sourceFingerprint,
    ...(track.shareDescription !== undefined
      ? { shareDescription: track.shareDescription }
      : {}),
    stages: track.stageIds.map((stageId) => {
      const stage = stages.get(stageId);
      if (!stage)
        throw new Error(
          "This track has a missing stage. Restore its saved curriculum before sharing.",
        );
      return {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        suggestedTime: stage.suggestedTime,
        entries: stage.entryIds.map((entryId) => {
          const entry = entries.get(entryId);
          if (!entry)
            throw new Error(
              "This track has a missing membership. Restore its saved curriculum before sharing.",
            );
          return {
            id: entry.id,
            title: entry.title,
            code: entry.code,
            url: entry.url,
            rating: entry.rating,
            pattern: entry.pattern,
          };
        }),
      };
    }),
  };
}
/** Explicit curriculum allowlist. No workspace/source evidence object is serialized. */
export function sharedTrackFromTrack(
  data: Data,
  id: string,
  options: SharedTrackExportOptions = {},
): SharedTrackFile {
  const draft = localDraft(data, id);
  const shareDescription =
    options.shareDescription ??
    (options.includeDescriptions ? draft.shareDescription : undefined);
  return document({
    format: SHARED_TRACK_FORMAT,
    version: SHARED_TRACK_VERSION,
    track: {
      title: draft.title,
      ...(shareDescription ? { shareDescription } : {}),
      stages: draft.stages.map((stage) => ({
        title: stage.title,
        ...(options.includeDescriptions && stage.description
          ? { description: stage.description }
          : {}),
        suggestedTime: stage.suggestedTime,
        problems: stage.entries.map((entry) => {
          const identity = trackEntryIdentity(entry);
          if (!identity)
            throw new Error(
              "Correct each unresolved identity before sharing this track.",
            );
          return {
            title: entry.title,
            code: identity.code,
            url: identity.url,
            rating: entry.rating,
            ...(options.includeHints && entry.pattern
              ? { hint: entry.pattern }
              : {}),
          };
        }),
      })),
    },
  });
}
export function encodeSharedTrack(value: SharedTrackFile): string {
  const json = JSON.stringify(document(value), null, 2) + "\n";
  if (
    new TextEncoder().encode(json).byteLength > SHARED_TRACK_LIMITS.maxFileBytes
  )
    throw new Error(
      "A shared track file must be no larger than 5 MB. Exclude optional text or split the curriculum.",
    );
  return json;
}
export function sharedTrackFilename(title: string) {
  const stem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/g, "")
    .toLowerCase();
  return `${stem || "forma-track"}${SHARED_TRACK_EXTENSION}`;
}

const normalizedText = (value: string) => value.trim().normalize("NFC");
function curriculum(draft: TrackImportDraft) {
  return JSON.stringify({
    title: normalizedText(draft.title),
    shareDescription: normalizedText(draft.shareDescription ?? ""),
    stages: draft.stages.map((stage) => ({
      title: normalizedText(stage.title),
      description: normalizedText(stage.description),
      suggestedTime: normalizedText(stage.suggestedTime),
      problems: stage.entries
        .filter((entry) => !entry.excluded)
        .map((entry) => {
          const identity = trackEntryIdentity(entry);
          return {
            identity: identity?.key ?? null,
            ...(identity
              ? {}
              : {
                  code: normalizedText(entry.code),
                  url: normalizedText(entry.url),
                }),
            title: normalizedText(entry.title),
            rating: entry.rating,
            hint: normalizedText(entry.pattern),
          };
        }),
    })),
  });
}
export function sharedTrackFingerprint(draft: TrackImportDraft) {
  return fingerprint(curriculum(draft));
}
function fingerprint(normalized: string) {
  let first = 2166136261,
    second = 3339675911;
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${SHARED_TRACK_FINGERPRINT_PREFIX}${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
export function isSharedTrackDraft(
  draft: Pick<TrackImportDraft, "sourceFingerprint">,
) {
  return draft.sourceFingerprint.startsWith(SHARED_TRACK_FINGERPRINT_PREFIX);
}
/** Hashes are only a quick filter; exact normalized curriculum prevents collision-based duplicates. */
const savedCurricula = new WeakMap<
  Data,
  { track: Track; normalized: string; fingerprint: string }[]
>();
export function findEquivalentSharedTracks(
  data: Data,
  draft: TrackImportDraft,
): Track[] {
  const normalized = curriculum(draft),
    hash = fingerprint(normalized);
  let saved = savedCurricula.get(data);
  if (!saved) {
    // Workspace updates return a new Data object, so edits invalidate this index.
    // Build the flat record maps once rather than once for every saved track.
    const index = curriculumIndex(data);
    saved = (data.tracks ?? []).map((track) => {
      const normalized = curriculum(localDraft(data, track.id, index));
      return { track, normalized, fingerprint: fingerprint(normalized) };
    });
    savedCurricula.set(data, saved);
  }
  return saved
    .filter(
      (entry) => entry.fingerprint === hash && entry.normalized === normalized,
    )
    .map((entry) => entry.track);
}
export function parseSharedTrack(json: string): TrackImportDraft {
  if (
    new TextEncoder().encode(json).byteLength > SHARED_TRACK_LIMITS.maxFileBytes
  )
    throw new Error("Choose a shared track file no larger than 5 MB.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Choose a valid Forma shared track JSON file.");
  }
  const file = document(value);
  const draft: TrackImportDraft = {
    id: crypto.randomUUID(),
    title: file.track.title,
    sourceName: "Shared track file",
    sourceFingerprint: "",
    ...(file.track.shareDescription !== undefined
      ? { shareDescription: file.track.shareDescription }
      : {}),
    stages: file.track.stages.map((stage) => ({
      id: crypto.randomUUID(),
      title: stage.title,
      description: stage.description ?? "",
      suggestedTime: stage.suggestedTime,
      entries: stage.problems.map((problem) => {
        const entry: TrackImportEntry = {
          id: crypto.randomUUID(),
          title: problem.title,
          code: problem.code,
          url: problem.url,
          rating: problem.rating,
          pattern: problem.hint ?? "",
        };
        const identity = trackEntryIdentity(entry);
        return identity
          ? { ...entry, code: identity.code, url: identity.url }
          : entry;
      }),
    })),
  };
  draft.sourceFingerprint = sharedTrackFingerprint(draft);
  return draft;
}
export async function readSharedTrackFile(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<TrackImportDraft> {
  if (file.size > SHARED_TRACK_LIMITS.maxFileBytes)
    throw new Error("Choose a shared track file no larger than 5 MB.");
  const { signal } = options;
  if (signal?.aborted)
    throw new DOMException("Shared track import cancelled.", "AbortError");
  const json = await new Promise<string>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Shared track import cancelled.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    void file.text().then(
      (result) => {
        signal?.removeEventListener("abort", abort);
        if (!signal?.aborted) resolve(result);
      },
      () => {
        signal?.removeEventListener("abort", abort);
        reject(new Error("This shared track file could not be read."));
      },
    );
  });
  if (signal?.aborted)
    throw new DOMException("Shared track import cancelled.", "AbortError");
  return parseSharedTrack(json);
}
function available(data: Data, problem: Problem) {
  return (
    !problem.cfHandle ||
    problem.cfHandle.toLowerCase() ===
      data.codeforces.connectedHandle?.toLowerCase()
  );
}
export function sharedTrackPreview(data: Data, draft: TrackImportDraft) {
  let identities = availableIdentities.get(data);
  if (!identities) {
    identities = new Set(
      data.problems
        .filter((problem) => available(data, problem))
        .flatMap((problem) => canonicalProblemIdentity(problem) ?? []),
    );
    availableIdentities.set(data, identities);
  }
  const review = trackDraftReview(draft);
  const matching = draft.stages
    .flatMap((stage) => stage.entries)
    .filter(
      (entry) =>
        !entry.excluded && identities.has(trackEntryIdentity(entry)?.key ?? ""),
    );
  return {
    stageCount: draft.stages.length,
    problemCount: review.included,
    alreadyPresentCount: matching.length,
    alreadyPresentIdentities: [
      ...new Set(matching.map((entry) => trackEntryIdentity(entry)!.key)),
    ],
    unresolvedCount: review.unresolvedCount,
    duplicateCount: review.duplicateCount,
  };
}
const availableIdentities = new WeakMap<Data, Set<string>>();
