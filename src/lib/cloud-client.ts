"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Data, validateData } from "./model";
import { encodeBackup, MAX_BACKUP_BYTES } from "./concurrency";

let browserAuth: SupabaseClient | null | undefined;
export function getBrowserAuth(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (browserAuth !== undefined) return browserAuth;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith("sb_publishable_"))
    return (browserAuth = null);
  // Only public configuration belongs in the browser bundle.
  browserAuth = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "forma.auth.v1",
    },
  });
  return browserAuth;
}

export interface CloudWorkspace {
  revision: number;
  data: Data | null;
}
export interface CloudAccount {
  id: string;
  email: string | null;
}
export class CloudRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public current: CloudWorkspace | null = null,
  ) {
    super(message);
  }
}
function parseWorkspace(input: unknown): CloudWorkspace {
  if (!input || typeof input !== "object")
    throw new Error("The account service returned an invalid workspace.");
  const value = input as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !(value.data === null || typeof value.data === "object")
  )
    throw new Error("The account service returned an invalid revision.");
  const data = value.data === null ? null : validateData(value.data);
  if (data) encodeBackup(data);
  return { revision: value.revision as number, data };
}
async function cloudRequest(
  path: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    cache: "no-store",
    credentials: "omit",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_BACKUP_BYTES + 4096)
    throw new CloudRequestError(
      "The account response exceeds Forma’s supported capacity.",
      502,
      "capacity",
    );
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES + 4096)
    throw new CloudRequestError(
      "The account response exceeds Forma’s supported capacity.",
      502,
      "capacity",
    );
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CloudRequestError(
      "The account service returned an unreadable response.",
      502,
      "unavailable",
    );
  }
  if (!response.ok) {
    const current =
      response.status === 409 && value.code === "conflict"
        ? parseWorkspace(value)
        : null;
    throw new CloudRequestError(
      typeof value.error === "string"
        ? value.error
        : "Account sync did not finish. Local changes are preserved.",
      response.status,
      typeof value.code === "string" ? value.code : "unavailable",
      current,
    );
  }
  return value;
}
export async function readCloudAccount(
  token: string,
  signal?: AbortSignal,
): Promise<CloudAccount> {
  const result = await cloudRequest("/api/account", token, undefined, signal);
  const user = result.user as Record<string, unknown> | undefined;
  if (
    !user ||
    typeof user.id !== "string" ||
    !(user.email === null || typeof user.email === "string")
  )
    throw new CloudRequestError(
      "The account service returned an invalid identity.",
      502,
      "unavailable",
    );
  return { id: user.id, email: user.email as string | null };
}
export async function readCloudWorkspace(
  token: string,
  signal?: AbortSignal,
): Promise<CloudWorkspace> {
  return parseWorkspace(
    await cloudRequest("/api/workspace", token, undefined, signal),
  );
}
export async function writeCloudWorkspace(
  token: string,
  workspace: Data,
  baseRevision: number,
  operationId: string,
  signal?: AbortSignal,
): Promise<CloudWorkspace & { replayed: boolean }> {
  const data = JSON.parse(encodeBackup(workspace)) as Data;
  const result = await cloudRequest(
    "/api/workspace",
    token,
    { data, baseRevision, operationId },
    signal,
  );
  return { ...parseWorkspace(result), replayed: result.replayed === true };
}
