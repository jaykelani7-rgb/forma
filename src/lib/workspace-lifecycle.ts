import type { WorkspaceKey } from "./storage";

export interface WorkspaceOperation {
  key: WorkspaceKey;
  generation: number;
  activation: number;
}
export interface WorkspaceOperationState extends WorkspaceOperation {
  blocked: boolean;
  saving: boolean;
  editVersion: number;
}
export function operationIsCurrent(
  expected: WorkspaceOperation,
  current: WorkspaceOperation,
  signal?: AbortSignal,
): boolean {
  return (
    !signal?.aborted &&
    expected.key === current.key &&
    expected.generation === current.generation &&
    expected.activation === current.activation
  );
}
export class UnsavedWorkspaceError extends Error {
  constructor() {
    super(
      "Unsaved account changes are kept in this tab. Export a backup and restore local saving before syncing.",
    );
  }
}

/** Read a sync result only after local writes settle, and protect edits that
 * arrive while that read is in flight. A cancelled/stale result is never shown. */
export async function readSettledWorkspace<T>(
  expected: WorkspaceOperation,
  state: () => WorkspaceOperationState,
  settle: () => Promise<void>,
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T | null> {
  await settle();
  let current = state();
  if (!operationIsCurrent(expected, current, signal)) return null;
  if (current.blocked) throw new UnsavedWorkspaceError();
  if (current.saving) return null;
  const editVersion = current.editVersion;
  const result = await read();
  current = state();
  if (!operationIsCurrent(expected, current, signal)) return null;
  if (current.blocked) throw new UnsavedWorkspaceError();
  // A newly queued local edit owns the visible optimistic state. A following
  // sync can reload the merged record after that edit has committed.
  return current.saving || current.editVersion !== editVersion ? null : result;
}
