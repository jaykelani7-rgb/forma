import { readCloudWorkspace, writeCloudWorkspace, CloudRequestError } from "./cloud-client";
import { type WorkspaceKey, commitWorkspace, loadWorkspace, preserveRecovery, syncMetadata } from "./storage";
import { CloudConflict, createAccountSynchronizer, createSerialSyncLock, type CloudTransport, type SyncCheckpoint, type SyncLock } from "../../packages/sync/src/index";
export { CloudConflict, reconcileCloud } from "../../packages/sync/src/index";
export type { CloudRevision, CloudTransport, SyncCheckpoint } from "../../packages/sync/src/index";

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

const serialLock = createSerialSyncLock<WorkspaceKey>();
const browserLock: SyncLock<WorkspaceKey> = {
  async exclusive(key, operation, signal) {
    signal?.throwIfAborted();
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(`forma-cloud-sync:${key}`, { mode: "exclusive", ...(signal ? { signal } : {}) }, operation);
    }
    if (typeof window !== "undefined") throw new CloudConflict("This browser cannot coordinate account sync across tabs. Local records are preserved; use a browser with Web Locks to sync safely.");
    return await serialLock.exclusive(key, operation, signal);
  },
};
/** Keep the IndexedDB/Web Locks adapter here; the algorithm also serves native storage. */
export const synchronizeAccount = createAccountSynchronizer<WorkspaceKey>({
  load: loadWorkspace,
  commit: commitWorkspace,
  preserveRecovery,
  readCheckpoint: (key) => syncMetadata<SyncCheckpoint>(key),
  writeCheckpoint: (key, checkpoint) => syncMetadata(key, checkpoint),
}, browserLock);
