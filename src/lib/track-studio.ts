import {
  normalizeCodeforcesIdentity,
  type CodeforcesIdentity,
} from "./codeforces-identity";
import type {
  TrackEntrySource,
  TrackImportDraft,
  TrackImportEntry,
  TrackImportStage,
  TrackSourceKind,
} from "./tracks-types";

export const TRACK_STUDIO_LIMITS = {
  maxStages: 100,
  maxProblems: 1000,
  maxTextCharacters: 250000,
  maxSourceLineCharacters: 10000,
} as const;

export interface ExtractedTrackLine {
  text: string;
  kind: TrackSourceKind;
  page?: number;
  location: string;
  links?: string[];
  confidence?: number;
  heading?: boolean;
}

interface DetectedIdentity {
  identity: CodeforcesIdentity;
  raw: string;
}
function detectedIdentities(
  text: string,
  links: readonly string[] = [],
): DetectedIdentity[] {
  const values: DetectedIdentity[] = [];
  for (const raw of [
    ...links,
    ...(text.match(/https?:\/\/[^\s<>"'|]+/gi) ?? []),
  ]) {
    const cleaned = raw.replace(/[),.;]+$/, "");
    const identity = normalizeCodeforcesIdentity(cleaned);
    if (identity) values.push({ identity, raw: cleaned });
  }
  // Boundaries prevent an OCR token such as 38IA or 381AO from supplying a shorter ID.
  const codes = text
    .replace(/https?:\/\/[^\s<>"'|]+/gi, " ")
    .matchAll(
      /(?:^|[^\p{L}\p{N}])((?:(?:CF|Codeforces|Gym)\s*)?\d{1,9}[\s\/-]*[A-Za-z]\d*)(?=$|[^\p{L}\p{N}])/giu,
    );
  for (const match of codes) {
    const raw = match[1];
    const identity = normalizeCodeforcesIdentity(raw);
    if (
      identity &&
      !(
        !/^(?:CF|Codeforces|Gym)\s/i.test(raw) &&
        values.some((value) => value.identity.code === identity.code)
      )
    )
      values.push({ identity, raw });
  }
  return [
    ...new Map(values.map((value) => [value.identity.key, value])).values(),
  ];
}

export function trackEntryIdentity(
  entry: Pick<TrackImportEntry, "code" | "url">,
): CodeforcesIdentity | null {
  const code = entry.code.trim(),
    url = entry.url.trim();
  const fromCode = code ? normalizeCodeforcesIdentity(code) : null;
  const fromUrl = url ? normalizeCodeforcesIdentity(url) : null;
  if ((code && !fromCode) || (url && !fromUrl)) return null;
  if (fromCode && fromUrl && fromCode.code !== fromUrl.code) return null;
  // A code has no namespace unless the user wrote an explicit Gym prefix.
  if (
    fromCode &&
    fromUrl &&
    /^gym\s/i.test(code) &&
    fromCode.key !== fromUrl.key
  )
    return null;
  return fromUrl ?? fromCode;
}

/** Source text remains immutable; a deliberate identity correction can resolve its warning. */
export function entryNeedsReview(entry: TrackImportEntry): boolean {
  if (
    entry.excluded ||
    entry.reviewed ||
    !entry.source ||
    (entry.source.kind !== "ocr" && !entry.source.reviewReasons?.length)
  )
    return false;
  const current = trackEntryIdentity(entry);
  // Ambiguous rows start without an identity. Entering a single valid one is a
  // deliberate correction, even when that code already appeared in the source.
  if (
    current &&
    entry.source.reviewReasons?.some((reason) =>
      reason.startsWith("More than one Codeforces identity"),
    )
  )
    return false;
  const original = detectedIdentities(
    entry.source.text,
    entry.source.reviewReasons?.flatMap((reason) =>
      reason.startsWith("Detected identity:")
        ? (reason.match(/https?:\/\/\S+/g) ?? [])
        : [],
    ) ?? [],
  );
  // A source that had no recoverable identity was explicitly repaired by entering one.
  if (
    current &&
    (original.length === 0 ||
      !original.some(({ identity }) => identity.key === current.key))
  )
    return false;
  return true;
}

export function trackDraftReview(draft: TrackImportDraft) {
  const all = draft.stages.flatMap((stage) => stage.entries);
  const included = all.filter((entry) => !entry.excluded);
  const unresolved = included.filter(
    (entry) =>
      !entry.title.trim() ||
      entry.title.trim().length > 240 ||
      !trackEntryIdentity(entry),
  );
  const needsReview = included.filter(entryNeedsReview);
  const seen = new Set<string>();
  const duplicates = included.filter((entry) => {
    const key = trackEntryIdentity(entry)?.key;
    if (!key) return false;
    const duplicate = seen.has(key);
    seen.add(key);
    return duplicate;
  });
  return {
    total: all.length,
    included: included.length,
    excluded: all.length - included.length,
    unresolved,
    duplicates,
    needsReview,
    unresolvedCount: unresolved.length,
    duplicateCount: duplicates.length,
    reviewRequiredCount: needsReview.length,
    excludedCount: all.length - included.length,
  };
}
export const analyzeTrackDraft = trackDraftReview;

export function createManualEntry(): TrackImportEntry {
  return {
    id: crypto.randomUUID(),
    title: "",
    code: "",
    url: "",
    rating: null,
    pattern: "",
    source: { kind: "manual", location: "Manually added problem", text: "" },
  };
}
export function createManualStage(title = "Untitled stage"): TrackImportStage {
  return {
    id: crypto.randomUUID(),
    title,
    description: "",
    suggestedTime: "",
    entries: [],
  };
}
export function createManualTrackDraft(): TrackImportDraft {
  const id = crypto.randomUUID();
  return {
    id,
    title: "My practice track",
    sourceName: "Manual track",
    sourceFingerprint: `manual:${id}`,
    stages: [],
  };
}

function fingerprintText(text: string) {
  let first = 2166136261,
    second = 5381;
  for (const character of text) {
    first = Math.imul(first ^ character.charCodeAt(0), 16777619);
    second = Math.imul(second, 33) ^ character.charCodeAt(0);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}:${text.length}`;
}

function titleFor(
  text: string,
  identity: CodeforcesIdentity | undefined,
): string {
  const cleaned = text.trim().replace(/^\s*\d+[.)]\s*/, "");
  if (!identity) return cleaned;
  let title = cleaned.replace(/https?:\/\/[^\s<>"'|]+/gi, "").trim();
  const prefix = title.match(
    /^((?:(?:CF|Codeforces|Gym)\s*)?\d{1,9}[\s\/-]*[A-Za-z]\d*)\s*(?:[—–:|\-]\s*|\s+)?(.*)$/i,
  );
  if (prefix && normalizeCodeforcesIdentity(prefix[1])?.code === identity.code)
    title = prefix[2].trim();
  // Explicit labelled metadata is evidence, rather than a guessed rating or pattern.
  title = title
    .replace(/\s*\|?\s*(?:rating|pattern|hint)\s*:\s*.*$/i, "")
    .replace(/^[—–:|\-\s]+|[—–:|\-\s]+$/g, "");
  return title || identity.code;
}

export function parseExtractedTrack(
  lines: readonly ExtractedTrackLine[],
  sourceName: string,
  sourceFingerprint: string,
): TrackImportDraft {
  if (
    !sourceName.trim() ||
    sourceName.length > 240 ||
    !sourceFingerprint ||
    sourceFingerprint.length > 200
  )
    throw new Error(
      "Use a source name up to 240 characters and a valid source fingerprint.",
    );
  if (
    lines.reduce((sum, line) => sum + line.text.length, 0) >
    TRACK_STUDIO_LIMITS.maxTextCharacters
  )
    throw new Error(
      "This extraction contains more than 250,000 text characters. Split it into smaller sheets.",
    );
  const stages: TrackImportStage[] = [];
  let current: TrackImportStage | undefined;
  let total = 0;
  const append = (line: ExtractedTrackLine, identities: DetectedIdentity[]) => {
    if (++total > TRACK_STUDIO_LIMITS.maxProblems)
      throw new Error(
        "A track supports up to 1,000 detected problems. Split the source into smaller sheets.",
      );
    if (!current) {
      current = createManualStage("Ungrouped");
      stages.push(current);
    }
    const identity =
      identities.length === 1 ? identities[0].identity : undefined;
    const reviewReasons: string[] = [];
    if (!identity)
      reviewReasons.push(
        identities.length > 1
          ? "More than one Codeforces identity appears in this row. Choose the intended problem or split it into individual entries."
          : "No recoverable Codeforces identity was found. Enter the problem ID or URL from the source.",
      );
    if (line.kind === "ocr")
      reviewReasons.push(
        "OCR can confuse characters. Check the problem identity against the source before saving.",
      );
    if (line.kind === "ocr" && identity)
      reviewReasons.push(
        `Detected identity: ${identity.url}. Verify it against the source.`,
      );
    if (
      line.kind === "ocr" &&
      line.confidence !== undefined &&
      line.confidence < 85
    )
      reviewReasons.push(
        "The OCR confidence is low. Review the extracted title and identity carefully.",
      );
    const numeric = line.text.match(/\brating\s*:\s*(\d{1,5})\b/i)?.[1];
    // An annotation may contradict the printed ID without appearing in the
    // extracted text. Preserve that actual target alongside the original row so
    // the review can compare both sources before choosing an identity.
    const annotationEvidence =
      identities.length > 1
        ? [
            ...new Set(
              (line.links ?? []).filter(
                (link) =>
                  !!normalizeCodeforcesIdentity(link) &&
                  !line.text.includes(link),
              ),
            ),
          ]
        : [];
    const sourceText = [
      line.text,
      ...annotationEvidence.map((link) => `Hyperlink: ${link}`),
    ].join("\n");
    if (sourceText.length > TRACK_STUDIO_LIMITS.maxSourceLineCharacters)
      throw new Error(
        "A source row and its hyperlink evidence exceed 10,000 characters. Split this sheet into smaller sections and try again.",
      );
    const source: TrackEntrySource = {
      kind: line.kind,
      location: line.location,
      text: sourceText,
      ...(line.page !== undefined ? { page: line.page } : {}),
      ...(line.confidence !== undefined ? { confidence: line.confidence } : {}),
      ...(reviewReasons.length ? { reviewReasons } : {}),
    };
    current.entries.push({
      id: crypto.randomUUID(),
      title: titleFor(line.text, identity),
      code: identity?.code ?? "",
      url: identity?.url ?? "",
      rating:
        numeric !== undefined && Number(numeric) <= 10000
          ? Number(numeric)
          : null,
      pattern:
        line.text.match(/\b(?:pattern|hint)\s*:\s*(.*)$/i)?.[1]?.trim() ?? "",
      source,
    });
  };
  for (const line of lines) {
    if (!line.text.trim() && !line.links?.length) continue;
    if (line.text.length > TRACK_STUDIO_LIMITS.maxSourceLineCharacters)
      throw new Error(
        "A source line exceeds 10,000 characters. Split this source into smaller sections.",
      );
    const text = line.text.trim();
    const stage =
      text.match(
        /^Stage\s*(?:\d+|[IVX]+)(?=\s|[:.\-–—]|$)\s*(?:[:.\-–—]\s*)?(.*)$/i,
      ) ?? text.match(/^Stage\s*:\s*(.+)$/i);
    if (stage) {
      if (stages.length >= TRACK_STUDIO_LIMITS.maxStages)
        throw new Error(
          "A track supports up to 100 stages. Split this source into smaller tracks.",
        );
      current = createManualStage(stage[1].trim() || text);
      stages.push(current);
      continue;
    }
    // Only explicit source labels/table headers are metadata. An arbitrary title-only row is retained.
    const identities = detectedIdentities(text, line.links);
    const cells = text.split("|").map((cell) => cell.trim());
    if (
      !identities.length &&
      cells.length > 1 &&
      cells.every((cell) =>
        /^(?:#|no\.?|number|problem(?:\s+(?:id|code|name|title))?|id|code|title|name|rating|difficulty|main pattern|pattern|hint|topic)$/i.test(
          cell,
        ),
      )
    )
      continue;
    // A pure pasted list can have several IDs on one line. Keep each, including duplicates.
    if (line.kind === "paste") {
      const tokens = text
        .split(/[,;|\t]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        tokens.length > 1 &&
        tokens.every((value) => normalizeCodeforcesIdentity(value))
      ) {
        tokens.forEach((value, index) =>
          append(
            {
              ...line,
              text: value,
              location: `${line.location}, item ${index + 1}`,
            },
            detectedIdentities(value),
          ),
        );
        continue;
      }
      const spaceTokens = text.split(/\s+/);
      if (
        spaceTokens.length > 1 &&
        spaceTokens.every((value) => normalizeCodeforcesIdentity(value))
      ) {
        spaceTokens.forEach((value, index) =>
          append(
            {
              ...line,
              text: value,
              location: `${line.location}, item ${index + 1}`,
            },
            detectedIdentities(value),
          ),
        );
        continue;
      }
    }
    append(line, identities);
  }
  return {
    id: crypto.randomUUID(),
    title: sourceName.replace(/\.[^.]+$/, ""),
    sourceName,
    sourceFingerprint,
    stages,
  };
}

export function parsePastedProblems(text: string): TrackImportDraft {
  if (text.length > TRACK_STUDIO_LIMITS.maxTextCharacters)
    throw new Error(
      "Paste up to 250,000 characters at a time, or split the list into smaller batches.",
    );
  return parseExtractedTrack(
    text.split(/\r?\n/).map((value, index) => ({
      text: value,
      kind: "paste",
      location: `Pasted line ${index + 1}`,
    })),
    "Pasted practice problems",
    `paste:${fingerprintText(text)}`,
  );
}
export function addPastedEntries(
  draft: TrackImportDraft,
  stageId: string,
  text: string,
): TrackImportDraft {
  if (!draft.stages.some((stage) => stage.id === stageId))
    throw new Error("Choose a stage before adding pasted problems.");
  const entries = parsePastedProblems(text).stages.flatMap(
    (stage) => stage.entries,
  );
  return {
    ...draft,
    stages: draft.stages.map((stage) =>
      stage.id === stageId
        ? { ...stage, entries: [...stage.entries, ...entries] }
        : stage,
    ),
  };
}
