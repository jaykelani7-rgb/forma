import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  reconcileWorkspaceDay,
  nextDailyCheckDelay,
} from "../src/lib/daily-workspace";
import {
  dailyReflectionBatch,
  dailyReflectionCounts,
  mergeActivity,
  skipReflection,
} from "../src/lib/codeforces";
import { emptyData, localDate, validateData } from "../src/lib/model";
import { commitWorkspace, loadWorkspace } from "../src/lib/storage";
import { mergeWorkspaces } from "../src/lib/concurrency";
import {
  dailyFixture,
  dailyHandle,
  dailyPage,
} from "./fixtures/daily-workspace";

const yesterday = new Date("2026-10-06T12:00:00Z");
const today = new Date("2026-10-07T12:00:00Z");

test("activating an account cache on the following day creates one durable batch and same-day refreshes do not rewrite it", async () => {
  const key = "account:daily-next-day-fixture" as const;
  const cached = await loadWorkspace(key, dailyFixture(yesterday));
  assert.equal(
    dailyReflectionCounts(cached.data, dailyHandle, yesterday).pending,
    2,
  );
  const nextDay = reconcileWorkspaceDay(cached.data, today);
  assert.notEqual(nextDay, cached.data);
  assert.deepEqual(dailyReflectionCounts(nextDay, dailyHandle, today), {
    total: 4,
    pending: 4,
    unreflected: 6,
  });
  const committed = await commitWorkspace(key, cached, nextDay);
  assert.deepEqual(committed.conflicts, []);
  const restored = await loadWorkspace(key);
  for (let refresh = 0; refresh < 5; refresh++) {
    const reconciled = reconcileWorkspaceDay(restored.data, today);
    assert.equal(reconciled, restored.data);
    // The provider skips persistence when reconciliation returns its input.
    if (reconciled !== restored.data)
      await commitWorkspace(key, restored, reconciled);
  }
  assert.equal((await loadWorkspace(key)).revision, committed.record.revision);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(nextDay))), nextDay);
});

test("same-day imports keep the frozen batch while the new local day excludes completed and skipped attempts", () => {
  const original = dailyFixture(yesterday);
  const originalIds = dailyReflectionBatch(
    original,
    dailyHandle,
    yesterday,
  ).map((attempt) => attempt.id);
  const imported = mergeActivity(
    original,
    dailyHandle,
    [dailyPage(20, 8)],
    "refresh",
    yesterday,
  );
  assert.deepEqual(
    dailyReflectionBatch(imported, dailyHandle, yesterday).map(
      (attempt) => attempt.id,
    ),
    originalIds,
  );
  assert.equal(
    dailyReflectionCounts(imported, dailyHandle, yesterday).total,
    5,
  );
  const refreshed = reconcileWorkspaceDay(imported, today);
  const batch = dailyReflectionBatch(refreshed, dailyHandle, today);
  assert.equal(batch.length, 5);
  assert.ok(batch.every((attempt) => !attempt.skipped));
  const reflected = new Set(
    refreshed.codeforces.reflections.map((reflection) => reflection.attemptId),
  );
  assert.ok(batch.every((attempt) => !reflected.has(attempt.id)));
  assert.equal(reconcileWorkspaceDay(refreshed, today), refreshed);
});

test("a timezone-induced day change and return retain both immutable memberships", () => {
  const previous = process.env.TZ;
  try {
    const instant = new Date("2026-10-07T01:00:00Z");
    process.env.TZ = "America/Los_Angeles";
    assert.equal(localDate(instant), "2026-10-06");
    const first = reconcileWorkspaceDay(dailyFixture(yesterday), instant);
    const firstIds = dailyReflectionBatch(first, dailyHandle, instant).map(
      (attempt) => attempt.id,
    );
    process.env.TZ = "Asia/Kolkata";
    assert.equal(localDate(instant), "2026-10-07");
    const second = reconcileWorkspaceDay(first, instant);
    const secondIds = dailyReflectionBatch(second, dailyHandle, instant).map(
      (attempt) => attempt.id,
    );
    assert.equal(secondIds.length, 4);
    process.env.TZ = "America/Los_Angeles";
    const returned = reconcileWorkspaceDay(second, instant);
    assert.deepEqual(
      dailyReflectionBatch(returned, dailyHandle, instant).map(
        (attempt) => attempt.id,
      ),
      firstIds,
    );
    assert.equal(reconcileWorkspaceDay(returned, instant), returned);
    process.env.TZ = "Asia/Kolkata";
    const returnedAgain = reconcileWorkspaceDay(returned, instant);
    assert.deepEqual(
      dailyReflectionBatch(returnedAgain, dailyHandle, instant).map(
        (attempt) => attempt.id,
      ),
      secondIds,
    );
    assert.equal(returnedAgain.codeforces.reflectionBatches?.length, 2);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("daily checks use local calendar midnight across short and long DST days", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const boundaries = [
      {
        start: "2026-03-08T00:00:00-05:00",
        end: "2026-03-09T00:00:00-04:00",
        hours: 23,
        near: "2026-03-08T23:59:59.500-04:00",
      },
      {
        start: "2026-11-01T00:00:00-04:00",
        end: "2026-11-02T00:00:00-05:00",
        hours: 25,
        near: "2026-11-01T23:59:59.500-05:00",
      },
    ];
    for (const boundary of boundaries) {
      assert.equal(
        (Date.parse(boundary.end) - Date.parse(boundary.start)) / 3600000,
        boundary.hours,
      );
      assert.equal(nextDailyCheckDelay(new Date(boundary.start)), 60000);
      assert.equal(nextDailyCheckDelay(new Date(boundary.near)), 500);
      assert.equal(
        localDate(new Date(boundary.near)),
        boundary.near.slice(0, 10),
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("an untouched disconnected workspace stays unchanged so its first import can establish a batch", () => {
  const empty = emptyData();
  assert.equal(reconcileWorkspaceDay(empty, today), empty);
});

test("an empty day with existing history remains frozen when fresh activity is imported", () => {
  let data = dailyFixture(yesterday);
  for (const attempt of data.codeforces.practiceAttempts)
    data = skipReflection(data, attempt.id);
  data = reconcileWorkspaceDay(data, today);
  assert.deepEqual(dailyReflectionBatch(data, dailyHandle, today), []);
  assert.ok(
    data.codeforces.reflectionBatches?.some(
      (batch) =>
        batch.date === localDate(today) && batch.attemptIds.length === 0,
    ),
  );
  const imported = mergeActivity(
    data,
    dailyHandle,
    [dailyPage(20, 3)],
    "refresh",
    today,
  );
  assert.deepEqual(dailyReflectionBatch(imported, dailyHandle, today), []);
  assert.equal(reconcileWorkspaceDay(imported, today), imported);
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
    12,
  );
  const next = reconcileWorkspaceDay(imported, tomorrow);
  assert.equal(dailyReflectionBatch(next, dailyHandle, tomorrow).length, 3);
});

test("a legacy batchDate backup migrates its existing membership rather than refilling the day", () => {
  const original = dailyFixture(yesterday);
  const assigned = new Set(
    original.codeforces.reflectionBatches?.find(
      (batch) => batch.date === localDate(yesterday),
    )?.attemptIds,
  );
  const legacy = {
    ...original,
    codeforces: {
      ...original.codeforces,
      reflectionBatches: undefined,
      practiceAttempts: original.codeforces.practiceAttempts.map((attempt) =>
        assigned.has(attempt.id)
          ? { ...attempt, batchDate: localDate(yesterday) }
          : attempt,
      ),
    },
  };
  const restored = validateData(JSON.parse(JSON.stringify(legacy)));
  const reconciled = reconcileWorkspaceDay(restored, yesterday);
  assert.deepEqual(
    dailyReflectionBatch(reconciled, dailyHandle, yesterday).map(
      (attempt) => attempt.id,
    ),
    dailyReflectionBatch(original, dailyHandle, yesterday).map(
      (attempt) => attempt.id,
    ),
  );
  assert.equal(
    dailyReflectionCounts(reconciled, dailyHandle, yesterday).total,
    5,
  );
  assert.equal(reconciled.codeforces.reflectionBatches?.length, 1);
  assert.equal(reconcileWorkspaceDay(reconciled, yesterday), reconciled);
});

test("two devices on different local dates merge their batch ledgers without conflicting on legacy assignment fields", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const base = dailyFixture(new Date("2026-10-05T12:00:00Z"));
    const instant = new Date("2026-10-07T01:00:00Z");
    process.env.TZ = "America/Los_Angeles";
    const first = reconcileWorkspaceDay(base, instant);
    const firstIds = dailyReflectionBatch(first, dailyHandle, instant).map(
      (attempt) => attempt.id,
    );
    process.env.TZ = "Asia/Kolkata";
    const second = reconcileWorkspaceDay(base, instant);
    const secondIds = dailyReflectionBatch(second, dailyHandle, instant).map(
      (attempt) => attempt.id,
    );
    const merged = mergeWorkspaces(base, first, second);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(merged.data.codeforces.reflectionBatches?.length, 3);
    assert.deepEqual(
      dailyReflectionBatch(merged.data, dailyHandle, instant).map(
        (attempt) => attempt.id,
      ),
      secondIds,
    );
    assert.equal(reconcileWorkspaceDay(merged.data, instant), merged.data);
    process.env.TZ = "America/Los_Angeles";
    assert.deepEqual(
      dailyReflectionBatch(merged.data, dailyHandle, instant).map(
        (attempt) => attempt.id,
      ),
      firstIds,
    );
    assert.equal(reconcileWorkspaceDay(merged.data, instant), merged.data);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
