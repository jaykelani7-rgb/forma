import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData, type Data } from "../src/lib/model";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";
import {
  commitWorkspace,
  loadWorkspace,
  type WorkspaceRevision,
} from "../src/lib/storage";
import {
  readSettledWorkspace,
  UnsavedWorkspaceError,
  type WorkspaceOperationState,
} from "../src/lib/workspace-lifecycle";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function notebook(notes: string): Data {
  return {
    ...emptyData(),
    problems: [
      {
        id: "active-problem",
        title: "Preserve my notes",
        platform: "Codeforces",
        url: "",
        problemCode: "",
        tags: [],
        rating: null,
        createdAt: "2026-10-04T00:00:00.000Z",
        reviewAt: null,
        reviewCount: 0,
      },
    ],
    session: {
      id: "active-session",
      problemId: "active-problem",
      startedAt: "2026-10-04T00:00:00.000Z",
      runningSince: null,
      elapsedMs: 60_000,
      targetMinutes: 30,
      notes,
      timerVisible: true,
      phase: "focus",
    },
  };
}

function operation(name: string) {
  const expected = {
    key: `account:lifecycle-${name}` as const,
    generation: 1,
    activation: 1,
  };
  const state: WorkspaceOperationState & { editVersion: number } = {
    ...expected,
    blocked: false,
    saving: false,
    editVersion: 0,
  };
  return { expected, state };
}

test("a cloud reload waits for a pending note save before reading its durable result", async () => {
  const { expected, state } = operation("settled-save");
  const base = await loadWorkspace(expected.key, notebook("Original notes"));
  const saveGate = deferred<void>();
  const draft = notebook("Notes written while cloud sync was finishing");
  state.saving = true;
  state.editVersion++;
  const save = saveGate.promise.then(async () => {
    await commitWorkspace(expected.key, base, draft);
    state.saving = false;
  });
  let reads = 0;
  const reload = readSettledWorkspace(
    expected,
    () => state,
    () => save,
    () => {
      reads++;
      return loadWorkspace(expected.key);
    },
  );
  await Promise.resolve();
  assert.equal(reads, 0);
  saveGate.resolve();
  const saved = await reload;
  assert.equal(saved?.data.session?.notes, draft.session?.notes);
  assert.equal(reads, 1);
});

test("a note save failing during the initial wait prevents any cloud reload", async () => {
  const { expected, state } = operation("failed-save");
  await loadWorkspace(expected.key, notebook("Durable original"));
  const draft = notebook("Unsaved but exportable notes");
  const saveGate = deferred<void>();
  state.saving = true;
  state.editVersion++;
  // The write queue absorbs an IndexedDB failure, as the provider does, and
  // marks the optimistic notebook blocked rather than deleting the draft.
  const failedSave = saveGate.promise.then(() => {
    state.saving = false;
    state.blocked = true;
  });
  let reads = 0;
  const reload = readSettledWorkspace(
    expected,
    () => state,
    () => failedSave,
    () => {
      reads++;
      return loadWorkspace(expected.key);
    },
  );
  const rejected = assert.rejects(reload, UnsavedWorkspaceError);
  saveGate.resolve();
  await rejected;
  assert.equal(reads, 0);
  assert.equal(
    (await loadWorkspace(expected.key)).data.session?.notes,
    "Durable original",
  );
  assert.equal(
    decodeBackup(encodeBackup(draft)).session?.notes,
    draft.session?.notes,
  );
});

test("storage failure while a cloud reload is reading keeps the unsaved notebook exportable", async () => {
  const { expected, state } = operation("failed-during-read");
  await loadWorkspace(expected.key, notebook("Durable original"));
  let visible = notebook("Durable original");
  const snapshotReady = deferred<void>();
  const readGate = deferred<void>();
  const reload = readSettledWorkspace(
    expected,
    () => state,
    async () => {},
    async () => {
      const snapshot = await loadWorkspace(expected.key);
      snapshotReady.resolve();
      await readGate.promise;
      return snapshot;
    },
  ).then((saved) => {
    if (saved) visible = saved.data;
  });
  await snapshotReady.promise;
  visible = notebook("New notes whose local save failed");
  state.editVersion++;
  state.blocked = true;
  const rejected = assert.rejects(reload, UnsavedWorkspaceError);
  readGate.resolve();
  await rejected;
  assert.equal(visible.session?.notes, "New notes whose local save failed");
  assert.deepEqual(decodeBackup(encodeBackup(visible)), visible);
  assert.equal(
    (await loadWorkspace(expected.key)).data.session?.notes,
    "Durable original",
  );
});

test("a queue gaining another note save cannot be mistaken for a fully settled workspace", async () => {
  const { expected, state } = operation("growing-queue");
  const base = await loadWorkspace(expected.key, notebook("Original notes"));
  const firstGate = deferred<void>();
  const secondGate = deferred<void>();
  state.saving = true;
  state.editVersion++;
  const first = firstGate.promise.then(() =>
    commitWorkspace(expected.key, base, notebook("First note edit")),
  );
  let queue: Promise<unknown> = first;
  let reads = 0;
  const reload = readSettledWorkspace(
    expected,
    () => state,
    async () => {
      await queue;
    },
    () => {
      reads++;
      return loadWorkspace(expected.key);
    },
  );
  state.editVersion++;
  const latest = notebook("A second note edit queued during the wait");
  queue = first.then(async ({ record }) => {
    await secondGate.promise;
    await commitWorkspace(expected.key, record, latest);
    state.saving = false;
  });
  firstGate.resolve();
  assert.equal(await reload, null);
  assert.equal(reads, 0);
  secondGate.resolve();
  await queue;
  const settled = await readSettledWorkspace(
    expected,
    () => state,
    async () => {
      await queue;
    },
    () => loadWorkspace(expected.key),
  );
  assert.equal(settled?.data.session?.notes, latest.session?.notes);
});

for (const completesDuringRead of [false, true]) {
  test(`a ${completesDuringRead ? "committed" : "pending"} note edit arriving during a cloud read keeps its optimistic state`, async () => {
    const { expected, state } = operation(`read-edit-${completesDuringRead}`);
    const base = await loadWorkspace(expected.key, notebook("Old snapshot"));
    let visible = base.data;
    const snapshotReady = deferred<void>();
    const readGate = deferred<void>();
    const reload = readSettledWorkspace(
      expected,
      () => state,
      async () => {},
      async () => {
        const snapshot = await loadWorkspace(expected.key);
        snapshotReady.resolve();
        await readGate.promise;
        return snapshot;
      },
    ).then((saved) => {
      if (saved) visible = saved.data;
      return saved;
    });
    await snapshotReady.promise;
    visible = notebook("A newer edit must not disappear");
    state.editVersion++;
    state.saving = true;
    if (completesDuringRead) {
      await commitWorkspace(expected.key, base, visible);
      state.saving = false;
    }
    readGate.resolve();
    assert.equal(await reload, null);
    assert.equal(visible.session?.notes, "A newer edit must not disappear");
    if (!completesDuringRead) {
      await commitWorkspace(expected.key, base, visible);
      state.saving = false;
    }
    assert.equal(
      (await loadWorkspace(expected.key)).data.session?.notes,
      "A newer edit must not disappear",
    );
  });
}

for (const phase of ["settle", "read"] as const) {
  for (const change of ["key", "generation", "activation", "abort"] as const) {
    test(`${change} changing during ${phase} discards the old account result`, async () => {
      const { expected, state } = operation(`${phase}-${change}`);
      const oldAccount = await loadWorkspace(
        expected.key,
        notebook("Account A"),
      );
      let visible = oldAccount.data;
      const gate = deferred<void>();
      const reachedWait = deferred<void>();
      const controller = new AbortController();
      let reads = 0;
      const reload = readSettledWorkspace(
        expected,
        () => state,
        async () => {
          if (phase === "settle") {
            reachedWait.resolve();
            await gate.promise;
          }
        },
        async (): Promise<WorkspaceRevision> => {
          reads++;
          if (phase === "read") {
            reachedWait.resolve();
            await gate.promise;
          }
          return oldAccount;
        },
        controller.signal,
      ).then((saved) => {
        if (saved) visible = saved.data;
        return saved;
      });
      await reachedWait.promise;
      visible = notebook("Current workspace after switching or cancelling");
      if (change === "key") state.key = "account:another-user";
      else if (change === "abort") controller.abort();
      else state[change]++;
      gate.resolve();
      assert.equal(await reload, null);
      assert.equal(
        visible.session?.notes,
        "Current workspace after switching or cancelling",
      );
      assert.equal(reads, phase === "settle" ? 0 : 1);
    });
  }
}

test("an unreadable durable workspace rejects without replacing the readable notebook", async () => {
  const { expected, state } = operation("unreadable");
  const visible = notebook("Current notes remain available");
  const failure = new Error("IndexedDB read failed");
  await assert.rejects(
    readSettledWorkspace(
      expected,
      () => state,
      async () => {},
      async () => {
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  assert.deepEqual(decodeBackup(encodeBackup(visible)), visible);
});
