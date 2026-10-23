/** Setup observations are supplied by the host. Missing evidence stays unknown. */
export interface SetupObservations {
  storage: { available: boolean; savedAt?: string; error?: string };
  vscode: { paired: boolean; connected: boolean };
  practiceFolders: { observable: boolean; approvedCount?: number; eligibleWorkspaceCount?:number };
  browser: { supported: boolean; enabled: boolean; hostInstalled: boolean | null; verifiedAt?: string | null };
  provider: { provider: "gemini" | "openai"; configured: boolean };
  login: { supported: boolean; packaged: boolean; enabled: boolean; error?: string; detail?: string };
}

export type SetupState = "ready" | "disconnected" | "not configured" | "unavailable" | "not verified" | "off";
export interface SetupItem { state: SetupState; label: string; detail: string }
export interface SetupStatus {
  summary: string;
  storage: SetupItem;
  pairing: SetupItem;
  connection: SetupItem;
  practiceFolders: SetupItem;
  browser: SetupItem;
  provider: SetupItem;
  login: SetupItem & { enabled: boolean; canChange: boolean };
}

export function deriveSetupStatus(observed: SetupObservations): SetupStatus {
  const storage: SetupItem = observed.storage.available
    ? { state: "ready", label: "Ready", detail: "The local notebook can be read through its database writer." }
    : { state: "unavailable", label: "Unavailable", detail: observed.storage.error || "Reopen the companion to recover the local notebook. Existing files are kept." };
  const pairing: SetupItem = observed.vscode.paired
    ? { state: "ready", label: "Paired", detail: "A VS Code pairing credential is stored on this device. Pairing does not mean the editor is connected." }
    : { state: "not configured", label: "Not paired", detail: "Pair the Forma extension once from VS Code. CPH continues to run your local tests." };
  const connection: SetupItem = observed.vscode.connected
    ? { state: "ready", label: "Connected", detail: "An authenticated VS Code connection is currently active." }
    : { state: "disconnected", label: "Disconnected", detail: "Open VS Code and invoke Forma. Your local notebook remains available." };
  const practiceFolders: SetupItem = observed.practiceFolders.observable && (observed.practiceFolders.eligibleWorkspaceCount??0)>0
    ? {state:"ready",label:"Approved solution observed",detail:"The connected editor reported an eligible solution from an approved practice folder. Total folder approvals are managed in VS Code; workspace signals do not reveal their complete count."}
    : !observed.practiceFolders.observable || observed.practiceFolders.approvedCount === undefined
    ? { state: "unavailable", label: "Not observable", detail: "Folder approval is managed in VS Code. A disconnected editor does not mean no practice folders were approved." }
    : observed.practiceFolders.approvedCount > 0
      ? { state: "ready", label: "Approved folder observed", detail: `${observed.practiceFolders.approvedCount} approved practice ${observed.practiceFolders.approvedCount === 1 ? "folder is" : "folders are"} reported by the connected editor.` }
      : { state: "not configured", label: "No approved folder reported", detail: "In VS Code, use Forma’s practice-folder permission command for the folder you want to track." };
  let browser: SetupItem;
  if (!observed.browser.supported) browser = { state: "unavailable", label: "Unavailable on this platform", detail: "Optional Chrome capture is supported on macOS. Basic practice does not require it." };
  else if (!observed.browser.enabled) browser = { state: "off", label: "Off · optional", detail: "Chrome capture is disabled. Enable it only if you want to send a chosen problem page to Fenn." };
  else if (observed.browser.hostInstalled === false) browser = { state: "not configured", label: "Host needs setup", detail: "The Chrome native host was not found. Use the browser setup guide to complete installation." };
  else if (observed.browser.verifiedAt) browser = { state: "ready", label: "Capture received", detail: `An authenticated browser statement capture was received at ${observed.browser.verifiedAt}. This records past success; it does not verify Chrome’s current state.` };
  else browser = { state: "not verified", label: "Not verified", detail: `${observed.browser.hostInstalled ? "The native host is installed. " : "Native-host installation could not be confirmed. "}Use “Include statement in Fenn” on a Codeforces problem to verify capture. Installation alone does not prove capture works.` };
  const name = observed.provider.provider === "gemini" ? "Gemini" : "OpenAI";
  const provider: SetupItem = observed.provider.configured
    ? { state: "not verified", label: `${name} · key configured`, detail: "A credential is available locally. Provider access has not been tested here. No request is made to populate this status." }
    : { state: "not configured", label: `${name} · not configured`, detail: "Tutor is optional. Add your own key in Tutor settings when you want text or voice assistance." };
  const canChange = observed.login.supported && observed.login.packaged && !observed.login.error;
  const login: SetupStatus["login"] = {
    enabled: observed.login.enabled, canChange,
    ...(!observed.login.supported
      ? { state: "unavailable" as const, label: "Unavailable on this platform", detail: "Launch at login is not supported by this build’s platform integration." }
      : !observed.login.packaged
        ? { state: "unavailable" as const, label: "Unavailable in development", detail: "Launch at login requires an installed, packaged companion. Development builds do not change login settings." }
        : observed.login.error
          ? { state: "unavailable" as const, label: "Could not read login setting", detail: observed.login.error }
          : observed.login.detail
            ? { state: "not verified" as const, label: "Review macOS approval", detail: observed.login.detail }
            : { state: observed.login.enabled ? "ready" as const : "off" as const, label: observed.login.enabled ? "On" : "Off", detail: "Read from the operating system. Off by default; you choose whether Fenn opens when you sign in." }),
  };
  return { summary: !observed.storage.available ? "The local notebook needs attention" : observed.vscode.connected ? "Ready for linked practice" : "Local notebook ready", storage, pairing, connection, practiceFolders, browser, provider, login };
}

export interface BackupRestorePreview {
  token: string;
  scope: "notebook" | "companion" | "tutor";
  includeTutor: boolean;
  counts: { problems: number; attempts: number; thoughts: number; conversations: number; turns: number; drafts: number };
  warnings: string[];
  replacement: string[];
  expiresAt?: string;
}
export interface BackupRestoreResult { backupPath: string; summary: string }
