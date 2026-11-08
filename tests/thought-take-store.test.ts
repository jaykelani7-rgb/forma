import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThoughtTakeStore, type ThoughtTake } from "../apps/desktop/main/thought-take-store";

test("saved takes survive reopening, stay protected at rest and keep bounded metadata separate from audio", t => {
  const directory = mkdtempSync(join(tmpdir(), "forma-thought-takes-"));
  const path = join(directory, "thought-takes.sqlite");
  let available = true;
  const key = randomBytes(32);
  const protection = {
    available: () => available,
    encrypt(value: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt(value: Uint8Array) {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
  let store = new ThoughtTakeStore(path, protection);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const take: ThoughtTake = {
    id: randomUUID(), problemKey: "contest:4:A", title: "Watermelon", recordedAt: "2026-11-08T10:00:00.000Z",
    problemId: "practice-4-a", profileKey: "private-practice-handle", recoveryEpoch: "original-notebook",
    bytes: Buffer.from("fixture audio should never be written in plaintext"), mime: "audio/webm;codecs=opus",
  };

  available = false;
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.keep(take), /Protected recording storage is unavailable/);
  assert.equal(existsSync(path), false);
  available = true;
  store.keep(take);
  store.close();

  const onDisk = readFileSync(path);
  const audio = Buffer.from(take.bytes);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(onDisk.includes(audio), false);
  assert.equal(onDisk.includes(audio.toString("base64")), false);
  assert.equal(onDisk.includes(take.profileKey!), false);

  store = new ThoughtTakeStore(path, protection);
  assert.deepEqual(store.list().map(row => ({ ...row })), [{ id: take.id, problemKey: take.problemKey, title: take.title, recordedAt: take.recordedAt }]);
  assert.deepEqual(store.read(take.id), take);
  for (let count = 1; count < 4; count++) store.keep({ ...take, id: randomUUID() });
  assert.throws(() => store.keep({ ...take, id: randomUUID() }), /saved recording slots are full/);
  assert.equal(store.list().length, 4);
  available = false;
  assert.throws(() => store.read(take.id), /Unlock protected recording storage/);
  store.remove(take.id);
  assert.equal(store.read(take.id), null);
  assert.equal(store.list().length, 3);
});
