import { contestLockedSetup, type PracticeContest } from "./contest-lab";
import { Data, validateData } from "./model";

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export const CAPACITY_LABEL = "64 MB";
export function encodeBackup(
  data: Data,
  metadata: Record<string, unknown> = {},
): string {
  const clean = validateData(data);
  const json = JSON.stringify({ ...clean, ...metadata });
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    throw new Error(
      `This workspace exceeds the supported ${CAPACITY_LABEL} capacity. Records have not been truncated.`,
    );
  }
  return json;
}
export function decodeBackup(json: string): Data {
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES)
    throw new Error(`Choose a Forma backup no larger than ${CAPACITY_LABEL}.`);
  return validateData(JSON.parse(json));
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function identity(v: unknown): string | null {
  if (!object(v)) return null;
  if (typeof v.id === "string" || typeof v.id === "number")
    return `${String(v.handle ?? "").toLowerCase()}:${v.id}`;
  if (typeof v.attemptId === "string") return v.attemptId;
  if (typeof v.timedAttemptId === "string") return v.timedAttemptId;
  if (typeof v.handle === "string") return v.handle.toLowerCase();
  if (typeof v.key === "string") return v.key;
  return null;
}
// Two tabs may create the same deterministic day plan before either has a
// baseline. Equivalent automatic selections adopt the earlier saved snapshot;
// different choices still use the existing explicit conflict/recovery flow.
function equivalentInitialPlans(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const initial = (value: Record<string, unknown>) => {
    if (
      !Array.isArray(value.items) ||
      !value.items.every(
        (item) =>
          object(item) &&
          item.status === "pending" &&
          !item.deliberate &&
          item.decisionAt === undefined,
      )
    )
      return null;
    const out = { ...value };
    delete out.createdAt;
    delete out.updatedAt;
    out.items = value.items.map((item) => {
      const clean = { ...(item as Record<string, unknown>) };
      delete clean.selectedAt;
      return clean;
    });
    return out;
  };
  const left = initial(a),
    right = initial(b);
  return left !== null && right !== null && equal(left, right);
}
export interface MergeResult {
  data: Data;
  conflicts: string[];
}
// Three-way merge: untouched values follow the current revision; disjoint
// fields/identities combine. Simultaneous edits to the same value are explicit.
export function mergeWorkspaces(
  base: Data,
  local: Data,
  remote: Data,
): MergeResult {
  const conflicts: string[] = [];
  function merge(b: unknown, l: unknown, r: unknown, path: string): unknown {
    if (
      ["workspace.practicePlans", "workspace.contests"].includes(path) &&
      b === undefined &&
      Array.isArray(l) &&
      Array.isArray(r)
    )
      b = [];
    if (
      b === undefined &&
      /^workspace\.practicePlans\[[^\]]+\]$/.test(path) &&
      object(l) &&
      object(r) &&
      equivalentInitialPlans(l, r)
    )
      return String(l.createdAt) < String(r.createdAt) ? l : r;
    if (
      /^workspace\.contests\[[^\]]+\]$/.test(path) &&
      object(b) &&
      object(l) &&
      object(r) &&
      b.state === "draft" &&
      ((l.state !== "draft" &&
        r.state === "draft" &&
        !equal(
          contestLockedSetup(b as unknown as PracticeContest),
          contestLockedSetup(r as unknown as PracticeContest),
        )) ||
        (r.state !== "draft" &&
          l.state === "draft" &&
          !equal(
            contestLockedSetup(b as unknown as PracticeContest),
            contestLockedSetup(l as unknown as PracticeContest),
          )))
    ) {
      conflicts.push(`${path}.locked setup`);
      return r;
    }
    if (equal(l, b)) return r;
    if (equal(r, b) || equal(l, r)) return l;
    if (object(b) && object(l) && object(r)) {
      const out: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(b),
        ...Object.keys(l),
        ...Object.keys(r),
      ])) {
        const value = merge(b[key], l[key], r[key], `${path}.${key}`);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    if (
      Array.isArray(b) &&
      Array.isArray(l) &&
      Array.isArray(r) &&
      [...b, ...l, ...r].every((v) => identity(v) !== null)
    ) {
      const maps = [b, l, r].map(
        (items) => new Map(items.map((v) => [identity(v)!, v])),
      );
      return [
        ...new Set([...maps[2].keys(), ...maps[1].keys(), ...maps[0].keys()]),
      ].flatMap((key) => {
        const value = merge(
          maps[0].get(key),
          maps[1].get(key),
          maps[2].get(key),
          `${path}[${key}]`,
        );
        return value === undefined ? [] : [value];
      });
    }
    conflicts.push(path);
    return r;
  }
  const merged = merge(base, local, remote, "workspace");
  try {
    return { data: validateData(merged), conflicts };
  } catch {
    return {
      data: remote,
      conflicts: [...conflicts, "workspace relationships"],
    };
  }
}
