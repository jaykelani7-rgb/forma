import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sameOriginRequest } from "../src/lib/request-origin";
import { createCloudHandlers } from "../src/lib/cloud-server";
import { createShareHandlers } from "../src/lib/share-links-server";
import { emptyData } from "../src/lib/model";

test("origin validation uses the browser Host despite Next's internal hostname and rejects cross-site and forwarded-host spoofing", () => {
  const request = (origin: string, host = "127.0.0.1:3003") =>
    new Request("http://localhost:3003/api/shares", {
      headers: {
        Origin: origin,
        Host: host,
        "X-Forwarded-Host": "attacker.test",
      },
    });
  assert.equal(sameOriginRequest(request("http://127.0.0.1:3003")), true);
  assert.equal(sameOriginRequest(request("http://attacker.test")), false);
  assert.equal(sameOriginRequest(request("https://127.0.0.1:3003")), false);
  assert.equal(sameOriginRequest(request("null")), false);
  assert.equal(
    sameOriginRequest(
      request("http://attacker.test", "attacker.test@127.0.0.1:3003"),
    ),
    false,
  );
  assert.equal(
    sameOriginRequest(
      new Request("https://internal.test/api/shares", {
        headers: { Host: "forma.example", Origin: "https://forma.example" },
      }),
    ),
    true,
  );
});

test("workspace and publication writes accept a valid browser origin and reject another origin before saving", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let saved = 0,
    published = 0;
  const cloud = createCloudHandlers(async () => ({
    user: { id, email: null },
    read: async () => ({ revision: 0, data: null }),
    write: async (input) => {
      saved++;
      return { status: "ok", revision: 1, data: input.data };
    },
  }));
  const shares = createShareHandlers({
    authenticate: async () => ({
      userId: id,
      list: async () => [],
      revoke: async () => null,
      publish: async () => {
        published++;
        return {
          share: {
            id: randomUUID(),
            token: "a".repeat(64),
            title: "Foundation",
            publishedAt: new Date().toISOString(),
            revokedAt: null,
          },
          replayed: false,
        };
      },
    }),
  });
  const request = (
    path: string,
    body: unknown,
    origin = "http://127.0.0.1:3003",
  ) =>
    new Request(`http://localhost:3003${path}`, {
      method: "POST",
      headers: {
        Host: "127.0.0.1:3003",
        Origin: origin,
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const workspace = {
    data: emptyData(),
    baseRevision: 0,
    operationId: randomUUID(),
  };
  const publication = {
    file: {
      format: "forma-track",
      version: 1,
      track: { title: "Foundation", stages: [] },
    },
    operationId: randomUUID(),
  };
  assert.equal(
    (await cloud.write(request("/api/workspace", workspace))).status,
    200,
  );
  assert.equal(
    (await shares.publish(request("/api/shares", publication))).status,
    200,
  );
  assert.equal(
    (
      await cloud.write(
        request("/api/workspace", workspace, "http://attacker.test"),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await shares.publish(
        request("/api/shares", publication, "http://attacker.test"),
      )
    ).status,
    403,
  );
  assert.equal(saved, 1);
  assert.equal(published, 1);
});
