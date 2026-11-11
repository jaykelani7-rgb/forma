import type { Data } from "./model";
import type { CommitResult, Recovery, WorkspaceRevision } from "./storage";
import type { CompanionThought } from "../../packages/core/src/companion";

export interface DesktopWorkspaceRevision extends WorkspaceRevision {
  key: "personal";
  recoveryEpoch: string;
}

export interface DesktopWorkspaceBridge {
  read(): Promise<DesktopWorkspaceRevision>;
  thoughts(): Promise<CompanionThought[]>;
  commit(input: { base: DesktopWorkspaceRevision; proposed: Data; replace: boolean }): Promise<CommitResult>;
  recoveries(): Promise<Recovery[]>;
  preserveRecovery(input: { data: Data; reason: string }): Promise<void>;
  onChange(listener: () => void): () => void;
  onNavigate(listener: (path: string) => void): () => void;
  openRibbon(panel?: "settings"): Promise<void>;
  importNotebook(): Promise<{ imported: boolean }>;
}

declare global {
  interface Window {
    formaWorkspace?: DesktopWorkspaceBridge;
  }
}

export function desktopWorkspace() {
  return typeof window === "undefined" ? undefined : window.formaWorkspace;
}
