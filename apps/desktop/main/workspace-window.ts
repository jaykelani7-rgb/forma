import { BrowserWindow, net, protocol, screen, shell } from "electron";
import { relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { GET as catalogue } from "../../../src/app/api/catalogue/route";
import { GET as codeforces } from "../../../src/app/api/codeforces/route";
import { tutorExternalUrl } from "../../../packages/tutor/links";

const scheme = "forma-workspace";
const documentUrl = `${scheme}://app/workspace.html`;
const networkRoutes = new Map([["/api/catalogue", catalogue], ["/api/codeforces", codeforces]]);

export function registerWorkspaceScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);
}

export function serveWorkspace(bundle: string) {
  protocol.handle(scheme, async request => {
    const url = new URL(request.url);
    if (url.host !== "app" || request.method !== "GET") return new Response(null, { status: 404 });
    const handler = networkRoutes.get(url.pathname);
    if (handler) return handler(request);
    try {
      const file = resolve(bundle, `.${decodeURIComponent(url.pathname)}`);
      const path = relative(bundle, file);
      if (!path || path.startsWith("..") || isAbsolute(path)) return new Response(null, { status: 404 });
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

export function isWorkspaceSender(event: Electron.IpcMainInvokeEvent, workspace: BrowserWindow | undefined) {
  return workspace && !workspace.isDestroyed() && event.sender === workspace.webContents &&
    event.senderFrame === workspace.webContents.mainFrame && event.senderFrame.url.split("#", 1)[0] === documentUrl;
}

export function createWorkspaceWindow(preload: string) {
  const { width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const workspace = new BrowserWindow({
    width: Math.min(1240, width), height: Math.min(860, height),
    minWidth: Math.min(720, width), minHeight: Math.min(520, height),
    show: false, title: "Forma", backgroundColor: "#10100f",
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  function openExternal(url: string) {
    try { void shell.openExternal(tutorExternalUrl(url)).catch(() => {}); } catch { /* Only approved public links leave the app. */ }
  }
  workspace.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  workspace.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternal(url);
  });
  return workspace;
}

export function loadWorkspaceWindow(window: BrowserWindow, path: string) {
  return window.loadURL(`${documentUrl}#${path}`);
}
