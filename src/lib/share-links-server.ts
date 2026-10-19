import { createClient } from "@supabase/supabase-js";
import { authenticateCloudRequest, CloudServerError } from "./cloud-server";
import { sameOriginRequest } from "./request-origin";
import {
  canonicalSharedTrack,
  SHARED_TRACK_LIMITS,
  type SharedTrackFile,
} from "./shared-tracks";
import {
  ownedShare,
  SHARE_ID,
  SHARE_TOKEN,
  type OwnedShare,
  type Publication,
} from "./share-links";

export interface ShareSession {
  userId: string;
  publish: (file: SharedTrackFile, operationId: string) => Promise<Publication>;
  list: () => Promise<OwnedShare[]>;
  revoke: (id: string) => Promise<OwnedShare | null>;
}
const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}
function unavailable() {
  return new CloudServerError(
    "Link sharing is unavailable. You can still download and send a track file.",
    503,
    "not_configured",
  );
}
function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (
    !url ||
    !key?.startsWith("sb_publishable_") ||
    !secret?.startsWith("sb_secret_")
  )
    throw unavailable();
  return { url, key, secret };
}
function client(key: string, token?: string) {
  return createClient(config().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
}
function databaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "P0001")
    throw new CloudServerError(
      "Publication limit reached: 10 new links per hour and 100 links per account. Existing links can still be managed.",
      429,
      "rate_limit",
    );
  if (error.code === "22023")
    throw new CloudServerError(
      "This publication request changed. Review it and create a new publication request.",
      409,
      "operation_mismatch",
    );
  throw new CloudServerError(
    "Shared link storage is unavailable. Check its setup, or retry. File export remains available.",
    503,
    "unavailable",
  );
}
async function authenticate(token: string): Promise<ShareSession> {
  const settings = config();
  const { user } = await authenticateCloudRequest(token);
  const database = client(settings.key, token);
  return {
    userId: user.id,
    async publish(file, operationId) {
      const { data, error } = await database.rpc("forma_publish_share", {
        p_file: file,
        p_operation_id: operationId,
      });
      databaseError(error);
      return {
        share: ownedShare(data?.share),
        replayed: data?.replayed === true,
      };
    },
    async list() {
      const { data, error } = await database.rpc("forma_list_shares");
      databaseError(error);
      if (!Array.isArray(data) || data.length > 100)
        throw new Error("Invalid share list.");
      return data.map(ownedShare);
    },
    async revoke(id) {
      const { data, error } = await database.rpc("forma_revoke_share", {
        p_id: id,
      });
      databaseError(error);
      return data === null ? null : ownedShare(data);
    },
  };
}
async function resolve(token: string): Promise<unknown | null> {
  const database = client(config().secret);
  const { data, error } = await database.rpc("forma_resolve_share", {
    p_token: token,
  });
  databaseError(error);
  return data;
}

/** Per-process burst protection. Persistent publication quotas also live in SQL. */
export function createShareRateLimit(now = () => Date.now()) {
  const buckets = new Map<string, { start: number; count: number }>();
  return (key: string, maximum = 120) => {
    const time = now();
    for (const [id, bucket] of buckets)
      if (time - bucket.start >= 60000) buckets.delete(id);
    const bucket = buckets.get(key) ?? { start: time, count: 0 };
    if (!buckets.has(key) && buckets.size >= 2048) return false;
    buckets.set(key, bucket);
    return ++bucket.count <= maximum;
  };
}
const rateLimit = createShareRateLimit();
async function body(request: Request) {
  const maximum = SHARED_TRACK_LIMITS.maxFileBytes + 4096;
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    throw new CloudServerError(
      "Send a shared track as JSON.",
      415,
      "invalid_request",
    );
  if (Number(request.headers.get("content-length")) > maximum)
    throw new CloudServerError(
      "The shared track exceeds the 5 MiB limit.",
      413,
      "capacity",
    );
  if (!request.body)
    throw new CloudServerError(
      "Choose a track to share.",
      400,
      "invalid_request",
    );
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new CloudServerError(
          "The shared track exceeds the 5 MiB limit.",
          413,
          "capacity",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}
export function createShareHandlers(
  dependencies: {
    authenticate?: (token: string) => Promise<ShareSession>;
    resolve?: (token: string) => Promise<unknown | null>;
    rateLimit?: (key: string, maximum?: number) => boolean;
  } = {},
) {
  const check = dependencies.rateLimit ?? rateLimit;
  async function run(request: Request, action: () => Promise<Response>) {
    try {
      if (new URL(request.url).search)
        throw new CloudServerError(
          "Share requests do not accept query parameters or owner IDs.",
          400,
          "invalid_request",
        );
      if (request.method !== "GET" && !sameOriginRequest(request))
        throw new CloudServerError(
          "Open Forma to manage share links.",
          403,
          "invalid_origin",
        );
      // The global ceiling remains effective even if a deployment mistakenly
      // forwards a spoofed address. Reverse proxies must still replace incoming
      // forwarding headers for the additional per-address bucket to be useful.
      if (!check("global", 1200))
        throw new CloudServerError(
          "Too many share requests. Try again in a minute.",
          429,
          "rate_limit",
        );
      const ip = (
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
      ).slice(0, 128);
      if (!check(`ip:${ip}`))
        throw new CloudServerError(
          "Too many share requests. Try again in a minute.",
          429,
          "rate_limit",
        );
      return await action();
    } catch (failure) {
      if (failure instanceof CloudServerError)
        return json(
          { error: failure.message, code: failure.code },
          failure.status,
        );
      return json(
        {
          error:
            "This shared track request could not be completed. Review the content or try again.",
          code: "unavailable",
        },
        503,
      );
    }
  }
  async function owner(request: Request) {
    if (!dependencies.authenticate) config();
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([^\s]{1,16384})$/i)?.[1];
    if (!token)
      throw new CloudServerError(
        "Sign in to your Forma account to manage share links. File export needs no account.",
        401,
        "unauthorized",
      );
    const session = await (dependencies.authenticate ?? authenticate)(token);
    if (!SHARE_ID.test(session.userId))
      throw new CloudServerError(
        "Sign in again to manage share links.",
        401,
        "unauthorized",
      );
    if (!check(`owner:${session.userId}`))
      throw new CloudServerError(
        "Too many share requests. Try again in a minute.",
        429,
        "rate_limit",
      );
    return session;
  }
  return {
    list: (request: Request) =>
      run(request, async () => {
        const shares = await (await owner(request)).list();
        if (shares.length > 100) throw new Error("Unbounded share list.");
        return json({ shares: shares.map(ownedShare) });
      }),
    publish: (request: Request) =>
      run(request, async () => {
        const session = await owner(request);
        let file: SharedTrackFile, operationId: string;
        try {
          const input = (await body(request)) as Record<string, unknown>;
          if (
            !input ||
            Array.isArray(input) ||
            Object.keys(input).some(
              (key) => !["file", "operationId"].includes(key),
            ) ||
            typeof input.operationId !== "string" ||
            !SHARE_ID.test(input.operationId)
          )
            throw new Error(
              "Use a stable publication request ID and curriculum file. Ownership comes from your signed-in account.",
            );
          file = canonicalSharedTrack(input.file);
          operationId = input.operationId;
        } catch (failure) {
          if (failure instanceof CloudServerError) throw failure;
          throw new CloudServerError(
            failure instanceof Error
              ? failure.message
              : "Invalid shared track.",
            400,
            "invalid_file",
          );
        }
        const publication = await session.publish(file, operationId);
        return json({
          share: ownedShare(publication.share),
          replayed: publication.replayed === true,
        });
      }),
    revoke: (request: Request, id: string) =>
      run(request, async () => {
        const session = await owner(request);
        if (!SHARE_ID.test(id))
          throw new CloudServerError(
            "This share could not be found.",
            404,
            "not_found",
          );
        const share = await session.revoke(id);
        if (!share)
          throw new CloudServerError(
            "This share could not be found.",
            404,
            "not_found",
          );
        return json({ share: ownedShare(share) });
      }),
    read: (request: Request, token: string) =>
      run(request, async () => {
        if (!SHARE_TOKEN.test(token))
          throw new CloudServerError(
            "This shared track is unavailable. Ask its sender for an active link or track file.",
            404,
            "not_found",
          );
        const stored = await (dependencies.resolve ?? resolve)(token);
        if (!stored)
          throw new CloudServerError(
            "This shared track is unavailable. It may have been revoked. Ask its sender for an active link or track file.",
            404,
            "not_found",
          );
        try {
          return json({ file: canonicalSharedTrack(stored) });
        } catch {
          throw new CloudServerError(
            "This shared track is unavailable or uses an unsupported version. Ask its sender for a new link.",
            404,
            "not_found",
          );
        }
      }),
  };
}
