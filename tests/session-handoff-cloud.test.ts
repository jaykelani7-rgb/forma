import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { shareDatabase } from "./helpers/share-database";
import { CloudServerError, type CloudSession } from "../src/lib/cloud-server";
import { createHandoffHandler } from "../src/lib/handoff-server";
import { emptyData } from "../src/lib/model";
import type { SessionHandoffPacket } from "../src/lib/session-handoff";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const claimKey = randomBytes(32).toString("base64url");
const sourceKey = randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceDigest = hash(sourceKey);
const packet: SessionHandoffPacket = {
  version: 1,
  problem: { title: "Watermelon", url: "https://codeforces.com/problemset/problem/4/A", problemCode: "4A", rating: null },
  session: {
    id: "companion:handoff-test", startedAt: "2026-11-09T01:00:00.000Z",
    elapsedMs: 130_500, targetMinutes: 30, notes: "First note", runningSince: null, phase: "focus",
  },
  thread: "Check the minimum even value.",
};

function request(body: unknown, token?: string, origin = "http://forma.test") {
  return new Request("http://forma.test/api/handoff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function fixture() {
  const { db, as } = await shareDatabase();
  await db.exec(await readFile(new URL("../supabase/migrations/20261109020000_session_handoffs.sql", import.meta.url), "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2)", [alice, bob]);
  let beforeReceive: (() => Promise<unknown>) | undefined;
  const user = (token: string) => {
    if (token !== alice && token !== bob) throw new CloudServerError("Sign in.", 401, "unauthorized");
    return token;
  };
  const read = async (token: string) => (await as<{ result: Awaited<ReturnType<CloudSession["read"]>> }>(
    "authenticated", user(token), "select public.forma_read_workspace() as result",
  )).rows[0].result;
  const post = createHandoffHandler({
    authenticate: async token => ({
      user: { id: user(token), email: token === alice ? "alice@example.test" : "bob@example.test" },
      read: () => read(token),
      write: async () => { throw new Error("This path must use the atomic receipt RPC."); },
    }),
    async manage(input) {
      return (await as<{ result: unknown }>("service_role", "",
        "select public.forma_manage_handoff($1,$2,$3,$4,$5,$6,$7) as result",
        [input.action, input.id, input.accountId ?? null, input.accountLabel ?? null, input.sourceDigest ?? null,
          input.claimDigest ?? null, input.packet ? JSON.stringify(input.packet) : null],
      )).rows[0].result;
    },
    async receive(token, input) {
      if (beforeReceive) {
        const action = beforeReceive;
        beforeReceive = undefined;
        await action();
      }
      return (await as<{ result: unknown }>("authenticated", user(token), "select public.forma_receive_handoff($1,$2,$3,$4) as result",
        [input.id, input.claimDigest, JSON.stringify(input.data), input.baseRevision],
      )).rows[0].result;
    },
  });
  const commitEmpty = (revision: number) => as("authenticated", alice, "select public.forma_commit_workspace($1,$2,$3)",
    [JSON.stringify(emptyData()), revision, randomUUID()]);
  return { db, as, post, read, commitEmpty, duringNextReceive: (work: () => Promise<unknown>) => { beforeReceive = work; } };
}

test("handoff authorizes each side separately, writes one paused session, and retains its receipt", async () => {
  const { db, as, post, read, commitEmpty } = await fixture();
  try {
    const id = randomUUID();
    const link = { action: "link", id, claimKey, sourceDigest };
    const send = { action: "source-send", id, sourceKey, accountId: alice, packet };
    assert.equal((await post(request(link))).status, 401);
    assert.equal((await post(request(link, alice, "https://elsewhere.test"))).status, 403);
    assert.equal((await post(request({ ...link, accountId: bob }, alice))).status, 400);
    await assert.rejects(as("authenticated", alice, "select public.forma_manage_handoff('link',$1)", [id]), /permission denied/i);
    await assert.rejects(as("anon", "", "select public.forma_receive_handoff($1,$2,null,0)", [id, hash(claimKey)]), /permission denied/i);

    assert.deepEqual(await (await post(request({ action: "source-status", id, sourceKey }))).json(), { state: "missing" });
    const linked = await post(request(link, alice));
    assert.match(linked.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await linked.json(), { state: "linked", accountId: alice, accountLabel: "alice@example.test" });
    assert.equal((await post(request(link, alice))).status, 200);
    assert.equal((await post(request(link, bob))).status, 409);
    assert.deepEqual(await (await post(request({ action: "destination-status", id, claimKey }, bob))).json(), { state: "missing" });
    assert.deepEqual(await (await post(request({ ...send, sourceKey: claimKey }))).json(), { state: "missing" });

    const ready = await (await post(request(send))).json();
    assert.equal(ready.state, "ready");
    assert.equal(ready.sessionId, packet.session.id);
    assert.equal(Object.hasOwn(ready, "packet"), false);
    const source = await (await post(request({ action: "source-status", id, sourceKey }))).json();
    assert.equal(Object.hasOwn(source, "packet"), false);
    const destination = await (await post(request({ action: "destination-status", id, claimKey }, alice))).json();
    assert.deepEqual(destination.packet, packet);
    assert.deepEqual(await (await post(request({ action: "receive", id, claimKey }, bob))).json(), { state: "missing" });
    assert.equal((await read(bob)).revision, 0);

    const received = await (await post(request({ action: "receive", id, claimKey }, alice))).json();
    assert.equal(received.state, "received");
    assert.equal(received.sessionId, packet.session.id);
    assert.equal(Object.hasOwn(received, "packet"), false);
    const workspace = await read(alice);
    assert.equal(workspace.revision, 1);
    assert.deepEqual(workspace.data?.session && {
      id: workspace.data.session.id,
      elapsed: workspace.data.session.elapsedMs,
      runningSince: workspace.data.session.runningSince,
    }, { id: packet.session.id, elapsed: packet.session.elapsedMs, runningSince: null });
    assert.match(workspace.data?.session?.notes ?? "", /Check the minimum even value/);

    await commitEmpty(1);
    const replay = await (await post(request({ action: "receive", id, claimKey }, alice))).json();
    assert.deepEqual(replay, received);
    assert.equal((await read(alice)).revision, 2);
    assert.equal((await read(alice)).data?.session, null);
    assert.deepEqual(await (await post(request({ action: "source-cancel", id, sourceKey }))).json(), received);
    const row = (await db.query<{ packet: unknown; source_digest: string; claim_digest: string }>(
      "select packet,source_digest,claim_digest from forma_private.session_handoffs where id=$1", [id],
    )).rows[0];
    assert.deepEqual(row, { packet: null, source_digest: sourceDigest, claim_digest: hash(claimKey) });
  } finally {
    await db.close();
  }
});

test("workspace conflicts leave the source locked, while cancel or expiry produces a durable release", async () => {
  const { db, post, read, commitEmpty, duringNextReceive } = await fixture();
  try {
    const id = randomUUID();
    await post(request({ action: "link", id, claimKey, sourceDigest }, alice));
    await post(request({ action: "source-send", id, sourceKey, accountId: alice, packet }));
    duringNextReceive(() => commitEmpty(0));
    const stale = await post(request({ action: "receive", id, claimKey }, alice));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "workspace_changed");
    assert.equal((await (await post(request({ action: "source-status", id, sourceKey }))).json()).state, "ready");
    // Withdraw after the web request has read a ready packet but before it
    // acquires the database receipt lock.
    duringNextReceive(() => post(request({ action: "source-cancel", id, sourceKey })));
    const cancel = await (await post(request({ action: "receive", id, claimKey }, alice))).json();
    assert.equal(cancel.state, "cancelled");
    assert.deepEqual(await (await post(request({ action: "receive", id, claimKey }, alice))).json(), cancel);
    assert.equal((await read(alice)).data?.session, null);

    const expiredId = randomUUID();
    await post(request({ action: "link", id: expiredId, claimKey, sourceDigest }, alice));
    await post(request({ action: "source-send", id: expiredId, sourceKey, accountId: alice, packet }));
    await db.query("update forma_private.session_handoffs set expires_at=now()-interval '1 minute' where id=$1", [expiredId]);
    assert.equal((await (await post(request({ action: "source-status", id: expiredId, sourceKey }))).json()).state, "cancelled");
    const expired = (await db.query<{ packet: unknown }>("select packet from forma_private.session_handoffs where id=$1", [expiredId])).rows[0];
    assert.equal(expired.packet, null);
  } finally {
    await db.close();
  }
});
