"use client";
import { getBrowserAuth } from "./cloud-client";
import {
  ownedShare,
  publicShare,
  SHARE_ID,
  SHARE_TOKEN,
  type OwnedShare,
  type Publication,
} from "./share-links";
import { SHARED_TRACK_LIMITS, type SharedTrackFile } from "./shared-tracks";

export class ShareRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
async function request(
  path: string,
  options: {
    accountId?: string;
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
) {
  let token: string | undefined;
  if (options.accountId) {
    const session = await getBrowserAuth()?.auth.getSession();
    if (session?.data.session?.user.id !== options.accountId)
      throw new ShareRequestError(
        "The account changed. Reopen sharing in your current workspace.",
        401,
        "account_changed",
      );
    token = session.data.session.access_token;
  }
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)])
    : AbortSignal.timeout(25000);
  const response = await fetch(path, {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "omit",
    signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The share service did not return a response.");
  let length = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SHARED_TRACK_LIMITS.maxFileBytes + 4096) {
        await reader.cancel();
        throw new Error("The share response exceeds Forma’s limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const result = JSON.parse(text + decoder.decode());
  if (!response.ok)
    throw new ShareRequestError(
      typeof result.error === "string"
        ? result.error
        : "Link sharing is unavailable. You can still export a track file.",
      response.status,
      result.code ?? "unavailable",
    );
  return result;
}
export async function readPublicShare(
  token: string,
  signal?: AbortSignal,
): Promise<SharedTrackFile> {
  if (!SHARE_TOKEN.test(token))
    throw new Error("This shared track link is invalid.");
  return publicShare(await request(`/api/shared-tracks/${token}`, { signal }));
}
export async function listOwnedShares(
  accountId?: string,
  signal?: AbortSignal,
): Promise<OwnedShare[]> {
  const result = await request("/api/shares", { accountId, signal });
  if (!Array.isArray(result.shares) || result.shares.length > 100)
    throw new Error("The share list is unavailable.");
  return result.shares.map(ownedShare);
}
export async function publishShare(
  accountId: string,
  file: SharedTrackFile,
  operationId: string,
  signal?: AbortSignal,
): Promise<Publication> {
  const result = await request("/api/shares", {
    accountId,
    method: "POST",
    body: { file, operationId },
    signal,
  });
  return {
    share: ownedShare(result.share),
    replayed: result.replayed === true,
  };
}
export async function revokeShare(
  accountId: string,
  id: string,
  signal?: AbortSignal,
): Promise<OwnedShare> {
  const result = await request(`/api/shares/${id}`, {
    accountId,
    method: "DELETE",
    signal,
  });
  return ownedShare(result.share);
}

/** Retain the request identity across a lost response, dialog close or reload. */
export async function publicationOperation(
  accountId: string,
  file: SharedTrackFile,
) {
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(file)),
      ),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const key = `forma.share-request:${accountId}:${digest}`;
  let previous: string | null = null;
  try {
    previous = sessionStorage.getItem(key);
  } catch {
    /* A modal still retains its operation in memory. */
  }
  if (previous && SHARE_ID.test(previous)) return previous;
  const operation = crypto.randomUUID();
  try {
    sessionStorage.setItem(key, operation);
  } catch {
    /* Storage can be full or unavailable. */
  }
  return operation;
}
