import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { startBrowserTransport } from "../apps/desktop/main/browser-transport";
import { BoundedJsonLines } from "../packages/integrations/protocol";

test("the browser socket authenticates a separate capability and never dispatches IDE commands", async () => {
  const folder = await mkdtemp(join(tmpdir(), "forma-browser-socket-")), endpoint = join(folder, "runtime/browser.sock");
  let credential: string | null = randomBytes(32).toString("base64url"), calls = 0;
  const server = await startBrowserTransport({ endpoint, credential: () => credential, message: async () => { calls++; return { ok: true, status: "choose-file", proposalId: "proposal" }; } });
  function request(value: unknown) { return new Promise<{ ok: boolean }>((resolve, reject) => { const socket = connect(endpoint), lines = new BoundedJsonLines(); socket.setTimeout(3000, () => { socket.destroy(); reject(new Error("timeout")); }); socket.on("error", reject); socket.on("connect", () => socket.write(JSON.stringify(value) + "\n")); socket.on("data", chunk => { const batch = lines.push(chunk); if (batch.length) { socket.destroy(); resolve(JSON.parse(batch[0].toString())); } }); }); }
  try {
    assert.equal((await request({ credential: randomBytes(32).toString("base64url"), message: { kind: "propose", url: "https://codeforces.com/contest/4/problem/A", title: "Watermelon" } })).ok, false);
    assert.equal((await request({ credential, message: { kind: "start", payload: {} } })).ok, false);
    assert.equal((await request({ credential, command: { type: "reflect", payload: {} }, message: { kind: "status", proposalId: "x" } })).ok, false);
    assert.equal(calls, 0);
    assert.equal((await request({ credential, message: { kind: "propose", url: "https://codeforces.com/gym/100001/problem/A2", title: "Gym" } })).ok, true); assert.equal(calls, 1);
    credential = null; assert.equal((await request({ credential: "x".repeat(43), message: { kind: "status", proposalId: "x" } })).ok, false);
  } finally { server.close(); await rm(folder, { recursive: true, force: true }); }
});
