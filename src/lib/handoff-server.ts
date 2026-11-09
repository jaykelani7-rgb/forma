import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticateCloudRequest, CloudServerError, type CloudSession } from "./cloud-server";
import { encodeBackup } from "./concurrency";
import type { Data } from "./model";
import { sameOriginRequest } from "./request-origin";
import { applySessionHandoff, isHandoffDigest, isHandoffId, isHandoffKey, parseSessionHandoffPacket, type HandoffRemote, type SessionHandoffPacket } from "./session-handoff";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestLimit = 256 * 1024;
const fields = {
  link: ["claimKey", "sourceDigest"],
  "destination-status": ["claimKey"],
  receive: ["claimKey"],
  "source-status": ["sourceKey"],
  "source-cancel": ["sourceKey"],
  "source-send": ["sourceKey", "accountId", "packet"],
} as const;
type Action = keyof typeof fields;

interface ManageInput {
  action: Exclude<Action, "receive">;
  id: string;
  accountId?: string;
  accountLabel?: string;
  sourceDigest?: string;
  claimDigest?: string;
  packet?: SessionHandoffPacket;
}
interface ReceiveInput {
  id: string;
  claimDigest: string;
  data: Data;
  baseRevision: number;
}
interface HandoffPorts {
  authenticate(token: string): Promise<CloudSession>;
  manage(input: ManageInput): Promise<unknown>;
  receive(token: string, input: ReceiveInput): Promise<unknown>;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const matches = (value: unknown, format: RegExp): value is string => typeof value === "string" && format.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

const unavailable = () => new CloudServerError("Session transfer storage could not be reached. The transfer can be checked again.", 503, "unavailable");
const invalid = () => new CloudServerError("This session transfer request is invalid.", 400, "invalid_request");
function respond(value: unknown, status = 200) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    Vary: "Authorization",
  } });
}

function clientWithKey(key: string, token?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new CloudServerError("Session transfer is not configured on this Forma server.", 503, "not_configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(20000) }),
    },
  });
}

function storageError(error: { message: string }) {
  if (error.message === "invalid_handoff") return invalid();
  if (error.message === "handoff_limit") {
    return new CloudServerError("This account has too many recent or open transfers. Try again later.", 429, "handoff_limit");
  }
  if (error.message === "handoff_account_changed" || error.message === "handoff_packet_changed") {
    return new CloudServerError("This transfer no longer matches the reviewed account or session.", 409, "handoff_changed");
  }
  return unavailable();
}

const production: HandoffPorts = {
  authenticate: authenticateCloudRequest,
  async manage(input) {
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!key?.startsWith("sb_secret_")) {
      throw new CloudServerError("Session transfer is not configured on this Forma server.", 503, "not_configured");
    }
    const { data, error } = await clientWithKey(key).rpc("forma_manage_handoff", {
      p_action: input.action,
      p_id: input.id,
      p_account_id: input.accountId ?? null,
      p_account_label: input.accountLabel ?? null,
      p_source_digest: input.sourceDigest ?? null,
      p_claim_digest: input.claimDigest ?? null,
      p_packet: input.packet ?? null,
    });
    if (error) throw storageError(error);
    return data;
  },
  async receive(token, input) {
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!key?.startsWith("sb_publishable_")) throw unavailable();
    const { data, error } = await clientWithKey(key, token).rpc("forma_receive_handoff", {
      p_id: input.id,
      p_claim_digest: input.claimDigest,
      p_data: input.data,
      p_base_revision: input.baseRevision,
    });
    if (error) throw storageError(error);
    return data;
  },
};

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !request.body) throw invalid();
  const oversized = () => new CloudServerError("This session transfer exceeds the supported size.", 413, "capacity");
  if (Number(request.headers.get("content-length")) > requestLimit) throw oversized();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > requestLimit) {
        await reader.cancel().catch(() => {});
        throw oversized();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof CloudServerError) throw error;
    throw invalid();
  } finally {
    reader.releaseLock();
  }
}

function readRemote(value: unknown, includePacket = false): HandoffRemote {
  if (!record(value)) throw unavailable();
  if (value.error === "workspace_changed") {
    throw new CloudServerError("Your account workspace changed. Sync your notebook and retry the transfer.", 409, "workspace_changed");
  }
  if (value.error === "session_open") {
    throw new CloudServerError("Finish the existing web session before receiving this transfer.", 409, "session_open");
  }
  if (value.error === "session_received") {
    throw new CloudServerError("This session has already been saved in this account.", 409, "session_received");
  }
  const { state, accountId, accountLabel, sessionId } = value;
  if (state === "missing") return { state };
  if (state !== "linked" && state !== "ready" && state !== "received" && state !== "cancelled") throw unavailable();
  if (!matches(accountId, uuid) || typeof accountLabel !== "string" || !accountLabel || accountLabel.length > 320) throw unavailable();
  if ((state === "ready" || state === "received") && (typeof sessionId !== "string" || !sessionId || sessionId.length > 200)) throw unavailable();
  let packet: SessionHandoffPacket | undefined;
  if (includePacket && state === "ready") {
    try {
      packet = parseSessionHandoffPacket(value.packet);
      if (packet.session.id !== sessionId) throw unavailable();
    } catch {
      throw unavailable();
    }
  }
  return { state, accountId, accountLabel, ...(typeof sessionId === "string" ? { sessionId } : {}), ...(packet ? { packet } : {}) };
}

export function createHandoffHandler(ports: HandoffPorts = production) {
  return async function post(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).search) throw invalid();
      if (!sameOriginRequest(request)) {
        throw new CloudServerError("Open this transfer from Forma’s own origin.", 403, "invalid_origin");
      }
      const input = await readBody(request);
      if (!record(input) || !isHandoffId(input.id) || typeof input.action !== "string" || !Object.hasOwn(fields, input.action)) throw invalid();
      const action = input.action as Action;
      const allowed: readonly string[] = fields[action];
      const { id } = input;
      if (Object.keys(input).some(key => key !== "action" && key !== "id" && !allowed.includes(key))
        || allowed.some(key => !Object.hasOwn(input, key))) throw invalid();

      if (action === "source-status" || action === "source-cancel" || action === "source-send") {
        if (!isHandoffKey(input.sourceKey)) throw invalid();
        const sourceDigest = hash(input.sourceKey);
        if (action !== "source-send") return respond(readRemote(await ports.manage({ action, id, sourceDigest })));
        if (!matches(input.accountId, uuid)) throw invalid();
        let packet: SessionHandoffPacket;
        try {
          packet = parseSessionHandoffPacket(input.packet);
        } catch {
          throw invalid();
        }
        return respond(readRemote(await ports.manage({ action, id, sourceDigest, accountId: input.accountId, packet })));
      }

      if (!isHandoffKey(input.claimKey)) throw invalid();
      if (action === "link" && !isHandoffDigest(input.sourceDigest)) throw invalid();
      const bearer = request.headers.get("authorization")?.match(/^Bearer ([^\s]{1,16384})$/i)?.[1];
      if (!bearer) throw new CloudServerError("Sign in to your Forma account to receive a session.", 401, "unauthorized");
      const session = await ports.authenticate(bearer);
      const accountId = session.user.id;
      if (!matches(accountId, uuid)) throw unavailable();
      const claimDigest = hash(input.claimKey);
      if (action === "link") {
        const accountLabel = session.user.email?.trim().slice(0, 320) || "Forma account";
        const result = readRemote(await ports.manage({
          action, id, claimDigest, accountId, accountLabel, sourceDigest: input.sourceDigest as string,
        }), true);
        if (result.state === "missing") throw new CloudServerError("This transfer link is already bound or no longer available.", 409, "handoff_linked");
        return respond(result);
      }
      const current = readRemote(await ports.manage({ action: "destination-status", id, claimDigest, accountId }), true);
      if (action === "destination-status" || current.state !== "ready") return respond(current);
      const workspace = await session.read();
      let proposed: Data;
      try {
        proposed = applySessionHandoff(workspace.data, current.packet!);
        encodeBackup(proposed);
      } catch (error) {
        throw new CloudServerError(error instanceof Error ? error.message : "This session cannot be received into the current account.", 409, "workspace_conflict");
      }
      return respond(readRemote(await ports.receive(bearer, { id, claimDigest, data: proposed, baseRevision: workspace.revision })));
    } catch (error) {
      const known = error instanceof CloudServerError ? error : unavailable();
      return respond({ error: known.message, code: known.code }, known.status);
    }
  };
}
