import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { shareDatabase } from "./helpers/share-database";
import {
  createShareHandlers,
  createShareRateLimit,
  type ShareSession,
} from "../src/lib/share-links-server";
import { CloudServerError } from "../src/lib/cloud-server";
import {
  canonicalSharedTrack,
  sharedTrackFromTrack,
} from "../src/lib/shared-tracks";
import { importTrack } from "../src/lib/tracks";
import { emptyData } from "../src/lib/model";

const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(64);
const curriculum = () =>
  canonicalSharedTrack({
    format: "forma-track",
    version: 1,
    track: {
      title: "Careful boundaries",
      shareDescription: "Explicit public attribution: A friend.",
      stages: [
        {
          title: "Foundation",
          description: "Stay precise.",
          suggestedTime: "20 minutes",
          problems: [
            {
              title: "Sereja and Dima",
              code: "381A",
              url: "https://codeforces.com/contest/381/problem/A",
              rating: 800,
              hint: "Keep both boundaries.",
            },
            {
              title: "Split",
              code: "1030A1",
              url: "https://codeforces.com/problemset/problem/1030/A1",
              rating: null,
            },
            {
              title: "Gym",
              code: "100001A",
              url: "https://codeforces.com/gym/100001/problem/A",
              rating: null,
            },
          ],
        },
      ],
    },
  });
const summary = () => ({
  id: randomUUID(),
  token,
  title: "Careful boundaries",
  publishedAt: new Date().toISOString(),
  revokedAt: null as string | null,
});
function request(method = "GET", value?: unknown, auth = "alice", suffix = "") {
  return new Request(`http://forma.test/api/shares${suffix}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(value ? { "Content-Type": "application/json" } : {}),
    },
    body: value ? JSON.stringify(value) : undefined,
  });
}

test("publication rebuilds the curriculum allowlist and anonymous responses contain only curriculum", async () => {
  const file = curriculum();
  let stored: unknown = null;
  let calls = 0;
  const own = summary();
  const session: ShareSession = {
    userId: alice,
    publish: async (clean) => {
      calls++;
      stored = clean;
      return { share: own, replayed: false };
    },
    list: async () => [own],
    revoke: async () => null,
  };
  const handlers = createShareHandlers({
    authenticate: async (bearer) => {
      assert.equal(bearer, "alice");
      return session;
    },
    resolve: async () => stored,
  });
  const accepted = await handlers.publish(
    request("POST", { file, operationId: randomUUID() }),
  );
  assert.equal(accepted.status, 200);
  assert.equal(calls, 1);
  const publicResponse = await handlers.read(
    request("GET", undefined, ""),
    token,
  );
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(await publicResponse.json(), { file });
  for (const name of ["cache-control", "cdn-cache-control"])
    assert.match(publicResponse.headers.get(name)!, /no-store/);
  assert.match(publicResponse.headers.get("x-robots-tag")!, /noindex/);
  for (const privateField of [
    "userId",
    "account",
    "attempts",
    "notes",
    "schedule",
    "sourceName",
  ]) {
    const result = await handlers.publish(
      request("POST", {
        file: { ...file, [privateField]: "private" },
        operationId: randomUUID(),
      }),
    );
    assert.equal(result.status, 400);
  }
  assert.equal(calls, 1);
  const spoofed = await handlers.publish(
    request("POST", { file, operationId: randomUUID(), ownerId: bob }),
  );
  assert.equal(spoofed.status, 400);
  const nested = structuredClone(file) as unknown as {
    track: Record<string, unknown>;
  };
  nested.track.notes = "private";
  assert.equal(
    (
      await handlers.publish(
        request("POST", { file: nested, operationId: randomUUID() }),
      )
    ).status,
    400,
  );
});

test("a private notebook produces an immutable publication without its identity or learning records", () => {
  const data = importTrack(
    emptyData(),
    {
      id: randomUUID(),
      title: "Personal curriculum",
      sourceName: "PRIVATE-FILENAME.docx",
      sourceFingerprint: "PRIVATE-SOURCE",
      stages: [
        {
          id: randomUUID(),
          title: "Foundation",
          description: "Optional curriculum text",
          suggestedTime: "20 min",
          entries: [
            {
              id: randomUUID(),
              title: "Practice",
              code: "381A",
              url: "https://codeforces.com/problemset/problem/381/A",
              rating: 800,
              pattern: "Optional hint",
            },
          ],
        },
      ],
    },
    { duplicates: "reject" },
  );
  data.problems[0].revisionCue = "PRIVATE-NOTE";
  data.codeforces.connectedHandle = "PRIVATE-HANDLE";
  const snapshot = sharedTrackFromTrack(data, data.tracks![0].id);
  const shared = canonicalSharedTrack(snapshot);
  const before = JSON.stringify(shared);
  data.tracks![0].title = "Revised private curriculum";
  data.problems[0].revisionCue = "CHANGED";
  assert.equal(JSON.stringify(shared), before);
  assert.doesNotMatch(
    before,
    /PRIVATE-|CHANGED|Optional hint|Optional curriculum/,
  );
  assert.notEqual(
    sharedTrackFromTrack(data, data.tracks![0].id).track.title,
    shared.track.title,
  );
});

test("management denies anonymous/spoofed requests and public resolution never enumerates", async () => {
  let verified = 0,
    resolved = 0;
  const own = summary();
  const handlers = createShareHandlers({
    authenticate: async (auth) => {
      verified++;
      if (auth !== "alice")
        throw new CloudServerError("Sign in", 401, "unauthorized");
      return {
        userId: alice,
        list: async () => [own],
        publish: async () => ({ share: own, replayed: false }),
        revoke: async (id) => (id === own.id ? own : null),
      };
    },
    resolve: async () => {
      resolved++;
      return curriculum();
    },
  });
  assert.equal(
    (await handlers.list(request("GET", undefined, ""))).status,
    401,
  );
  assert.equal(
    (await handlers.list(request("GET", undefined, "bob"))).status,
    401,
  );
  assert.equal(
    (await handlers.list(request("GET", undefined, "alice", "?ownerId=" + bob)))
      .status,
    400,
  );
  assert.equal((await handlers.read(request(), "*")).status, 404);
  assert.equal(resolved, 0);
  assert.equal(
    (await handlers.revoke(request("DELETE"), randomUUID())).status,
    404,
  );
  assert.equal(verified, 2);
  const crossOrigin = new Request("http://forma.test/api/shares", {
    method: "POST",
    headers: { Authorization: "Bearer alice", Origin: "https://other.test" },
  });
  assert.equal((await handlers.publish(crossOrigin)).status, 403);
});

test("invalid versions, unsafe identities and oversized streams are rejected before publication", async () => {
  let writes = 0;
  const handlers = createShareHandlers({
    authenticate: async () => ({
      userId: alice,
      list: async () => [],
      publish: async () => {
        writes++;
        return { share: summary(), replayed: false };
      },
      revoke: async () => null,
    }),
    resolve: async () => ({ ...curriculum(), version: 99 }),
  });
  for (const file of [
    { ...curriculum(), version: 2 },
    { ...curriculum(), track: { ...curriculum().track, title: "" } },
    { ...curriculum(), notes: "private" },
  ])
    assert.equal(
      (
        await handlers.publish(
          request("POST", { file, operationId: randomUUID() }),
        )
      ).status,
      400,
    );
  const unsafe = curriculum();
  unsafe.track.stages[0].problems[0].url = "javascript:alert(1)";
  assert.equal(
    (
      await handlers.publish(
        request("POST", { file: unsafe, operationId: randomUUID() }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handlers.publish(
        request("POST", { file: curriculum(), operationId: "not-stable" }),
      )
    ).status,
    400,
  );
  const huge = request("POST", {
    file: "x".repeat(5 * 1024 * 1024 + 4096),
    operationId: randomUUID(),
  });
  assert.equal((await handlers.publish(huge)).status, 413);
  assert.equal((await handlers.read(request(), token)).status, 404);
  assert.equal(writes, 0);
});

test("unconfigured sharing explains file export and burst limiting is bounded and recovers", async () => {
  const old = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const response = await createShareHandlers().list(
      request("GET", undefined, ""),
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /download.*track file/);
  } finally {
    if (old !== undefined) process.env.SUPABASE_SECRET_KEY = old;
  }
  let now = 0;
  const limit = createShareRateLimit(() => now);
  for (let i = 0; i < 120; i++) assert.equal(limit("one"), true);
  assert.equal(limit("one"), false);
  now = 60000;
  assert.equal(limit("one"), true);
  const handlers = createShareHandlers({ rateLimit: () => false });
  assert.equal((await handlers.read(request(), token)).status, 429);
});

test("forged forwarding addresses cannot bypass the global or authenticated-owner burst limits", async () => {
  let resolved = 0;
  const publicHandlers = createShareHandlers({
    rateLimit: createShareRateLimit(() => 0),
    resolve: async () => {
      resolved++;
      return null;
    },
  });
  const forwarded = (index: number, auth = "") =>
    new Request("http://forma.test/api/shares", {
      headers: {
        "x-forwarded-for": `untrusted-${index}`,
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
    });
  for (let index = 0; index < 1200; index++)
    assert.equal(
      (await publicHandlers.read(forwarded(index), token)).status,
      404,
    );
  assert.equal((await publicHandlers.read(forwarded(1200), token)).status, 429);
  assert.equal(resolved, 1200);
  let listed = 0;
  const privateHandlers = createShareHandlers({
    rateLimit: createShareRateLimit(() => 0),
    authenticate: async () => ({
      userId: alice,
      list: async () => {
        listed++;
        return [];
      },
      publish: async () => ({ share: summary(), replayed: false }),
      revoke: async () => null,
    }),
  });
  for (let index = 0; index < 120; index++)
    assert.equal(
      (await privateHandlers.list(forwarded(index, "alice"))).status,
      200,
    );
  assert.equal(
    (await privateHandlers.list(forwarded(120, "alice"))).status,
    429,
  );
  assert.equal(listed, 120);
});

test("publication rejects misleading content types and private fields at every curriculum level", async () => {
  let writes = 0;
  const handlers = createShareHandlers({
    authenticate: async () => ({
      userId: alice,
      list: async () => [],
      publish: async () => {
        writes++;
        return { share: summary(), replayed: false };
      },
      revoke: async () => null,
    }),
  });
  const wrongType = new Request("http://forma.test/api/shares", {
    method: "POST",
    headers: {
      Authorization: "Bearer alice",
      "Content-Type": "application/jsonp",
    },
    body: JSON.stringify({ file: curriculum(), operationId: randomUUID() }),
  });
  assert.equal((await handlers.publish(wrongType)).status, 415);
  for (const location of ["stage", "membership"]) {
    const file = curriculum();
    const target =
      location === "stage"
        ? file.track.stages[0]
        : file.track.stages[0].problems[0];
    Object.assign(target, {
      privateNotes: "PRIVATE-NOTE",
      sourceName: "PRIVATE-FILE.docx",
    });
    assert.equal(
      (
        await handlers.publish(
          request("POST", { file, operationId: randomUUID() }),
        )
      ).status,
      400,
    );
  }
  assert.equal(writes, 0);
});

test("actual PostgreSQL migration enforces owner access, immutable snapshots, idempotency, quotas and revocation", async () => {
  const { db, as } = await shareDatabase();
  try {
    await db.query("insert into auth.users values ($1),($2)", [alice, bob]);
    const file = curriculum(),
      operation = randomUUID();
    const publish = async (owner: string, value = file, op = operation) =>
      (
        await as<{
          result: { share: ReturnType<typeof summary>; replayed: boolean };
        }>(
          "authenticated",
          owner,
          "select public.forma_publish_share($1::jsonb,$2::uuid) result",
          [JSON.stringify(value), op],
        )
      ).rows[0].result;
    const first = await publish(alice);
    assert.match(first.share.token, /^[a-f0-9]{64}$/);
    assert.equal(first.replayed, false);
    const retry = await publish(alice);
    assert.equal(retry.share.token, first.share.token);
    assert.equal(retry.share.id, first.share.id);
    assert.equal(retry.replayed, true);
    const revised = structuredClone(file);
    revised.track.title = "Revised boundaries";
    await assert.rejects(() => publish(alice, revised), /operation changed/);
    const second = await publish(alice, revised, randomUUID());
    assert.notEqual(second.share.token, first.share.token);
    assert.equal(
      (
        await as(
          "authenticated",
          bob,
          "select * from forma_private.shared_tracks",
        )
      ).rows.length,
      0,
    );
    assert.deepEqual(
      (
        await as<{ result: unknown[] }>(
          "authenticated",
          bob,
          "select public.forma_list_shares() result",
        )
      ).rows[0].result,
      [],
    );
    assert.equal(
      (
        await as<{ result: unknown }>(
          "authenticated",
          bob,
          "select public.forma_revoke_share($1) result",
          [first.share.id],
        )
      ).rows[0].result,
      null,
    );
    assert.equal(
      (
        await as<{ result: unknown[] }>(
          "authenticated",
          alice,
          "select public.forma_list_shares() result",
        )
      ).rows[0].result.length,
      2,
    );
    for (const sql of [
      "select * from forma_private.shared_tracks",
      "select public.forma_list_shares()",
      `select public.forma_resolve_share('${first.share.token}')`,
    ])
      await assert.rejects(() => as("anon", "", sql), /permission denied/);
    await assert.rejects(
      () =>
        as("authenticated", alice, "select public.forma_resolve_share($1)", [
          first.share.token,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        as(
          "authenticated",
          alice,
          "update forma_private.shared_tracks set file='{}'",
        ),
      /permission denied/,
    );
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of [
        "insert into forma_private.shared_tracks(user_id,operation_id,file) values ($1,$2,$3::jsonb)",
        "delete from forma_private.shared_tracks where user_id=$1 and operation_id=$2 and file=$3::jsonb",
      ])
        await assert.rejects(
          () =>
            as(role, alice, sql, [alice, randomUUID(), JSON.stringify(file)]),
          /permission denied/,
        );
    }
    await assert.rejects(
      () =>
        as(
          "authenticated",
          alice,
          "select public.forma_list_shares()",
          [],
          true,
        ),
      /authenticated owner/,
    );
    await assert.rejects(
      () =>
        publish(
          alice,
          { ...file, notes: "private" } as typeof file,
          randomUUID(),
        ),
      /Invalid shared curriculum/,
    );
    for (const changes of [
      { code: "381B" },
      {
        code: "1000000000A",
        url: "https://codeforces.com/problemset/problem/1000000000/A",
      },
      {
        code: "381A1234567890",
        url: "https://codeforces.com/problemset/problem/381/A1234567890",
      },
      {
        url: "https://codeforces.com/problemset/problem/381/A?private=tracking",
      },
      { url: "https://example.test/381/A" },
      { rating: 800.5 },
      { hint: "x".repeat(2001) },
      { privateNotes: "PRIVATE-NOTE" },
    ]) {
      const invalid = structuredClone(file);
      Object.assign(invalid.track.stages[0].problems[0], changes);
      await assert.rejects(
        () => publish(alice, invalid, randomUUID()),
        /Invalid shared curriculum/,
      );
    }
    for (const stages of [
      Array.from({ length: 101 }, () => ({
        ...file.track.stages[0],
        problems: [],
      })),
      [
        {
          ...file.track.stages[0],
          problems: Array(1001).fill(file.track.stages[0].problems[0]),
        },
      ],
    ])
      await assert.rejects(
        () =>
          publish(
            alice,
            { ...file, track: { ...file.track, stages } },
            randomUUID(),
          ),
        /Invalid shared curriculum/,
      );
    const read = async (t: string) =>
      (
        await as<{ result: unknown }>(
          "service_role",
          "",
          "select public.forma_resolve_share($1) result",
          [t],
        )
      ).rows[0].result;
    assert.deepEqual(await read(first.share.token), file);
    await as("authenticated", alice, "select public.forma_revoke_share($1)", [
      first.share.id,
    ]);
    assert.equal(await read(first.share.token), null);
    assert.deepEqual(await read(second.share.token), revised);
    assert.ok((await publish(alice)).share.revokedAt);
    assert.equal(await read(first.share.token), null);
    for (let i = 2; i < 10; i++) await publish(alice, file, randomUUID());
    await assert.rejects(
      () => publish(alice, file, randomUUID()),
      /Publication limit/,
    );
    assert.equal((await publish(alice)).replayed, true);
    const other = await publish(bob);
    assert.notEqual(other.share.token, first.share.token);
    // The persistent lifetime quota also applies after older links leave the
    // hourly window, and replay of an existing operation still succeeds.
    await db.query(
      "insert into forma_private.shared_tracks(user_id,operation_id,file,published_at,revoked_at) select $1,gen_random_uuid(),$2::jsonb,now()-interval '1 day',now()-interval '1 day' from generate_series(1,99)",
      [bob, JSON.stringify(file)],
    );
    await assert.rejects(
      () => publish(bob, file, randomUUID()),
      /Publication limit/,
    );
    assert.equal((await publish(bob)).share.token, other.share.token);
  } finally {
    await db.close();
  }
});
