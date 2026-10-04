import { Data, emptyData, validateData } from "./model";
import { encodeBackup, mergeWorkspaces } from "./concurrency";

export type Mode = "personal" | "demo";
export type WorkspaceKey = Mode | `account:${string}`;
export const STORAGE_KEYS = {
  personal: "forma.personal.v1",
  demo: "forma.demo.v1",
  mode: "forma.mode",
  theme: "forma.theme",
};
export interface WorkspaceRevision {
  key: WorkspaceKey;
  revision: number;
  data: Data;
  savedAt: string;
}
export interface Recovery {
  id: string;
  key: WorkspaceKey;
  data: Data;
  createdAt: string;
  reason: string;
}
export interface CommitResult {
  record: WorkspaceRevision;
  conflicts: string[];
  recoveryId?: string;
}
let database: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("forma-workspaces", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspaces", { keyPath: "key" });
      request.result.createObjectStore("recoveries", { keyPath: "id" });
      request.result.createObjectStore("sync", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error);
    };
  }).catch((error) => {
    // IndexedDB can also throw synchronously (for example a privacy/storage
    // restriction). A later explicit restore must be able to retry access.
    database = undefined;
    throw error;
  });
  return database;
}
export async function loadWorkspace(
  key: WorkspaceKey,
  fallback = emptyData(),
): Promise<WorkspaceRevision> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspaces", "readwrite");
    const store = tx.objectStore("workspaces");
    let result: WorkspaceRevision;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        if (request.result)
          result = {
            ...request.result,
            data: validateData(request.result.data),
          };
        else {
          // Keep the original localStorage copy, even after a successful migration.
          const original =
            key === "personal" || key === "demo"
              ? localStorage.getItem(STORAGE_KEYS[key])
              : null;
          const data = original ? validateData(JSON.parse(original)) : fallback;
          encodeBackup(data);
          result = {
            key,
            revision: 1,
            data,
            savedAt: new Date().toISOString(),
          };
          store.put(result);
        }
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error(
            "Migration did not complete. Original records are preserved.",
          ),
      );
  });
}
export async function commitWorkspace(
  key: WorkspaceKey,
  base: WorkspaceRevision,
  proposed: Data,
  replace = false,
): Promise<CommitResult> {
  encodeBackup(proposed);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["workspaces", "recoveries"], "readwrite");
    const store = tx.objectStore("workspaces");
    let result: CommitResult;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const current: WorkspaceRevision = request.result ?? base;
        const merged =
          replace && current.revision !== base.revision
            ? {
                data: current.data,
                conflicts: ["Workspace changed while replacement was pending"],
              }
            : replace
              ? { data: proposed, conflicts: [] }
              : mergeWorkspaces(base.data, proposed, current.data);
        encodeBackup(merged.data);
        const recoveryId =
          merged.conflicts.length || replace ? crypto.randomUUID() : undefined;
        if (recoveryId)
          tx.objectStore("recoveries").put({
            id: recoveryId,
            key,
            data: merged.conflicts.length ? proposed : current.data,
            createdAt: new Date().toISOString(),
            reason: merged.conflicts.join(", ") || "Before backup replacement",
          } satisfies Recovery);
        const record = merged.conflicts.length
          ? current
          : {
              key,
              revision: current.revision + 1,
              data: merged.data,
              savedAt: new Date().toISOString(),
            };
        if (!merged.conflicts.length) store.put(record);
        result = { record, conflicts: merged.conflicts, recoveryId };
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Storage write did not complete."));
  });
}
export async function recoveriesFor(key: WorkspaceKey): Promise<Recovery[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const r = db.transaction("recoveries").objectStore("recoveries").getAll();
    r.onsuccess = () =>
      resolve((r.result as Recovery[]).filter((v) => v.key === key));
    r.onerror = () => reject(r.error);
  });
}
export async function syncMetadata<T>(
  key: WorkspaceKey,
  value?: T,
): Promise<T | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "sync",
      value === undefined ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("sync");
    const r = value === undefined ? store.get(key) : store.put({ key, value });
    let result: T | null = value ?? null;
    r.onsuccess = () => {
      if (value === undefined) result = r.result?.value ?? null;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}
// Read-only legacy recovery helper. New writes always use IndexedDB transactions.
export function loadPersonal(): { data: Data; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.personal);
    return {
      data: raw ? validateData(JSON.parse(raw)) : emptyData(),
      error: null,
    };
  } catch {
    return {
      data: emptyData(),
      error: "Original saved storage could not be read and has been preserved.",
    };
  }
}
export async function preserveRecovery(
  key: WorkspaceKey,
  data: Data,
  reason: string,
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recoveries", "readwrite");
    tx.objectStore("recoveries").put({
      id: crypto.randomUUID(),
      key,
      data,
      reason,
      createdAt: new Date().toISOString(),
    } satisfies Recovery);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
