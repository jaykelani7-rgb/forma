import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { emptyData } from "../src/lib/model";
import { MAX_BACKUP_BYTES } from "../src/lib/concurrency";
import {
  CloudServerError,
  createCloudHandlers,
  type CloudSession,
  type CloudWriteResult,
  validateWorkspaceWrite,
} from "../src/lib/cloud-server";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const operation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const laterOperation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = (method = "GET", body?: unknown, token = "alice") =>
  new Request("http://localhost/api/workspace", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("account endpoints verify every request, ignore no supplied owner, and never cache private data", async () => {
  let verified = 0;
  let reads = 0;
  const handlers = createCloudHandlers(async (token) => {
    verified++;
    if (token !== "alice")
      throw new CloudServerError("Invalid session", 401, "unauthorized");
    return {
      user: { id: alice, email: "alice@example.com" },
      read: async () => {
        reads++;
        return { revision: 0, data: null };
      },
      write: async (input) => ({ status: "ok", revision: 1, data: input.data }),
    };
  });
  const account = await handlers.account(request());
  assert.equal(account.status, 200);
  assert.equal((await account.json()).user.id, alice);
  const read = await handlers.read(request());
  assert.equal(read.status, 200);
  assert.match(read.headers.get("cache-control")!, /no-store/);
  assert.equal(read.headers.get("vary"), "Authorization");
  const denied = await handlers.read(
    request("GET", undefined, "unverified-token"),
  );
  assert.equal(denied.status, 401);
  assert.equal(reads, 1);
  assert.equal(verified, 3);
  const suppliedId = await handlers.read(
    new Request(`http://localhost/api/workspace?userId=${bob}`),
  );
  assert.equal(suppliedId.status, 400);
  assert.equal(reads, 1);
});

test("account writes validate backups, reject owner spoofing and return explicit conflicts", async () => {
  let writes = 0;
  let result: CloudWriteResult = {
    status: "conflict",
    revision: 3,
    data: emptyData(),
  };
  const session: CloudSession = {
    user: { id: alice, email: null },
    read: async () => ({ revision: 3, data: emptyData() }),
    write: async () => {
      writes++;
      return result;
    },
  };
  const handlers = createCloudHandlers(async () => session);
  const valid = { data: emptyData(), baseRevision: 1, operationId: operation };
  const conflict = await handlers.write(request("POST", valid));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "conflict");
  const spoofed = await handlers.write(
    request("POST", { ...valid, userId: bob }),
  );
  assert.equal(spoofed.status, 400);
  const malformed = await handlers.write(
    request("POST", { ...valid, data: {} }),
  );
  assert.equal(malformed.status, 400);
  const oversized = await handlers.write(
    new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: {
        Authorization: "Bearer alice",
        "Content-Type": "application/json",
        "Content-Length": String(MAX_BACKUP_BYTES + 5000),
      },
      body: "{}",
    }),
  );
  assert.equal(oversized.status, 413);
  const crossOrigin = await handlers.write(
    new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: {
        Authorization: "Bearer alice",
        "Content-Type": "application/json",
        Origin: "https://another.example",
      },
      body: JSON.stringify(valid),
    }),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(writes, 1);
  result = { status: "ok", revision: 2, data: emptyData(), replayed: true };
  const retry = await handlers.write(request("POST", valid));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replayed, true);
  assert.throws(
    () => validateWorkspaceWrite({ ...valid, operationId: "unstable-id" }),
    /valid workspace revision/,
  );
});

test("unconfigured account endpoints report setup instead of fabricating authentication", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    const response = await createCloudHandlers().account(
      new Request("http://localhost/api/account"),
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "not_configured");
  } finally {
    if (previousUrl !== undefined)
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey !== undefined)
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test("the actual SQL migration enforces ownership, CAS, request idempotency and account isolation", async () => {
  const db = new PGlite();
  try {
    // The local SQL harness reproduces the roles and Auth helpers used by
    // Supabase. It runs the same migration, not a JavaScript database mock.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
      insert into auth.users values ('${alice}'),('${bob}');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261004101222_durable_workspaces.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec("set role authenticated");
    const asOwner = async (id: string, anonymous = false) => {
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [id, JSON.stringify({ is_anonymous: anonymous })],
      );
    };
    const read = async () => {
      const value = await db.query<{
        result: { revision: number; data: unknown };
      }>("select public.forma_read_workspace() as result");
      return value.rows[0].result;
    };
    const commit = async (
      data: unknown,
      baseRevision: number,
      id = operation,
    ) => {
      const value = await db.query<{
        result: {
          status: string;
          revision: number;
          data: unknown;
          replayed: boolean;
        };
      }>(
        "select public.forma_commit_workspace($1::jsonb,$2::bigint,$3::uuid) as result",
        [JSON.stringify(data), baseRevision, id],
      );
      return value.rows[0].result;
    };
    await asOwner(alice);
    assert.deepEqual(await read(), { revision: 0, data: null });
    const first = emptyData();
    first.settings.displayName = "Alice’s practice";
    const saved = await commit(first, 0);
    assert.equal(saved.status, "ok");
    assert.equal(saved.revision, 1);
    assert.equal(saved.replayed, false);
    const retry = await commit(first, 0);
    assert.equal(retry.revision, 1);
    assert.equal(retry.replayed, true);
    const changed = {
      ...first,
      settings: { ...first.settings, displayName: "Conflicting change" },
    };
    assert.equal((await commit(changed, 0)).status, "operation_mismatch");
    assert.equal((await commit(changed, 0, laterOperation)).status, "conflict");
    assert.deepEqual((await read()).data, first);
    const advanced = await commit(changed, 1, laterOperation);
    assert.equal(advanced.revision, 2);
    // A retry after a subsequent write acknowledges its original revision;
    // stale following writes are still rejected, rather than overwriting.
    assert.equal((await commit(first, 0)).revision, 1);
    assert.equal((await read()).revision, 2);
    await assert.rejects(
      db.query(
        "update forma_private.workspaces set user_id=$1 where user_id=$2",
        [bob, alice],
      ),
      /row-level security/,
    );
    await asOwner(bob);
    assert.deepEqual(await read(), { revision: 0, data: null });
    const hidden = await db.query(
      "select * from forma_private.workspaces where user_id=$1",
      [alice],
    );
    assert.equal(hidden.rows.length, 0);
    assert.equal((await commit(emptyData(), 0)).revision, 1);
    await asOwner(alice);
    assert.equal((await read()).revision, 2);
    await asOwner(alice, true);
    await assert.rejects(read(), /authenticated Forma account/);
    await db.exec("reset role; set role anon");
    await assert.rejects(read(), /permission denied/);
  } finally {
    await db.close();
  }
});

test("production handlers contact Auth getUser before every database request", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const previousFetch = globalThis.fetch;
  let verifications = 0;
  let databaseCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://forma-fixture.example";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const headers = new Headers(init?.headers);
    if (url.pathname === "/auth/v1/user") {
      verifications++;
      if (headers.get("authorization") !== "Bearer verified-fixture-token")
        return Response.json(
          { message: "Invalid access token" },
          { status: 401 },
        );
      return Response.json({
        id: alice,
        email: "alice@example.com",
        is_anonymous: false,
        role: "authenticated",
        aud: "authenticated",
        created_at: "2026-10-04T00:00:00Z",
        app_metadata: {},
        user_metadata: {},
      });
    }
    assert.equal(url.pathname, "/rest/v1/rpc/forma_read_workspace");
    assert.equal(headers.get("authorization"), "Bearer verified-fixture-token");
    databaseCalls++;
    return Response.json({ revision: 0, data: null });
  };
  try {
    const handlers = createCloudHandlers();
    assert.equal(
      (await handlers.read(request("GET", undefined, "verified-fixture-token")))
        .status,
      200,
    );
    assert.equal(
      (await handlers.read(request("GET", undefined, "verified-fixture-token")))
        .status,
      200,
    );
    assert.equal(
      (await handlers.read(request("GET", undefined, "forged-fixture-token")))
        .status,
      401,
    );
    assert.equal(verifications, 3);
    assert.equal(databaseCalls, 2);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "service-role-looking-key";
    assert.equal(
      (await handlers.read(request("GET", undefined, "verified-fixture-token")))
        .status,
      503,
    );
    assert.equal(verifications, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
