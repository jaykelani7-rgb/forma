import test from "node:test";
import assert from "node:assert/strict";
import { emptyData, type Data } from "../src/lib/model";
import { CloudConflict, createAccountSynchronizer, createSerialSyncLock, type CloudRevision, type SyncCheckpoint, type SyncRevision, type SyncStorage } from "../packages/sync/src/index";

function fixture() {
  const records = new Map<string, SyncRevision>();
  const checkpoints = new Map<string, SyncCheckpoint>();
  const recoveries: { key: string; data: Data; reason: string }[] = [];
  const storage: SyncStorage = {
    async load(key) {
      if (!records.has(key)) records.set(key, { key, revision: 1, data: emptyData(), savedAt: "2026-10-19T00:00:00.000Z" });
      return structuredClone(records.get(key)!);
    },
    async commit(key, base, data) {
      const current = records.get(key);
      assert.equal(current?.revision ?? base.revision, base.revision, "fixture expects a single writer");
      const record = { key, revision: base.revision + 1, data: structuredClone(data), savedAt: "2026-10-19T00:00:00.000Z" };
      records.set(key, record);
      return { record, conflicts: [] };
    },
    async preserveRecovery(key, data, reason) { recoveries.push({ key, data: structuredClone(data), reason }); },
    async readCheckpoint(key) { return checkpoints.has(key) ? structuredClone(checkpoints.get(key)) : undefined; },
    async writeCheckpoint(key, checkpoint) { checkpoints.set(key, structuredClone(checkpoint)); },
  };
  let ids = 0;
  const sync = createAccountSynchronizer(storage, createSerialSyncLock(), () => `stable-operation-${++ids}`);
  return { storage, checkpoints, records, recoveries, sync };
}

test("portable sync uses injected storage and replays the persisted operation after restart", async () => {
  const f = fixture();
  const initial = await f.storage.load("account:one");
  await f.storage.commit("account:one", initial, { ...initial.data, settings: { ...initial.data.settings, weeklyGoal: 8 } });
  const operations = new Map<string, CloudRevision>();
  const ids: string[] = [];
  let remote: CloudRevision = { revision: 0, data: null };
  let fail = true;
  const transport = {
    read: async () => remote,
    write: async (pending: { operationId: string; data: Data }) => {
      ids.push(pending.operationId);
      const previous = operations.get(pending.operationId);
      if (previous) return previous;
      remote = { revision: remote.revision + 1, data: structuredClone(pending.data) };
      operations.set(pending.operationId, remote);
      if (fail) { fail = false; throw new Error("Lost acknowledgement"); }
      return remote;
    },
  };
  await assert.rejects(f.sync("account:one", transport), /Lost acknowledgement/);
  assert.equal(f.checkpoints.get("account:one")?.pending?.operationId, "stable-operation-1");
  const restart = createAccountSynchronizer(f.storage, createSerialSyncLock(), () => "different-process-id");
  await restart("account:one", transport);
  assert.deepEqual(ids, ["stable-operation-1", "stable-operation-1"]);
  assert.equal(remote.revision, 1);
  assert.equal(remote.data?.settings.weeklyGoal, 8);
  assert.equal(f.checkpoints.get("account:one")?.pending, undefined);
});

test("portable sync preserves both sides of same-field conflicts without uploading", async () => {
  const f = fixture();
  const base = await f.storage.load("account:one");
  f.checkpoints.set("account:one", { base: { revision: 1, data: base.data } });
  await f.storage.commit("account:one", base, { ...base.data, settings: { ...base.data.settings, weeklyGoal: 6 } });
  let writes = 0;
  const remote = { ...base.data, settings: { ...base.data.settings, weeklyGoal: 7 } };
  await assert.rejects(f.sync("account:one", { read: async () => ({ revision: 2, data: remote }), write: async () => { writes++; throw new Error("must not upload conflict"); } }), CloudConflict);
  assert.equal(writes, 0);
  assert.equal((await f.storage.load("account:one")).data.settings.weeklyGoal, 6);
  assert.equal(f.recoveries[0].data.settings.weeklyGoal, 7);
  await assert.rejects(f.sync("personal", { read: async () => ({ revision: 0, data: null }), write: async () => ({ revision: 1, data: null }) }), /account workspace/);
});
