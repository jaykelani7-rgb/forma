import { emptyData, type Data, encodeBackup, mergeWorkspaces } from "../../core/src/index";

export interface SyncRevision<K extends string = string> { key: K; revision: number; data: Data; savedAt: string }
export interface SyncStorage<K extends string = string> {
  load(key: K): Promise<SyncRevision<K>>;
  commit(key: K, base: SyncRevision<K>, proposed: Data): Promise<{ record: SyncRevision<K>; conflicts: string[] }>;
  preserveRecovery(key: K, data: Data, reason: string): Promise<unknown>;
  readCheckpoint(key: K): Promise<SyncCheckpoint | null | undefined>;
  writeCheckpoint(key: K, checkpoint: SyncCheckpoint): Promise<unknown>;
}
export interface SyncLock<K extends string = string> {
  exclusive<T>(key: K, operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface CloudRevision {
  revision: number;
  data: Data | null;
}
interface PendingWrite {
  operationId: string;
  baseRevision: number;
  data: Data;
}
export interface SyncCheckpoint {
  base: CloudRevision;
  pending?: PendingWrite;
}
export interface CloudTransport {
  read(): Promise<CloudRevision>;
  write(write: PendingWrite): Promise<CloudRevision>;
}
export class CloudConflict extends Error {}
export function reconcileCloud(
  base: Data | null,
  local: Data,
  remote: Data | null,
) {
  return mergeWorkspaces(base ?? emptyData(), local, remote ?? emptyData());
}
// Persist the operation UUID before sending. An uncertain network response can
// replay the identical request safely. Local edits made during the request are
// reconciled transactionally instead of overwritten by the acknowledgement.
async function performAccountSync<K extends string>(
  storage: SyncStorage<K>,
  key: K,
  transport: CloudTransport,
  signal?: AbortSignal,
  operationId: () => string = () => crypto.randomUUID(),
): Promise<CloudRevision> {
  if (!key.startsWith("account:"))
    throw new Error("Only an application account workspace can sync.");
  signal?.throwIfAborted();
  let checkpoint = await storage.readCheckpoint(key);
  if (checkpoint?.pending) {
    try {
      signal?.throwIfAborted();
      const acknowledged = await transport.write(checkpoint.pending);
      signal?.throwIfAborted();
      const snapshot = await storage.load(key);
      const merged = reconcileCloud(
        checkpoint.pending.data,
        snapshot.data,
        acknowledged.data,
      );
      if (merged.conflicts.length) {
        if (acknowledged.data)
          await storage.preserveRecovery(
            key,
            acknowledged.data,
            "Cloud acknowledgement conflicts with local edits",
          );
        throw new CloudConflict(
          "Cloud and local edits conflict. Both copies are preserved; review recovery copies in Settings.",
        );
      }
      signal?.throwIfAborted();
      const saved = await storage.commit(key, snapshot, merged.data);
      if (saved.conflicts.length)
        throw new CloudConflict(
          "A local tab changed these records during sync. Review recovery copies.",
        );
      checkpoint = { base: acknowledged };
      signal?.throwIfAborted();
      await storage.writeCheckpoint(key, checkpoint);
    } catch (error) {
      if (error instanceof CloudConflict && checkpoint) {
        checkpoint = { base: checkpoint.base };
        signal?.throwIfAborted();
        await storage.writeCheckpoint(key, checkpoint);
      }
      throw error;
    }
  }
  signal?.throwIfAborted();
  const remote = await transport.read();
  signal?.throwIfAborted();
  const local = await storage.load(key);
  const merged = reconcileCloud(
    checkpoint?.base.data ?? null,
    local.data,
    remote.data,
  );
  if (merged.conflicts.length) {
    if (remote.data)
      await storage.preserveRecovery(
        key,
        remote.data,
        "Cloud conflict: " + merged.conflicts.join(", "),
      );
    throw new CloudConflict(
      "The same records changed on this device and another device. Local data is kept, and the remote copy is saved in Settings. Review both before restoring.",
    );
  }
  if (remote.data && encodeBackup(merged.data) === encodeBackup(remote.data)) {
    signal?.throwIfAborted();
    const saved = await storage.commit(key, local, merged.data);
    if (saved.conflicts.length)
      throw new CloudConflict(
        "Local changes conflicted with the downloaded revision. Review recovery copies.",
      );
    signal?.throwIfAborted();
    await storage.writeCheckpoint(key, { base: remote } satisfies SyncCheckpoint);
    return remote;
  }
  signal?.throwIfAborted();
  const staged = await storage.commit(key, local, merged.data);
  if (staged.conflicts.length)
    throw new CloudConflict(
      "A local tab changed the same records while preparing sync. Review recovery copies.",
    );
  const pending = {
    operationId: operationId(),
    baseRevision: remote.revision,
    data: staged.record.data,
  };
  signal?.throwIfAborted();
  await storage.writeCheckpoint(key, {
    base: remote,
    pending,
  } satisfies SyncCheckpoint);
  signal?.throwIfAborted();
  try {
    const acknowledged = await transport.write(pending);
    signal?.throwIfAborted();
    await storage.writeCheckpoint(key, { base: acknowledged } satisfies SyncCheckpoint);
    return acknowledged;
  } catch (error) {
    if (error instanceof CloudConflict && !signal?.aborted) {
      // A known CAS rejection did not commit. Preserve the downloaded base,
      // discard only the rejected request, and reconcile on the next retry.
      await storage.writeCheckpoint(key, { base: remote } satisfies SyncCheckpoint);
    }
    throw error;
  }
}

/** Injectable persistence, lock and stable operation-ID factory. No browser globals. */
export function createAccountSynchronizer<K extends string>(storage: SyncStorage<K>, lock: SyncLock<K>, operationId: () => string = () => crypto.randomUUID()) {
  return (key: K, transport: CloudTransport, signal?: AbortSignal): Promise<CloudRevision> => {
    signal?.throwIfAborted();
    return lock.exclusive(key, () => performAccountSync(storage, key, transport, signal, operationId), signal);
  };
}
/** A host with one process/writer can use this lock; browser tabs need Web Locks. */
export function createSerialSyncLock<K extends string>(): SyncLock<K> {
  const queues = new Map<K, Promise<void>>();
  return {
    async exclusive<T>(key: K, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const previous = queues.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const tail = previous.then(() => gate);
      queues.set(key, tail);
      await previous;
      try { signal?.throwIfAborted(); return await operation(); }
      finally { release(); if (queues.get(key) === tail) queues.delete(key); }
    },
  };
}
