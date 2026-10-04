import { Data, emptyData } from "./model";
import { encodeBackup, mergeWorkspaces } from "./concurrency";
import {
  readCloudWorkspace,
  writeCloudWorkspace,
  CloudRequestError,
} from "./cloud-client";
import {
  WorkspaceKey,
  commitWorkspace,
  loadWorkspace,
  preserveRecovery,
  syncMetadata,
} from "./storage";

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
export function accountTransport(
  token: string,
  signal?: AbortSignal,
): CloudTransport {
  return {
    read: () => readCloudWorkspace(token, signal),
    write: async (write) => {
      try {
        return await writeCloudWorkspace(
          token,
          write.data,
          write.baseRevision,
          write.operationId,
          signal,
        );
      } catch (error) {
        if (error instanceof CloudRequestError && error.status === 409)
          throw new CloudConflict(error.message);
        throw error;
      }
    },
  };
}
// Persist the operation UUID before sending. An uncertain network response can
// replay the identical request safely. Local edits made during the request are
// reconciled transactionally instead of overwritten by the acknowledgement.
async function performAccountSync(
  key: WorkspaceKey,
  transport: CloudTransport,
  signal?: AbortSignal,
): Promise<CloudRevision> {
  if (!key.startsWith("account:"))
    throw new Error("Only an application account workspace can sync.");
  signal?.throwIfAborted();
  let checkpoint = await syncMetadata<SyncCheckpoint>(key);
  if (checkpoint?.pending) {
    try {
      signal?.throwIfAborted();
      const acknowledged = await transport.write(checkpoint.pending);
      signal?.throwIfAborted();
      const snapshot = await loadWorkspace(key);
      const merged = reconcileCloud(
        checkpoint.pending.data,
        snapshot.data,
        acknowledged.data,
      );
      if (merged.conflicts.length) {
        if (acknowledged.data)
          await preserveRecovery(
            key,
            acknowledged.data,
            "Cloud acknowledgement conflicts with local edits",
          );
        throw new CloudConflict(
          "Cloud and local edits conflict. Both copies are preserved; review recovery copies in Settings.",
        );
      }
      signal?.throwIfAborted();
      const saved = await commitWorkspace(key, snapshot, merged.data);
      if (saved.conflicts.length)
        throw new CloudConflict(
          "A local tab changed these records during sync. Review recovery copies.",
        );
      checkpoint = { base: acknowledged };
      signal?.throwIfAborted();
      await syncMetadata(key, checkpoint);
    } catch (error) {
      if (error instanceof CloudConflict && checkpoint) {
        checkpoint = { base: checkpoint.base };
        signal?.throwIfAborted();
        await syncMetadata(key, checkpoint);
      }
      throw error;
    }
  }
  signal?.throwIfAborted();
  const remote = await transport.read();
  signal?.throwIfAborted();
  const local = await loadWorkspace(key);
  const merged = reconcileCloud(
    checkpoint?.base.data ?? null,
    local.data,
    remote.data,
  );
  if (merged.conflicts.length) {
    if (remote.data)
      await preserveRecovery(
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
    const saved = await commitWorkspace(key, local, merged.data);
    if (saved.conflicts.length)
      throw new CloudConflict(
        "Local changes conflicted with the downloaded revision. Review recovery copies.",
      );
    signal?.throwIfAborted();
    await syncMetadata(key, { base: remote } satisfies SyncCheckpoint);
    return remote;
  }
  signal?.throwIfAborted();
  const staged = await commitWorkspace(key, local, merged.data);
  if (staged.conflicts.length)
    throw new CloudConflict(
      "A local tab changed the same records while preparing sync. Review recovery copies.",
    );
  const pending = {
    operationId: crypto.randomUUID(),
    baseRevision: remote.revision,
    data: staged.record.data,
  };
  signal?.throwIfAborted();
  await syncMetadata(key, {
    base: remote,
    pending,
  } satisfies SyncCheckpoint);
  signal?.throwIfAborted();
  try {
    const acknowledged = await transport.write(pending);
    signal?.throwIfAborted();
    await syncMetadata(key, { base: acknowledged } satisfies SyncCheckpoint);
    return acknowledged;
  } catch (error) {
    if (error instanceof CloudConflict && !signal?.aborted) {
      // A known CAS rejection did not commit. Preserve the downloaded base,
      // discard only the rejected request, and reconcile on the next retry.
      await syncMetadata(key, { base: remote } satisfies SyncCheckpoint);
    }
    throw error;
  }
}

const nodeQueues = new Map<string, Promise<void>>();
/** Coordinate the shared account checkpoint before staging any remote operation. */
export async function synchronizeAccount(
  key: WorkspaceKey,
  transport: CloudTransport,
  signal?: AbortSignal,
): Promise<CloudRevision> {
  signal?.throwIfAborted();
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      `forma-cloud-sync:${key}`,
      { mode: "exclusive", ...(signal ? { signal } : {}) },
      () => performAccountSync(key, transport, signal),
    );
  }
  if (typeof window !== "undefined")
    throw new CloudConflict(
      "This browser cannot coordinate account sync across tabs. Local records are preserved; use a browser with Web Locks to sync safely.",
    );
  // Node's deterministic tests share a process rather than browser tabs.
  const previous = nodeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  nodeQueues.set(key, tail);
  await previous;
  try {
    signal?.throwIfAborted();
    return await performAccountSync(key, transport, signal);
  } finally {
    release();
    if (nodeQueues.get(key) === tail) nodeQueues.delete(key);
  }
}
