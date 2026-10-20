import { app, safeStorage } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { assertBrowserOrigin, browserEndpoint, encodeNativeMessage, NativeMessageFrames, parseBrowserMessage, type BrowserReply } from "../../packages/integrations/browser";
import { BoundedJsonLines } from "../../packages/integrations/protocol";

// Chrome passes its registered extension origin as an argument. Nothing from a page is trusted.
const origin = process.argv.find(arg => arg.startsWith("chrome-extension://")) ?? "";
try { assertBrowserOrigin(origin); } catch { process.exit(1); }
app.setName("Forma Companion");
app.setPath("userData", join(app.getPath("appData"), "Forma Companion"));
function forward(message: unknown): Promise<BrowserReply> {
  const parsed = parseBrowserMessage(message);
  if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("OS-protected browser credentials are unavailable.");
  let credential: string;
  try { credential = safeStorage.decryptString(readFileSync(join(app.getPath("appData"), "Forma Companion", "browser-pairing.enc"))); }
  catch { throw new Error("Enable Chrome capture in Fenn settings first."); }
  return new Promise((resolve, reject) => {
    const socket = createConnection(browserEndpoint()), lines = new BoundedJsonLines(); let settled = false;
    const finish = (error?: Error, reply?: BrowserReply) => { if (settled) return; settled = true; socket.destroy(); if (error) reject(error); else resolve(reply!); };
    socket.setTimeout(8000, () => finish(new Error("Open Forma Companion and enable Chrome capture.")));
    socket.on("connect", () => socket.write(JSON.stringify({ credential, message: parsed }) + "\n"));
    socket.on("data", chunk => { try { const values = lines.push(chunk); if (values.length) finish(undefined, JSON.parse(values[0].toString())); } catch (e) { finish(e as Error); } });
    socket.on("error", () => finish(new Error("Open Forma Companion and enable Chrome capture."))); socket.on("end", () => finish(new Error("The companion closed before acknowledging.")));
  });
}
void app.whenReady().then(() => {
  app.dock?.hide(); const frames = new NativeMessageFrames(); let tail = Promise.resolve(), pending = 0;
  process.stdin.on("data", (chunk: Buffer) => { try {
    for (const message of frames.push(chunk)) {
      if (++pending > 16) throw new Error("Too many native requests.");
      tail = tail.then(async () => { try { process.stdout.write(encodeNativeMessage(await forward(message))); } catch (e) { process.stdout.write(encodeNativeMessage({ ok: false, error: e instanceof Error ? e.message : "Capture rejected." })); } finally { pending--; } });
    }
  } catch { process.exitCode = 1; app.exit(1); } });
  process.stdin.on("end", () => { try { frames.end(); } catch { process.exitCode = 1; } void tail.finally(() => app.exit(Number(process.exitCode ?? 0))); });
});
app.on("window-all-closed", () => { /* This native host has no window. */ });
