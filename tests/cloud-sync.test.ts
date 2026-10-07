import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/lib/model";
import { reconcileCloud } from "../src/lib/cloud-sync";
test("cloud reconciliation combines different records but detects same-field conflicts", () => {
  const base = emptyData();
  const local = { ...base, settings: { ...base.settings, weeklyGoal: 7 } };
  const remote = { ...base, settings: { ...base.settings, displayName: "A" } };
  const result = reconcileCloud(base, local, remote);
  assert.equal(result.data.settings.weeklyGoal, 7);
  assert.equal(result.data.settings.displayName, "A");
  assert.deepEqual(result.conflicts, []);
  assert.ok(
    reconcileCloud(base, local, {
      ...base,
      settings: { ...base.settings, weeklyGoal: 8 },
    }).conflicts.length,
  );
});
import "fake-indexeddb/auto";
import {
  commitWorkspace,
  loadWorkspace,
  syncMetadata,
} from "../src/lib/storage";
import {
  synchronizeAccount,
  CloudConflict,
  CloudRevision,
  SyncCheckpoint,
} from "../src/lib/cloud-sync";
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null },
});
test("an uncertain cloud acknowledgement replays the same UUID and preserves later local edits", async () => {
  const key = "account:retry-fixture" as const;
  let local = await loadWorkspace(key);
  local = (
    await commitWorkspace(key, local, {
      ...local.data,
      settings: { ...local.data.settings, weeklyGoal: 7 },
    })
  ).record;
  let remote: CloudRevision = { revision: 0, data: null };
  let fail = true;
  const operations = new Map<string, CloudRevision>();
  const ids: string[] = [];
  const transport = {
    read: async () => remote,
    write: async (write: {
      operationId: string;
      baseRevision: number;
      data: typeof local.data;
    }) => {
      ids.push(write.operationId);
      const prior = operations.get(write.operationId);
      if (prior) return prior;
      remote = { revision: remote.revision + 1, data: write.data };
      operations.set(write.operationId, remote);
      if (fail) {
        fail = false;
        throw new Error("Lost acknowledgement");
      }
      return remote;
    },
  };
  await assert.rejects(
    synchronizeAccount(key, transport),
    /Lost acknowledgement/,
  );
  assert.ok((await syncMetadata<SyncCheckpoint>(key))?.pending);
  local = await loadWorkspace(key);
  await commitWorkspace(key, local, {
    ...local.data,
    settings: { ...local.data.settings, displayName: "Later edit" },
  });
  await synchronizeAccount(key, transport);
  assert.equal(ids[0], ids[1]);
  assert.equal(remote.data?.settings.displayName, "Later edit");
  assert.equal(remote.data?.settings.weeklyGoal, 7);
  assert.equal(
    (await loadWorkspace(key)).data.settings.displayName,
    "Later edit",
  );
});
test("account caches are isolated from personal, demo and other accounts", async () => {
  const a = await loadWorkspace("account:isolation-a");
  await commitWorkspace(a.key, a, {
    ...a.data,
    settings: { ...a.data.settings, displayName: "Account A" },
  });
  assert.equal(
    (await loadWorkspace("account:isolation-b")).data.settings.displayName,
    "",
  );
  assert.equal((await loadWorkspace("personal")).data.settings.displayName, "");
  assert.equal((await loadWorkspace("demo")).data.settings.displayName, "");
});

test("a failed CAS retains the downloaded merge base rather than inventing local edits", async () => {
  const key = "account:cas-base-fixture" as const;
  const local = await loadWorkspace(key);
  await commitWorkspace(key, local, {
    ...local.data,
    settings: { ...local.data.settings, weeklyGoal: 7 },
  });
  let remote: CloudRevision = {
    revision: 1,
    data: {
      ...emptyData(),
      settings: { ...emptyData().settings, displayName: "Remote A" },
    },
  };
  let fail = true;
  const transport = {
    read: async () => remote,
    write: async (write: { baseRevision: number; data: typeof local.data }) => {
      if (fail) {
        fail = false;
        remote = {
          revision: 2,
          data: {
            ...remote.data!,
            settings: { ...remote.data!.settings, displayName: "Remote B" },
          },
        };
        throw new CloudConflict("CAS mismatch");
      }
      if (write.baseRevision !== remote.revision)
        throw new CloudConflict("CAS mismatch");
      remote = { revision: remote.revision + 1, data: write.data };
      return remote;
    },
  };
  await assert.rejects(synchronizeAccount(key, transport), /CAS mismatch/);
  assert.equal(
    (await syncMetadata<SyncCheckpoint>(key))?.base.data?.settings.displayName,
    "Remote A",
  );
  // The known rejected operation is cleared; the next reconciliation uses
  // the actual downloaded base and combines both changes.
  await synchronizeAccount(key, transport);
  assert.equal(remote.data?.settings.displayName, "Remote B");
  assert.equal(remote.data?.settings.weeklyGoal, 7);
});

test("simultaneous account syncs serialize their shared pending checkpoint", async () => {
  const key = "account:parallel-fixture" as const;
  const local = await loadWorkspace(key);
  await commitWorkspace(key, local, {
    ...local.data,
    settings: { ...local.data.settings, weeklyGoal: 9 },
  });
  let remote: CloudRevision = { revision: 0, data: null };
  let reads = 0;
  let writes = 0;
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const writeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = {
    read: async () => {
      reads++;
      return remote;
    },
    write: async (write: { data: typeof local.data }) => {
      writes++;
      started();
      await writeGate;
      remote = { revision: 1, data: write.data };
      return remote;
    },
  };
  const first = synchronizeAccount(key, transport);
  await firstStarted;
  const second = synchronizeAccount(key, transport);
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(writes, 1);
  assert.equal((await syncMetadata<SyncCheckpoint>(key))?.base.revision, 1);
});

test("aborting account sync prevents a subsequent upload and preserves the local cache", async () => {
  const key = "account:abort-fixture" as const;
  const local = await loadWorkspace(key);
  await commitWorkspace(key, local, {
    ...local.data,
    settings: { ...local.data.settings, displayName: "Unsynced notes" },
  });
  const controller = new AbortController();
  let writes = 0;
  await assert.rejects(
    synchronizeAccount(
      key,
      {
        read: async () => {
          controller.abort();
          return { revision: 0, data: null };
        },
        write: async () => {
          writes++;
          return { revision: 1, data: emptyData() };
        },
      },
      controller.signal,
    ),
    /abort/i,
  );
  assert.equal(writes, 0);
  assert.equal(
    (await loadWorkspace(key)).data.settings.displayName,
    "Unsynced notes",
  );
});

test("offline local edits reconcile with different remote edits when the account reconnects", async () => {
  const key = "account:offline-reconnect-fixture" as const;
  const base = emptyData();
  const initial = await loadWorkspace(key, base);
  await syncMetadata(key, {
    base: { revision: 1, data: base },
  } satisfies SyncCheckpoint);
  let online = false;
  let writes = 0;
  let remote: CloudRevision = {
    revision: 2,
    data: {
      ...base,
      settings: { ...base.settings, displayName: "Edit from another device" },
    },
  };
  const transport = {
    read: async () => {
      if (!online) throw new Error("Offline fixture");
      return remote;
    },
    write: async (write: { baseRevision: number; data: typeof base }) => {
      writes++;
      assert.equal(write.baseRevision, remote.revision);
      remote = { revision: remote.revision + 1, data: write.data };
      return remote;
    },
  };
  await commitWorkspace(key, initial, {
    ...base,
    settings: { ...base.settings, weeklyGoal: 11 },
  });
  await assert.rejects(synchronizeAccount(key, transport), /Offline fixture/);
  assert.equal(writes, 0);
  assert.equal((await loadWorkspace(key)).data.settings.weeklyGoal, 11);
  assert.equal((await syncMetadata<SyncCheckpoint>(key))?.base.revision, 1);
  online = true;
  await synchronizeAccount(key, transport);
  assert.equal(writes, 1);
  assert.equal(remote.data?.settings.weeklyGoal, 11);
  assert.equal(remote.data?.settings.displayName, "Edit from another device");
  assert.equal(
    (await loadWorkspace(key)).data.settings.displayName,
    "Edit from another device",
  );
  assert.equal((await syncMetadata<SyncCheckpoint>(key))?.pending, undefined);
});

test("switching accounts during an acknowledged write keeps its retry scoped to the original account", async () => {
  const firstKey = "account:switch-pending-a" as const;
  const secondKey = "account:switch-pending-b" as const;
  const first = await loadWorkspace(firstKey);
  const second = await loadWorkspace(secondKey);
  await commitWorkspace(firstKey, first, {
    ...first.data,
    settings: {
      ...first.data.settings,
      displayName: "Account A's unsynced draft",
    },
  });
  await commitWorkspace(secondKey, second, {
    ...second.data,
    settings: {
      ...second.data.settings,
      displayName: "Account B's separate draft",
    },
  });
  const controller = new AbortController();
  let started!: () => void;
  const writeStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const operations = new Map<string, CloudRevision>();
  let firstRemote: CloudRevision = { revision: 0, data: null };
  const firstIds: string[] = [];
  const firstTransport = {
    read: async () => firstRemote,
    write: async (write: { operationId: string; data: typeof first.data }) => {
      firstIds.push(write.operationId);
      const prior = operations.get(write.operationId);
      if (prior) return prior;
      firstRemote = { revision: 1, data: write.data };
      operations.set(write.operationId, firstRemote);
      started();
      await acknowledgement;
      return firstRemote;
    },
  };
  const pending = synchronizeAccount(
    firstKey,
    firstTransport,
    controller.signal,
  );
  const aborted = assert.rejects(pending, /abort/i);
  await writeStarted;
  controller.abort();
  let secondRemote: CloudRevision = { revision: 0, data: null };
  await synchronizeAccount(secondKey, {
    read: async () => secondRemote,
    write: async (write) => {
      secondRemote = { revision: 1, data: write.data };
      return secondRemote;
    },
  });
  acknowledge();
  await aborted;
  assert.equal(
    secondRemote.data?.settings.displayName,
    "Account B's separate draft",
  );
  assert.ok((await syncMetadata<SyncCheckpoint>(firstKey))?.pending);
  assert.equal(
    (await syncMetadata<SyncCheckpoint>(secondKey))?.pending,
    undefined,
  );
  await synchronizeAccount(firstKey, firstTransport);
  assert.deepEqual(firstIds, [firstIds[0], firstIds[0]]);
  assert.equal(firstRemote.revision, 1);
  assert.equal(
    (await loadWorkspace(firstKey)).data.settings.displayName,
    "Account A's unsynced draft",
  );
  assert.equal(
    (await loadWorkspace(secondKey)).data.settings.displayName,
    "Account B's separate draft",
  );
  assert.equal(
    (await syncMetadata<SyncCheckpoint>(firstKey))?.pending,
    undefined,
  );
});

test("a local edit committed during a successful upload remains pending for the following sync", async () => {
  const key = "account:edit-during-write-fixture" as const;
  const initial = await loadWorkspace(key);
  await commitWorkspace(key, initial, {
    ...initial.data,
    settings: { ...initial.data.settings, weeklyGoal: 9 },
  });
  let remote: CloudRevision = { revision: 0, data: null };
  let writes = 0;
  const transport = {
    read: async () => remote,
    write: async (write: { data: typeof initial.data }) => {
      writes++;
      if (writes === 1) {
        const current = await loadWorkspace(key);
        await commitWorkspace(key, current, {
          ...current.data,
          settings: {
            ...current.data.settings,
            displayName: "New local edit while upload runs",
          },
        });
      }
      remote = { revision: remote.revision + 1, data: write.data };
      return remote;
    },
  };
  await synchronizeAccount(key, transport);
  assert.equal(remote.data?.settings.displayName, "");
  assert.equal(
    (await loadWorkspace(key)).data.settings.displayName,
    "New local edit while upload runs",
  );
  await synchronizeAccount(key, transport);
  assert.equal(writes, 2);
  assert.equal(
    remote.data?.settings.displayName,
    "New local edit while upload runs",
  );
  assert.equal(remote.data?.settings.weeklyGoal, 9);
});
