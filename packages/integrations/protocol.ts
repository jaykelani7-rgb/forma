import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { parseRecognition, type RecognitionRequest } from "./recognition";
import { parseSharedCode } from "../tutor/context";
import type { SharedCode } from "../tutor/types";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export type TransportCommand = { id: string; type: string; payload: Record<string, unknown>; expectedProblemKey?: string; expectedSessionId?: string; occurredAt?: string };
export type TransportRequest = {
  version: 1;
  id: string;
  credential: string;
} & ({ command: TransportCommand; expectedRecoveryEpoch?: string; action?: never; recognition?: never; tutorCode?: never } | { action: "open" | "memory" | "ping"; expectedRecoveryEpoch?: never; command?: never; recognition?: never; tutorCode?: never } | { recognition: RecognitionRequest; expectedRecoveryEpoch?: never; command?: never; action?: never; tutorCode?: never } | { tutorCode: SharedCode; expectedRecoveryEpoch?: never; command?: never; action?: never; recognition?: never });
export type TransportResponse =
  | { version: 1; id: string; ok: true; revision: number; [key: string]: unknown }
  | { version: 1; id: string; ok: false; error: string; [key: string]: unknown };

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);

export function defaultCompanionEndpoint(options: {
  platform?: NodeJS.Platform; home?: string; runtimeDirectory?: string; userIdentity?: string;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  if (platform === "win32") {
    const identity = options.userIdentity ?? userInfo().username;
    const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 20);
    return `\\\\.\\pipe\\forma-companion-${suffix}`;
  }
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Forma Companion", "runtime", "companion.sock");
  const runtime = options.runtimeDirectory ?? process.env.XDG_RUNTIME_DIR;
  return runtime ? path.join(runtime, "forma-companion", "companion.sock") : path.join(home, ".local", "state", "forma-companion", "runtime", "companion.sock");
}

export function validateTransportRequest(value: unknown): TransportRequest {
  if (!object(value) || value.version !== 1 || !id(value.id) || typeof value.credential !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value.credential)) throw new Error("Invalid protocol envelope or unsupported protocol version.");
  if (Object.keys(value).some((key) => !["version", "id", "credential", "command", "action", "recognition", "tutorCode", "expectedRecoveryEpoch"].includes(key))) throw new Error("Unexpected protocol field.");
  if (value.expectedRecoveryEpoch !== undefined && (value.command === undefined || !id(value.expectedRecoveryEpoch))) throw new Error("Invalid command recovery epoch.");
  if (value.tutorCode !== undefined) {
    if (value.command !== undefined || value.action !== undefined || value.recognition !== undefined) throw new Error("Code sharing cannot contain another action.");
    parseSharedCode(value.tutorCode);
    return value as TransportRequest;
  }
  if (value.recognition !== undefined) {
    if (value.command !== undefined || value.action !== undefined) throw new Error("Recognition cannot contain commands.");
    parseRecognition(value.recognition);
    return value as TransportRequest;
  }
  if (value.command !== undefined && value.action === undefined) {
    if (!object(value.command) || !id(value.command.id) || !id(value.command.type) || !object(value.command.payload) || (value.command.expectedProblemKey !== undefined && !id(value.command.expectedProblemKey)) || (value.command.expectedSessionId !== undefined && !id(value.command.expectedSessionId)) || (value.command.occurredAt !== undefined && (typeof value.command.occurredAt !== "string" || value.command.occurredAt.length > 40 || !Number.isFinite(Date.parse(value.command.occurredAt)))) || Object.keys(value.command).some((key) => !["id", "type", "payload", "expectedProblemKey", "expectedSessionId", "occurredAt"].includes(key))) throw new Error("Invalid command envelope.");
  } else if (value.command !== undefined || !["open", "memory", "ping"].includes(value.action as string)) throw new Error("Unsupported integration action.");
  return value as TransportRequest;
}

export function parseTransportRequest(line: string | Buffer): TransportRequest {
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("Integration message exceeds 64 KiB.");
  return validateTransportRequest(JSON.parse(line.toString()));
}

export function parseTransportResponse(line: string | Buffer, expectedId: string): TransportResponse {
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("Integration response exceeds 64 KiB.");
  const value: unknown = JSON.parse(line.toString());
  if (!object(value) || value.version !== 1 || value.id !== expectedId || typeof value.ok !== "boolean" || (value.ok ? !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 : typeof value.error !== "string" || value.error.length > 1000)) throw new Error("Invalid integration acknowledgement.");
  return value as TransportResponse;
}

export function encodeTransportMessage(value: TransportRequest | TransportResponse): string {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("Integration message exceeds 64 KiB.");
  return `${line}\n`;
}

/** Buffers bytes, rather than decoded chunks, so split UTF-8 characters survive. */
export class BoundedJsonLines {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): Buffer[] {
    const joined = Buffer.concat([this.pending, chunk]);
    const lines: Buffer[] = [];
    let start = 0;
    for (let end = 0; end < joined.length; end++) {
      if (joined[end] !== 10) continue;
      if (end - start > MAX_MESSAGE_BYTES) throw new Error("Integration message exceeds 64 KiB.");
      if (end > start) lines.push(joined.subarray(start, end));
      start = end + 1;
    }
    this.pending = joined.subarray(start);
    if (this.pending.length > MAX_MESSAGE_BYTES) throw new Error("Integration message exceeds 64 KiB.");
    return lines;
  }
}
