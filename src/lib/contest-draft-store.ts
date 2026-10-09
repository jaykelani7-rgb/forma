export type ContestDraftStatus = "unsaved" | "saving" | "saved" | "failed";
export interface RetainedContestDraft<T extends object> {
  source: T;
  baseline: T;
  draft: T;
  conflicts: (keyof T)[];
  status: ContestDraftStatus;
  pending?: Partial<T>;
}

// A tab's unfinished editor text survives route unmounts. The synchronous
// session copy also protects back/reload before debounce; it is not a workspace
// record and cannot confirm reflections or contribute learning evidence.
const retained = new Map<string, unknown>();
const leases = new Map<string, symbol>();
const prefix = "forma.contest-draft.v1:";
const fields = new Set([
  "notes",
  "outcome",
  "difficulty",
  "takeaway",
  "savedAt",
  "mistakes",
  "approach",
  "mistakeNote",
  "wentWell",
  "lostTime",
  "nextChange",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function contestDraftScope(
  workspace: string,
  profile: string | null | undefined,
  contestId: string,
  kind: "scratch" | "reflection" | "overall",
  problemId?: string,
) {
  return JSON.stringify([
    workspace,
    profile?.toLowerCase() ?? null,
    contestId,
    kind,
    problemId ?? null,
  ]);
}

function valid(
  value: unknown,
): value is RetainedContestDraft<Record<string, unknown>> {
  if (
    !record(value) ||
    !Array.isArray(value.conflicts) ||
    !["unsaved", "saving", "saved", "failed"].includes(String(value.status))
  )
    return false;
  return (
    [value.source, value.baseline, value.draft].every(
      (item) =>
        record(item) &&
        Object.entries(item).every(
          ([key, content]) =>
            fields.has(key) &&
            (content === null ||
              typeof content === "string" ||
              (Array.isArray(content) &&
                content.length <= 20 &&
                content.every((v) => typeof v === "string"))) &&
            (typeof content !== "string" || content.length <= 10000),
        ),
    ) &&
    value.conflicts.every(
      (key) => typeof key === "string" && fields.has(key),
    ) &&
    (value.pending === undefined || record(value.pending))
  );
}

export function readContestDraft<T extends object>(
  scope: string,
): RetainedContestDraft<T> | null {
  const cached = retained.get(scope);
  if (cached) return cached as RetainedContestDraft<T>;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(prefix + scope);
    if (!raw || raw.length > 260000) return null;
    const value: unknown = JSON.parse(raw);
    if (!valid(value)) return null;
    // An interrupted save has no authority to claim success after a reload.
    if (value.status === "saving") value.status = "unsaved";
    retained.set(scope, value);
    return value as unknown as RetainedContestDraft<T>;
  } catch {
    return null;
  }
}

export function retainContestDraft<T extends object>(
  scope: string,
  value: RetainedContestDraft<T>,
  lease?: symbol,
) {
  if (lease && leases.get(scope) !== lease) return true;
  const dirty =
    JSON.stringify(value.baseline) !== JSON.stringify(value.draft) ||
    value.conflicts.length > 0;
  if (dirty) retained.set(scope, value);
  else retained.delete(scope);
  if (typeof sessionStorage === "undefined") return true;
  try {
    if (dirty) sessionStorage.setItem(prefix + scope, JSON.stringify(value));
    else sessionStorage.removeItem(prefix + scope);
    return true;
  } catch {
    // Client navigation still retains the in-memory copy when browser storage
    // is unavailable. The editor reports that reload protection is unavailable.
    return false;
  }
}

/** A late save callback from an unmounted editor must not replace a newer
 * mounted editor's retained text for the same record. */
export function claimContestDraft(scope: string) {
  const lease = Symbol(scope);
  leases.set(scope, lease);
  return lease;
}
