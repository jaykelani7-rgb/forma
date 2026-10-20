import { createHash } from "node:crypto";
import { normalizeCodeforcesIdentity } from "../core/src/codeforces-identity";

export type RecognisedBinding = { url: string; title?: string; source: "cph" | "manual" | "browser"; adapterVersion?: string; replace?: boolean };
export type EditorContext = {
  clientId: string; workspaceId: string; instanceId: string; generation: number;
  focused: boolean; observedAt: number; automatic: boolean; suppressed?: boolean; fileUri: string | null;
  reason: "focus" | "observe" | "heartbeat" | "withdraw";
  binding?: RecognisedBinding; proposalId?: string;
};
export type RecognitionRequest = EditorContext | { reason: "poll"; instanceId: string } | { reason: "proposal-result"; instanceId: string; proposalId: string; accepted: boolean; error?: string };
export type BrowserDelivery = { proposalId: string; fileUri: string; generation: number; url: string; title: string };
export type RecognitionView = { id: string; status: "recognised" | "needs-choice" | "conflict" | "waiting"; title: string; source: string; fileUri: string; message: string } | null;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(v);
export function localFileUri(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 4096) return false;
  try { const u = new URL(v); return u.protocol === "file:" && (!u.hostname || u.hostname === "localhost") && !u.search && !u.hash && u.pathname.startsWith("/"); } catch { return false; }
}
export const recognitionId = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 48);
export function parseRecognition(input: unknown): RecognitionRequest {
  if (!record(input) || !validId(input.instanceId)) throw new Error("Invalid recognition client.");
  const fields = input.reason === "poll" ? ["reason", "instanceId"] : input.reason === "proposal-result" ? ["reason", "instanceId", "proposalId", "accepted", "error"] : ["clientId", "workspaceId", "instanceId", "generation", "focused", "observedAt", "automatic", "suppressed", "fileUri", "reason", "binding", "proposalId"];
  if (Object.keys(input).some(k => !fields.includes(k))) throw new Error("Unexpected recognition field.");
  if (input.reason === "poll") return input as RecognitionRequest;
  if (input.reason === "proposal-result") {
    if (!validId(input.proposalId) || typeof input.accepted !== "boolean" || (input.error !== undefined && (typeof input.error !== "string" || input.error.length > 300))) throw new Error("Invalid browser delivery result.");
    return input as RecognitionRequest;
  }
  if (!validId(input.clientId) || !validId(input.workspaceId) || !Number.isSafeInteger(input.generation) || Number(input.generation) < 0 || typeof input.focused !== "boolean" || !Number.isSafeInteger(input.observedAt) || Number(input.observedAt) < 0 || typeof input.automatic !== "boolean" || (input.suppressed !== undefined && typeof input.suppressed !== "boolean") || !(input.fileUri === null || localFileUri(input.fileUri)) || !["focus", "observe", "heartbeat", "withdraw"].includes(String(input.reason))) throw new Error("Invalid focused solution.");
  if (input.proposalId !== undefined && !validId(input.proposalId)) throw new Error("Invalid browser proposal reference.");
  if (input.binding !== undefined) {
    const b = input.binding;
    if (!record(b) || Object.keys(b).some(k => !["url", "title", "source", "adapterVersion", "replace"].includes(k)) || typeof b.url !== "string" || b.url.length > 2000 || !/^https?:\/\//.test(b.url) || !normalizeCodeforcesIdentity({ url: b.url }) || !["cph", "manual", "browser"].includes(String(b.source)) || (b.title !== undefined && (typeof b.title !== "string" || b.title.length > 240)) || (b.adapterVersion !== undefined && (typeof b.adapterVersion !== "string" || b.adapterVersion.length > 100)) || (b.replace !== undefined && typeof b.replace !== "boolean")) throw new Error("Invalid recognition association.");
  }
  return structuredClone(input) as EditorContext;
}

/** Invalidates every asynchronous read when focus, permission, or configuration changes. */
export class RecognitionGeneration {
  private value = 0;
  next() { return ++this.value; }
  current(value: number) { return value === this.value; }
}
