import { contextBridge, ipcRenderer } from "electron";
import type { DesktopWorkspaceBridge } from "../../../src/lib/desktop-workspace";

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: DesktopWorkspaceBridge = {
  read: () => ipcRenderer.invoke("workspace:read"),
  thoughts: () => ipcRenderer.invoke("workspace:thoughts"),
  commit: input => ipcRenderer.invoke("workspace:commit", input),
  recoveries: () => ipcRenderer.invoke("workspace:recoveries"),
  preserveRecovery: input => ipcRenderer.invoke("workspace:preserve-recovery", input),
  onChange: callback => subscribe("workspace:changed", callback),
  onNavigate: callback => subscribe("workspace:navigate", callback),
  openRibbon: panel => ipcRenderer.invoke("workspace:open-ribbon", panel),
  importNotebook: () => ipcRenderer.invoke("workspace:import-notebook"),
};
contextBridge.exposeInMainWorld("formaWorkspace", Object.freeze(bridge));
