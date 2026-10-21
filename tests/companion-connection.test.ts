import assert from "node:assert/strict";
import test from "node:test";
import { companionConnectionError } from "../packages/integrations/connection-error";

test("missing and stale companion endpoints explain how to recover without exposing the socket path", () => {
  for (const code of ["ENOENT", "ECONNREFUSED"]) {
    const original = Object.assign(new Error(`connect ${code} /Users/private/notebook/runtime/companion.sock`), { code });
    const recovery = companionConnectionError(original);
    assert.match(recovery.message, /Start Forma Companion, then retry/);
    assert.doesNotMatch(recovery.message, /\/Users\/|pair/i);
    assert.equal(recovery.cause, original);
    assert.equal((recovery as NodeJS.ErrnoException).code, code);
  }
});

test("pairing, permission and other connection errors retain their original explanation", () => {
  for (const error of [
    new Error("Pair this extension with Forma Companion again."),
    Object.assign(new Error("Socket access denied."), { code: "EACCES" }),
    Object.assign(new Error("Connection timed out."), { code: "ETIMEDOUT" }),
    new Error("An unrelated operation mentioned ENOENT."),
  ]) assert.equal(companionConnectionError(error), error);
});
