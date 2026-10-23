export type LoginStartupState = { supported: boolean; enabled: boolean; status: "ready" | "unavailable"; detail?: string };
export type LoginStartupApi = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  getLoginItemSettings(): { openAtLogin: boolean; status?: string };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
};
/** No preference mirror: read OS truth, and never register anything at initialization. */
export function createLoginStartup(api: LoginStartupApi) {
  function read(): LoginStartupState {
    if (api.platform !== "darwin") return { supported: false, enabled: false, status: "unavailable", detail: "Launch at login is currently supported by the packaged macOS app." };
    if (!api.isPackaged) return { supported: false, enabled: false, status: "unavailable", detail: "Development builds do not register login items. Use the installed Forma Companion app." };
    try {
      const settings = api.getLoginItemSettings();
      return { supported: true, enabled: settings.openAtLogin, status: "ready", ...(settings.status === "requires-approval" ? { detail: "macOS requires approval in System Settings → General → Login Items." } : {}) };
    } catch { return { supported: true, enabled: false, status: "unavailable", detail: "macOS login settings could not be read. Check System Settings → General → Login Items." }; }
  }
  function set(enabled: boolean): LoginStartupState {
    if (typeof enabled !== "boolean") throw new Error("Choose whether Fenn should launch at login.");
    const before = read();
    if (!before.supported || before.status !== "ready") throw new Error(before.detail ?? "Launch at login is unavailable.");
    try { api.setLoginItemSettings({ openAtLogin: enabled }); }
    catch { throw new Error("macOS could not change launch at login. Check System Settings → General → Login Items."); }
    const actual = read();
    if (actual.status !== "ready") throw new Error(actual.detail);
    return actual.enabled === enabled ? actual : { ...actual, detail: "macOS has not enabled the requested setting. Check System Settings → General → Login Items for approval." };
  }
  return { read, set };
}
