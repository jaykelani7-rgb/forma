import { createClient } from "@supabase/supabase-js";
import { type Data, validateData } from "./model";
import { encodeBackup, MAX_BACKUP_BYTES } from "./concurrency";

export interface VerifiedCloudUser {
  id: string;
  email: string | null;
}
export interface StoredCloudWorkspace {
  revision: number;
  data: Data | null;
}
export interface WorkspaceWrite {
  data: Data;
  baseRevision: number;
  operationId: string;
}
export type CloudWriteResult = StoredCloudWorkspace & {
  status: "ok" | "conflict" | "operation_mismatch";
  replayed?: boolean;
};
export interface CloudSession {
  user: VerifiedCloudUser;
  read: () => Promise<StoredCloudWorkspace>;
  write: (input: WorkspaceWrite) => Promise<CloudWriteResult>;
}
export class CloudServerError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const noCache = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noCache });
}
function cleanWorkspace(input: unknown): StoredCloudWorkspace {
  if (!input || typeof input !== "object")
    throw new CloudServerError(
      "The account workspace could not be read. Your local records are preserved.",
      502,
      "unavailable",
    );
  const value = input as Record<string, unknown>;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    throw new CloudServerError(
      "The account workspace has an invalid revision.",
      502,
      "unavailable",
    );
  const data = value.data === null ? null : validateData(value.data);
  if (data) encodeBackup(data);
  return { revision: value.revision as number, data };
}

/** A fresh, user-scoped client is created for every authenticated request. */
export async function authenticateCloudRequest(
  token: string,
): Promise<CloudSession> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new CloudServerError(
      "Account sync is not configured. Your local workspace remains available.",
      503,
      "not_configured",
    );
  if (!key.startsWith("sb_publishable_"))
    throw new CloudServerError(
      "Account sync configuration must use a publishable key.",
      503,
      "not_configured",
    );
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
  // getSession/JWT decoding alone is not sufficient: contact Auth to verify the
  // caller on every read/write, before deriving an owner or running any query.
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous || !uuid(data.user.id))
    throw new CloudServerError(
      "Sign in to your Forma account to sync this workspace.",
      401,
      "unauthorized",
    );
  const user = { id: data.user.id, email: data.user.email ?? null };
  return {
    user,
    async read() {
      const { data: result, error: readError } = await client.rpc(
        "forma_read_workspace",
      );
      if (readError)
        throw new CloudServerError(
          "Account storage could not be reached. Your local records are preserved.",
          503,
          "unavailable",
        );
      return cleanWorkspace(result);
    },
    async write(input) {
      const { data: result, error: writeError } = await client.rpc(
        "forma_commit_workspace",
        {
          p_data: input.data,
          p_base_revision: input.baseRevision,
          p_operation_id: input.operationId,
        },
      );
      if (writeError)
        throw new CloudServerError(
          "Account storage could not save these changes. Your local records are preserved.",
          503,
          "unavailable",
        );
      if (
        !result ||
        typeof result !== "object" ||
        !["ok", "conflict", "operation_mismatch"].includes(result.status)
      )
        throw new CloudServerError(
          "Account storage returned an invalid response.",
          502,
          "unavailable",
        );
      return {
        ...cleanWorkspace(result),
        status: result.status,
        replayed: result.replayed === true,
      };
    },
  };
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new CloudServerError(
      "Send this workspace as JSON.",
      415,
      "invalid_request",
    );
  const limit = MAX_BACKUP_BYTES + 4096;
  const declared = Number(request.headers.get("content-length"));
  if (declared > limit)
    throw new CloudServerError(
      "This workspace exceeds Forma’s supported 64 MB capacity.",
      413,
      "capacity",
    );
  if (!request.body)
    throw new CloudServerError(
      "The workspace request is empty.",
      400,
      "invalid_request",
    );
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let json = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new CloudServerError(
          "This workspace exceeds Forma’s supported 64 MB capacity.",
          413,
          "capacity",
        );
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof CloudServerError) throw error;
    throw new CloudServerError(
      "The workspace request contains invalid JSON.",
      400,
      "invalid_request",
    );
  } finally {
    reader.releaseLock();
  }
}
export function validateWorkspaceWrite(input: unknown): WorkspaceWrite {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CloudServerError(
      "The workspace request is invalid.",
      400,
      "invalid_request",
    );
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !["data", "baseRevision", "operationId"].includes(key),
    ) ||
    !Number.isSafeInteger(value.baseRevision) ||
    (value.baseRevision as number) < 0 ||
    !uuid(value.operationId)
  )
    throw new CloudServerError(
      "Use a valid workspace revision and operation ID. Account ownership comes from your verified session.",
      400,
      "invalid_request",
    );
  try {
    const data = JSON.parse(encodeBackup(validateData(value.data))) as Data;
    return {
      data,
      baseRevision: value.baseRevision as number,
      operationId: value.operationId.toLowerCase(),
    };
  } catch (error) {
    throw new CloudServerError(
      error instanceof Error ? error.message : "This workspace is invalid.",
      400,
      "invalid_data",
    );
  }
}
export function createCloudHandlers(
  authenticate: (
    token: string,
  ) => Promise<CloudSession> = authenticateCloudRequest,
) {
  async function run(
    request: Request,
    action: (session: CloudSession) => Promise<Response>,
  ): Promise<Response> {
    try {
      if (new URL(request.url).search)
        throw new CloudServerError(
          "Account endpoints do not accept an owner or Codeforces handle.",
          400,
          "invalid_request",
        );
      const authorization = request.headers.get("authorization") ?? "";
      const match = authorization.match(/^Bearer ([^\s]{1,16384})$/i);
      // Report missing configuration even to the unauthenticated local UI.
      if (!match) {
        if (
          authenticate === authenticateCloudRequest &&
          (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
            !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
        )
          throw new CloudServerError(
            "Account sync is not configured. Your local workspace remains available.",
            503,
            "not_configured",
          );
        throw new CloudServerError(
          "Sign in to your Forma account to sync this workspace.",
          401,
          "unauthorized",
        );
      }
      const session = await authenticate(match[1]);
      if (!uuid(session.user.id))
        throw new CloudServerError(
          "The verified account identity is invalid.",
          401,
          "unauthorized",
        );
      return await action(session);
    } catch (error) {
      const known = error instanceof CloudServerError;
      return response(
        {
          error: known
            ? error.message
            : "Account sync did not finish. Your local changes are preserved.",
          code: known ? error.code : "unavailable",
        },
        known ? error.status : 503,
      );
    }
  }
  return {
    account: (request: Request) =>
      run(request, async (session) => response({ user: session.user })),
    read: (request: Request) =>
      run(request, async (session) =>
        response(cleanWorkspace(await session.read())),
      ),
    write: (request: Request) =>
      run(request, async (session) => {
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin)
          throw new CloudServerError(
            "Save your account workspace from Forma’s own origin.",
            403,
            "invalid_origin",
          );
        const input = validateWorkspaceWrite(await readLimitedJson(request));
        const result = await session.write(input);
        const current = cleanWorkspace(result);
        if (result.status === "conflict")
          return response(
            {
              error:
                "Another device changed this workspace. Your local changes are preserved for reconciliation.",
              code: "conflict",
              ...current,
            },
            409,
          );
        if (result.status === "operation_mismatch")
          return response(
            {
              error:
                "This operation ID was already used for different changes. The previous write remains intact.",
              code: "operation_mismatch",
              ...current,
            },
            409,
          );
        return response({ ...current, replayed: result.replayed === true });
      }),
  };
}
