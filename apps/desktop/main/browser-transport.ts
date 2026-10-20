import { createServer, type Socket } from "node:net";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { BoundedJsonLines } from "../../../packages/integrations/protocol";
import { browserEndpoint, parseBrowserMessage, type BrowserReply } from "../../../packages/integrations/browser";
import { sameCredential } from "./transport";

/** A separate socket and secret expose proposals/status only, never IDE commands. */
export async function startBrowserTransport(options: { endpoint?: string; credential: () => string | null; message: (m: unknown) => Promise<BrowserReply> }) {
  const endpoint = options.endpoint ?? browserEndpoint();
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 }); chmodSync(dirname(endpoint), 0o700);
  if (existsSync(endpoint)) { if (!lstatSync(endpoint).isSocket()) throw new Error("Browser endpoint is occupied."); unlinkSync(endpoint); }
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    if (sockets.size >= 4) { socket.destroy(); return; } sockets.add(socket);
    socket.setTimeout(10000, () => socket.destroy()); const lines = new BoundedJsonLines(); let used = false;
    socket.on("data", chunk => { try {
      for (const line of lines.push(chunk)) {
        if (used) { socket.destroy(); return; } used = true;
        void (async () => {
          try {
            const value = JSON.parse(line.toString());
            if (!value || Object.keys(value).some(k => !["credential", "message"].includes(k)) || typeof value.credential !== "string" || !sameCredential(options.credential(), value.credential)) throw new Error("Enable Chrome capture in Fenn settings first.");
            const message = parseBrowserMessage(value.message);
            socket.end(JSON.stringify(await options.message(message)) + "\n");
          } catch (error) { socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Capture rejected." }) + "\n"); }
        })();
      }
    } catch { socket.destroy(); } });
    socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, () => { server.removeListener("error", reject); resolve(); }); });
  chmodSync(endpoint, 0o600);
  return { close() { for (const s of sockets) s.destroy(); server.close(); if (existsSync(endpoint)) unlinkSync(endpoint); } };
}
