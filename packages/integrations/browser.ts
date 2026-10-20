import { endianness } from "node:os";
import { dirname, join } from "node:path";
import { normalizeCodeforcesIdentity } from "../core/src/codeforces-identity";
import { defaultCompanionEndpoint } from "./protocol";
import { validId } from "./recognition";
import { BROWSER_ORIGIN } from "./browser-id";

export const MAX_NATIVE_BYTES = 64 * 1024;
export type BrowserMessage = { kind: "propose"; url: string; title: string } | { kind: "confirm"; proposalId: string; targetId: string } | { kind: "status" | "cancel"; proposalId: string };
export type BrowserReply = { ok: boolean; error?: string; proposalId?: string; expiresAt?: number; status?: string; targets?: { id: string; label: string }[] };
export const browserEndpoint = () => join(dirname(defaultCompanionEndpoint()), "browser.sock");
export function assertBrowserOrigin(origin: string) { if (origin !== BROWSER_ORIGIN) throw new Error("This browser extension is not registered with Forma."); }
export function parseBrowserMessage(value: unknown): BrowserMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid browser capture.");
  const v = value as Record<string, unknown>;
  const fields = v.kind === "propose" ? ["kind", "url", "title"] : v.kind === "confirm" ? ["kind", "proposalId", "targetId"] : ["kind", "proposalId"];
  if (Object.keys(v).some(k => !fields.includes(k))) throw new Error("Browser capture has no command or filesystem capability.");
  if (v.kind === "propose") {
    if (typeof v.url !== "string" || v.url.length > 2000 || !/^https?:\/\//.test(v.url) || typeof v.title !== "string" || v.title.length > 240) throw new Error("Open an exact Codeforces problem page.");
    const identity = normalizeCodeforcesIdentity({ url: v.url });
    if (!identity) throw new Error("Open an exact Codeforces problem page.");
    return { kind: "propose", url: identity.url, title: v.title.trim() || `Codeforces ${identity.code}` };
  }
  if (!["confirm", "status", "cancel"].includes(String(v.kind)) || !validId(v.proposalId) || (v.kind === "confirm" && !validId(v.targetId))) throw new Error("Invalid browser proposal.");
  return structuredClone(v) as BrowserMessage;
}
export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (!body.length || body.length > MAX_NATIVE_BYTES) throw new Error("Native message is too large.");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
/** Chrome framing is length-prefixed bytes, never the socket's JSON-lines format. */
export class NativeMessageFrames {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    const values: unknown[] = [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = endianness() === "LE" ? this.buffer.readUInt32LE() : this.buffer.readUInt32BE();
      if (!size || size > MAX_NATIVE_BYTES) throw new Error("Invalid native message length.");
      if (this.buffer.length < size + 4) break;
      values.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.buffer.subarray(4, size + 4))));
      this.buffer = this.buffer.subarray(size + 4);
    }
    if (this.buffer.length > MAX_NATIVE_BYTES + 4) throw new Error("Native framing overflow.");
    return values;
  }
  end() { if (this.buffer.length) throw new Error("Truncated native message."); }
}
