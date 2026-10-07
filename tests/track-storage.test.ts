import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { emptyData } from "../src/lib/model";
import {
  commitWorkspace,
  loadWorkspace,
  recoveriesFor,
} from "../src/lib/storage";
import {
  importTrack,
  removeTrack,
  trackContextForEntry,
} from "../src/lib/tracks";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";
import type { TrackImportDraft } from "../src/lib/tracks-types";

const now = new Date("2026-10-07T12:00:00.000Z");
const draft = (id: string, code = "189A"): TrackImportDraft => ({
  id,
  title: id,
  sourceName: `${id}.docx`,
  sourceFingerprint: id,
  stages: [
    {
      id: `${id}-stage`,
      title: "Foundation",
      description: "Find the invariant.",
      suggestedTime: "20 minutes",
      entries: [
        {
          id: `${id}-entry`,
          title: "Cut Ribbon",
          url: "",
          code,
          rating: 1300,
          pattern: "Keep the boundaries moving",
        },
      ],
    },
  ],
});

test("confirmation persists track, stage, entry, and new problem together and reloads a restorable backup", async () => {
  const key = "account:track-atomic";
  const base = await loadWorkspace(key);
  const proposed = importTrack(base.data, draft("atomic"), undefined, now);
  const saved = await commitWorkspace(key, base, proposed);
  assert.deepEqual(saved.conflicts, []);
  const restored = await loadWorkspace(key);
  assert.equal(restored.data.tracks!.length, 1);
  assert.equal(restored.data.trackStages!.length, 1);
  assert.equal(restored.data.trackEntries!.length, 1);
  assert.equal(restored.data.problems.length, 1);
  assert.deepEqual(decodeBackup(encodeBackup(restored.data)), proposed);
});

test("failed track confirmation leaves no partial memberships and exact-preview retry creates one track", async () => {
  const key = "account:track-failed-save";
  const base = await loadWorkspace(key);
  const preview = draft("retained-preview");
  const proposed = importTrack(base.data, preview, undefined, now);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    value: unknown,
    recordKey?: IDBValidKey,
  ) {
    if (this.name === "workspaces")
      throw new DOMException("Storage is full.", "QuotaExceededError");
    return recordKey === undefined
      ? original.call(this, value)
      : original.call(this, value, recordKey);
  };
  try {
    await assert.rejects(
      commitWorkspace(key, base, proposed),
      /Storage is full/,
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  const afterFailure = await loadWorkspace(key);
  assert.equal(afterFailure.revision, base.revision);
  assert.deepEqual(afterFailure.data, emptyData());
  const retry = importTrack(proposed, preview, undefined, now);
  assert.equal(
    retry,
    proposed,
    "The optimistic failed draft keeps the same operation IDs",
  );
  await commitWorkspace(key, afterFailure, retry);
  const afterRetry = await loadWorkspace(key);
  assert.equal(afterRetry.data.tracks!.length, 1);
  assert.equal(afterRetry.data.trackEntries!.length, 1);
  assert.equal(afterRetry.data.problems.length, 1);
  assert.equal(afterRetry.data.tracks![0].id, preview.id);
});

test("track records, active selection, and text preferences remain isolated between account workspaces", async () => {
  const firstKey = "account:track-isolation-a";
  const secondKey = "account:track-isolation-b";
  const first = await loadWorkspace(firstKey);
  const second = await loadWorkspace(secondKey);
  const firstData = importTrack(first.data, draft("private-a"), undefined, now);
  await commitWorkspace(firstKey, first, {
    ...firstData,
    settings: { ...firstData.settings, textSize: "large" },
  });
  const secondData = importTrack(
    second.data,
    draft("private-b", "1000C1"),
    undefined,
    now,
  );
  await commitWorkspace(secondKey, second, secondData);
  const firstReload = await loadWorkspace(firstKey);
  const secondReload = await loadWorkspace(secondKey);
  assert.deepEqual(
    firstReload.data.tracks!.map((track) => track.id),
    ["private-a"],
  );
  assert.deepEqual(
    secondReload.data.tracks!.map((track) => track.id),
    ["private-b"],
  );
  assert.equal(firstReload.data.activeTrackId, "private-a");
  assert.equal(secondReload.data.activeTrackId, "private-b");
  assert.equal(firstReload.data.settings.textSize, "large");
  assert.equal(secondReload.data.settings.textSize, "comfortable");
  assert.deepEqual(await recoveriesFor(secondKey), []);
});

test("stale tabs importing independent tracks merge complete memberships and share existing canonical problems", async () => {
  const key = "account:track-concurrent";
  const empty = await loadWorkspace(key);
  await commitWorkspace(
    key,
    empty,
    importTrack(empty.data, draft("starter"), undefined, now),
  );
  const first = await loadWorkspace(key);
  const second = await loadWorkspace(key);
  await commitWorkspace(
    key,
    first,
    importTrack(first.data, draft("tab-a", "1000C1"), undefined, now),
  );
  const result = await commitWorkspace(
    key,
    second,
    importTrack(second.data, draft("tab-b", "1000C2"), undefined, now),
  );
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.record.data.tracks!.length, 3);
  assert.equal(result.record.data.trackStages!.length, 3);
  assert.equal(result.record.data.trackEntries!.length, 3);
  assert.equal(result.record.data.problems.length, 3);
  assert.equal(result.record.data.activeTrackId, "starter");
  assert.deepEqual(
    decodeBackup(encodeBackup(result.record.data)),
    (await loadWorkspace(key)).data,
  );
});

test("concurrent track removal and a completed practice reflection preserve history without dangling membership", async () => {
  const key = "account:track-removal-during-practice";
  const initial = await loadWorkspace(key);
  await commitWorkspace(
    key,
    initial,
    importTrack(initial.data, draft("removed-after-practice"), undefined, now),
  );
  const removalTab = await loadWorkspace(key);
  const practiceTab = await loadWorkspace(key);
  const entry = practiceTab.data.trackEntries![0];
  const context = trackContextForEntry(practiceTab.data, entry.id)!;
  await commitWorkspace(key, practiceTab, {
    ...practiceTab.data,
    attempts: [
      {
        id: "completed-during-removal",
        problemId: entry.problemId,
        startedAt: "2026-10-07T11:30:00.000Z",
        completedAt: now.toISOString(),
        elapsedMs: 1800000,
        outcome: "hint",
        difficulty: "approach",
        takeaway: "Keep the invariant explicit.",
        notes: "Original session notes.",
        trackContext: context,
      },
    ],
    problems: practiceTab.data.problems.map((problem) =>
      problem.id === entry.problemId
        ? { ...problem, reviewAt: "2026-10-12" }
        : problem,
    ),
  });
  const removed = await commitWorkspace(
    key,
    removalTab,
    removeTrack(removalTab.data, "removed-after-practice"),
  );
  assert.deepEqual(removed.conflicts, []);
  assert.equal(removed.record.data.tracks!.length, 0);
  assert.equal(removed.record.data.trackStages!.length, 0);
  assert.equal(removed.record.data.trackEntries!.length, 0);
  assert.equal(removed.record.data.attempts.length, 1);
  assert.deepEqual(removed.record.data.attempts[0].trackContext, context);
  assert.equal(removed.record.data.problems[0].reviewAt, "2026-10-12");
  assert.equal(
    (await loadWorkspace(key)).data.attempts[0].notes,
    "Original session notes.",
  );
});
