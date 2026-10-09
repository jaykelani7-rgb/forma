import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData, validateData } from "../src/lib/model";
import type { Data } from "../src/lib/model";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";
import {
  writeCloudWorkspace,
  readCloudWorkspace,
} from "../src/lib/cloud-client";
import {
  commitWorkspace,
  loadWorkspace,
  recoveriesFor,
} from "../src/lib/storage";
import { importTrack, trackDraft } from "../src/lib/tracks";
import {
  encodeSharedTrack,
  parseSharedTrack,
  sharedTrackFromTrack,
} from "../src/lib/shared-tracks";
import type { TrackImportDraft } from "../src/lib/tracks-types";

const now = new Date("2026-10-09T01:00:00.000Z");
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null },
  configurable: true,
});
function curriculum(title = "Portable boundaries", code = "381A") {
  const original: TrackImportDraft = {
    id: "sender-local-track",
    title,
    sourceName: "sender-private-upload.docx",
    sourceFingerprint: "sender-private-fingerprint",
    shareDescription: "Build a habit of checking both ends.",
    stages: [
      {
        id: "sender-local-stage",
        title: "Start small",
        description: "State the invariant first.",
        suggestedTime: "20 minutes",
        entries: [
          {
            id: "sender-local-membership",
            title: "Compare the two ends",
            code,
            url: "",
            rating: 800,
            pattern: "An optional two-pointer hint",
          },
        ],
      },
    ],
  };
  const sender = importTrack(emptyData(), original, undefined, now);
  return parseSharedTrack(
    encodeSharedTrack(
      sharedTrackFromTrack(sender, original.id, {
        includeDescriptions: true,
        includeHints: true,
        shareDescription: original.shareDescription,
      }),
    ),
  );
}

test("a shared curriculum commits all records atomically without activating, and full backups retain its optional text", async () => {
  const key = "account:shared-atomic";
  const base = await loadWorkspace(key);
  const preview = curriculum();
  const proposal = importTrack(base.data, preview, undefined, now);
  assert.equal(proposal.activeTrackId, null);
  assert.notEqual(preview.id, "sender-local-track");
  const result = await commitWorkspace(key, base, proposal);
  assert.deepEqual(result.conflicts, []);
  const saved = (await loadWorkspace(key)).data;
  assert.equal(saved.tracks!.length, 1);
  assert.equal(saved.trackStages!.length, 1);
  assert.equal(saved.trackEntries!.length, 1);
  assert.equal(saved.problems.length, 1);
  assert.equal(saved.tracks![0].shareDescription, preview.shareDescription);
  assert.equal(saved.trackStages![0].description, "State the invariant first.");
  assert.equal(saved.trackEntries![0].pattern, "An optional two-pointer hint");
  assert.equal(saved.activeTrackId, null);
  assert.deepEqual(decodeBackup(encodeBackup(saved)), saved);
  const older = structuredClone(saved);
  delete older.tracks![0].shareDescription;
  assert.deepEqual(decodeBackup(encodeBackup(older)), older);
});

test("a failed shared save leaves no partial track and a corrected stable preview retries only one operation", async () => {
  const key = "account:shared-failed-retry";
  const base = await loadWorkspace(key);
  const preview = curriculum();
  const optimistic = importTrack(base.data, preview, undefined, now);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    value: unknown,
    recordKey?: IDBValidKey,
  ) {
    if (this.name === "workspaces")
      throw new DOMException("Shared fixture quota", "QuotaExceededError");
    return recordKey === undefined
      ? original.call(this, value)
      : original.call(this, value, recordKey);
  };
  try {
    await assert.rejects(
      commitWorkspace(key, base, optimistic),
      /Shared fixture quota/,
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  const failed = await loadWorkspace(key);
  assert.equal(failed.revision, base.revision);
  assert.deepEqual(failed.data, emptyData());
  preview.title = "Corrected while retaining the failed preview";
  preview.shareDescription = "Corrected shared description";
  preview.stages[0].entries[0].title = "Corrected curriculum title";
  const corrected = importTrack(optimistic, preview, undefined, now);
  assert.equal(corrected.tracks!.length, 1);
  assert.equal(corrected.trackEntries!.length, 1);
  assert.equal(corrected.problems.length, 1);
  assert.equal(corrected.tracks![0].id, preview.id);
  assert.equal(importTrack(corrected, preview, undefined, now), corrected);
  await commitWorkspace(key, failed, corrected);
  const reload = await loadWorkspace(key);
  assert.equal(reload.data.tracks![0].title, preview.title);
  assert.equal(
    reload.data.tracks![0].shareDescription,
    preview.shareDescription,
  );
  assert.equal(
    reload.data.trackEntries![0].id,
    preview.stages[0].entries[0].id,
  );
  assert.equal(reload.data.activeTrackId, null);
});

test("concurrent shared imports preserve existing personal history and active selection without partial relationships", async () => {
  const key = "account:shared-concurrent";
  const initial = await loadWorkspace(key);
  const starter = curriculum("An already active curriculum");
  let original = importTrack(initial.data, starter, undefined, now);
  const problem = original.problems[0];
  original = validateData({
    ...original,
    activeTrackId: starter.id,
    problems: original.problems.map((value) => ({
      ...value,
      reviewAt: "2026-10-20",
      reviewCount: 3,
      tags: ["personal-tag"],
      rating: 1800,
    })),
    attempts: [
      {
        id: "recipient-original-attempt",
        problemId: problem.id,
        startedAt: "2026-10-08T10:00:00.000Z",
        completedAt: "2026-10-08T10:05:00.000Z",
        elapsedMs: 300000,
        outcome: "hint",
        difficulty: "approach",
        takeaway: "Recipient's original reflection",
        notes: "Recipient's private notes",
      },
    ],
  });
  await commitWorkspace(key, initial, original);
  const a = await loadWorkspace(key);
  const b = await loadWorkspace(key);
  const firstPreview = curriculum(
    "A separate curriculum using the same problem",
  );
  const secondPreview = curriculum(
    "An independent split-index curriculum",
    "1358C1",
  );
  await commitWorkspace(
    key,
    a,
    importTrack(a.data, firstPreview, undefined, now),
  );
  const result = await commitWorkspace(
    key,
    b,
    importTrack(b.data, secondPreview, undefined, now),
  );
  assert.deepEqual(result.conflicts, []);
  const data = (await loadWorkspace(key)).data;
  assert.equal(data.tracks!.length, 3);
  assert.equal(data.trackStages!.length, 3);
  assert.equal(data.trackEntries!.length, 3);
  assert.equal(data.problems.length, 2);
  assert.equal(data.activeTrackId, starter.id);
  assert.deepEqual(data.attempts, original.attempts);
  assert.deepEqual(
    data.problems.find((value) => value.id === problem.id),
    original.problems[0],
  );
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});

test("shared optional metadata stays isolated across account caches, previews and recovery copies", async () => {
  const aKey = "account:shared-isolation-a";
  const bKey = "account:shared-isolation-b";
  const a = await loadWorkspace(aKey);
  const b = await loadWorkspace(bKey);
  const aPreview = curriculum("Account A curriculum");
  aPreview.shareDescription = "Only A's editable curriculum text";
  await commitWorkspace(aKey, a, importTrack(a.data, aPreview, undefined, now));
  const bPreview = curriculum("Account B curriculum", "1358C2");
  bPreview.shareDescription = "Only B's editable curriculum text";
  await commitWorkspace(bKey, b, importTrack(b.data, bPreview, undefined, now));
  const aData = (await loadWorkspace(aKey)).data;
  const bData = (await loadWorkspace(bKey)).data;
  assert.equal(aData.tracks![0].title, "Account A curriculum");
  assert.equal(bData.tracks![0].title, "Account B curriculum");
  assert.equal(
    trackDraft(aData, aPreview.id).shareDescription,
    aPreview.shareDescription,
  );
  assert.equal(
    trackDraft(bData, bPreview.id).shareDescription,
    bPreview.shareDescription,
  );
  assert.equal(aData.problems[0].problemCode, "381A");
  assert.equal(bData.problems[0].problemCode, "1358C2");
  assert.deepEqual(await recoveriesFor(aKey), []);
  assert.deepEqual(await recoveriesFor(bKey), []);
  assert.equal((await loadWorkspace("personal")).data.tracks!.length, 0);
});

test("the existing private account JSON transport retains shared-track metadata on write and read", async (t) => {
  const preview = curriculum();
  const data = importTrack(emptyData(), preview, undefined, now);
  let received: Data | null = null;
  const operationId = crypto.randomUUID();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init?: RequestInit) => {
      assert.equal(input, "/api/workspace");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "omit");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.operationId, operationId);
        assert.equal(body.baseRevision, 0);
        received = validateData(body.data);
      }
      return new Response(
        JSON.stringify({ revision: 1, data: received, replayed: false }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  );
  const saved = await writeCloudWorkspace(
    "local-transport-fixture-token",
    data,
    0,
    operationId,
  );
  assert.deepEqual(saved.data, data);
  const read = await readCloudWorkspace("local-transport-fixture-token");
  assert.deepEqual(read.data, data);
  assert.equal(
    read.data!.tracks![0].shareDescription,
    preview.shareDescription,
  );
  assert.equal(read.data!.activeTrackId, null);
});
