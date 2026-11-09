import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CompanionStore } from "../apps/desktop/main/store";
import { DesktopSessionHandoff } from "../apps/desktop/main/session-handoff-client";
import { applySessionHandoff, parseSessionHandoffPacket, type HandoffRemote } from "../src/lib/session-handoff";

const start = Date.parse("2026-11-09T08:00:00Z");
const accountId = "f14368fa-dbcf-4cdd-97c8-3d45483054a5";
const sessionId = "companion:source-practice";
const thread = "Check the boundary before changing the loop.";

test("a lost send acknowledgement keeps the source frozen until the matching receipt", async () => {
  const store = new CompanionStore(":memory:");
  try {
    const attached = store.command({
      id: "source-problem", type: "attach", payload: { url: "https://codeforces.com/contest/4/problem/A", title: "Watermelon" },
    }, "desktop", start);
    store.command({ id: "source-practice", type: "start", payload: {} }, "desktop", start);
    store.command({
      id: "source-thread", type: "desk-add", expectedProblemKey: "contest:4:A",
      payload: { problemId: attached.state.problemId, kind: "thread", text: thread },
    }, "desktop", start + 1_000);
    store.command({ id: "source-pause", type: "pause", payload: {} }, "desktop", start + 30_000);

    let openUrl: URL | undefined;
    let remote: HandoffRemote = { state: "linked", accountId, accountLabel: "learner@example.test" };
    let readyBody: unknown;
    const client = new DesktopSessionHandoff({
      configuredOrigin: () => "https://forma.example",
      open: async url => { openUrl = new URL(url); },
      changed: async () => {},
      async call<T>(method: string, payload?: unknown): Promise<T> {
        switch (method) {
          case "handoff-current": return store.currentHandoff() as T;
          case "handoff-begin": return store.beginHandoff(payload as Parameters<typeof store.beginHandoff>[0]) as T;
          case "handoff-mark-sending": return store.markHandoffSending(payload as Parameters<typeof store.markHandoffSending>[0]) as T;
          case "handoff-complete": return store.completeHandoff(payload as Parameters<typeof store.completeHandoff>[0]) as T;
          default: throw new Error(method);
        }
      },
      fetch: async (url, init) => {
        assert.equal(String(url), "https://forma.example/api/handoff");
        assert.equal(init?.redirect, "error");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.sourceKey, store.currentHandoff()?.sourceKey);
        if (body.action === "source-send") {
          assert.equal(store.currentHandoff()?.offered, true);
          assert.equal(body.accountId, accountId);
          readyBody = body.packet;
          throw new Error("Simulated lost acknowledgement");
        }
        if (body.action === "source-cancel") throw new Error("Simulated offline cancellation");
        return Response.json(remote);
      },
    });
    const begun = await client.begin(sessionId);
    assert.equal(begun.state, "waiting");
    const pending = store.currentHandoff()!;
    assert.equal(openUrl?.pathname, "/handoff");
    assert.equal(openUrl?.search, "");
    const fragment = new URLSearchParams(openUrl?.hash.slice(1));
    assert.equal(fragment.get("key"), pending.claimKey);
    assert.equal(fragment.get("source"), createHash("sha256").update(pending.sourceKey).digest("hex"));
    assert.ok(!openUrl?.href.includes(pending.sourceKey));
    assert.ok(!JSON.stringify(begun).includes(pending.claimKey));
    await assert.rejects(client.send({ id: begun.id, accountId: "8cd485b4-35de-48ac-9faa-c49ed452f5ba" }), /destination changed/);
    assert.equal(store.currentHandoff()?.offered, false);
    await assert.rejects(client.send({ id: begun.id, accountId }), /couldn’t reach/i);
    await assert.rejects(client.cancel(begun.id), /couldn’t reach/i);
    assert.equal(store.currentHandoff()?.offered, true);
    assert.throws(() => store.command({ id: "early-resume", type: "resume", payload: {} }), /web handoff/);
    assert.equal(store.snapshot().data.session?.elapsedMs, 30_000);

    const packet = parseSessionHandoffPacket(readyBody);
    const received = applySessionHandoff(null, packet);
    assert.equal(received.session?.id, sessionId);
    assert.equal(received.session?.runningSince, null);
    assert.equal(received.session?.elapsedMs, 30_000);
    assert.match(received.session?.notes ?? "", /Check the boundary/);
    assert.throws(() => applySessionHandoff(received, packet), /open web session/);
    remote = { state: "received", accountId, sessionId: "companion:unrelated" };
    await assert.rejects(client.refresh(begun.id), /does not match/);
    remote = { state: "received", accountId, sessionId };
    assert.equal((await client.refresh(begun.id)).state, "received");
    assert.equal(store.snapshot().data.session, null);
    assert.equal(store.snapshot().data.attempts.length, 0);
    assert.equal(await client.local(), null);
  } finally {
    store.close();
  }
});
