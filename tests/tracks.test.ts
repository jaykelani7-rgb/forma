import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  localDate,
  nextReview,
  validateData,
} from "../src/lib/model";
import type { Attempt, Data, Problem } from "../src/lib/model";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import {
  decodeBackup,
  encodeBackup,
  mergeWorkspaces,
} from "../src/lib/concurrency";
import { withPracticeSession } from "../src/lib/practice-session";
import type { TrackImportDraft } from "../src/lib/tracks-types";
import {
  copyTrackDraft,
  findDuplicateTracks,
  importTrack,
  nextTrackEntry,
  removeTrack,
  stageEntries,
  trackContextForEntry,
  trackDraft,
  trackEntries,
  trackEntryProgress,
  trackProblem,
  trackProgress,
  updateTrack,
} from "../src/lib/tracks";

const now = new Date("2026-10-07T12:00:00.000Z");
function draft(
  id = "track-one",
  codes = ["189A", "1000C1", "1000C2"],
): TrackImportDraft {
  return {
    id,
    title: "Two pointers",
    sourceName: "practice.docx",
    sourceFingerprint: "sheet-fingerprint",
    stages: [
      {
        id: `${id}-foundation`,
        title: "Foundation",
        description: "Build a clear invariant.",
        suggestedTime: "20 minutes per problem",
        entries: codes.map((code, index) => ({
          id: `${id}-${index}`,
          title: `Source title ${index + 1}`,
          url: "",
          code,
          rating: 1300,
          pattern: "Use two moving boundaries",
        })),
      },
    ],
  };
}
function problem(code = "189A"): Problem {
  return {
    id: "personal-ribbon",
    title: "Catalogue title",
    platform: "Codeforces",
    url: "https://codeforces.com/contest/189/problem/A",
    problemCode: code,
    tags: ["dp"],
    rating: 1500,
    createdAt: "2026-10-01T12:00:00.000Z",
    reviewAt: null,
    reviewCount: 0,
  };
}
function attempted(
  data: Data,
  problemId: string,
  outcome: Attempt["outcome"],
  completedAt = now.toISOString(),
): Data {
  return {
    ...data,
    attempts: [
      ...data.attempts,
      {
        id: `attempt-${data.attempts.length}`,
        problemId,
        startedAt: new Date(Date.parse(completedAt) - 600000).toISOString(),
        completedAt,
        elapsedMs: 600000,
        outcome,
        difficulty: outcome === "independent" ? null : "approach",
        takeaway: "Keep the left boundary monotonic.",
        notes: "Notes remain personal.",
      },
    ],
  };
}
function activity(handle: string): Data {
  const data = connectProfile(
    emptyData(),
    { handle, rating: null, rank: null },
    now,
  );
  return mergeActivity(
    data,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id: 10,
            submittedAt: "2026-10-06T12:00:00.000Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:189:A",
              title: "Cut Ribbon",
              code: "189A",
              url: "https://codeforces.com/problemset/problem/189/A",
              rating: 1300,
              tags: ["dp"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
}

test("a confirmed sheet is one valid snapshot, preserving order, C1/C2, and source metadata", () => {
  const base = { ...emptyData(), problems: [problem()] };
  const data = importTrack(base, draft(), undefined, now);
  assert.equal(base.problems.length, 1);
  assert.equal(base.tracks!.length, 0);
  assert.equal(data.problems.length, 3);
  assert.deepEqual(
    trackEntries(data, "track-one").map((entry) => entry.code),
    ["189A", "1000C1", "1000C2"],
  );
  assert.equal(data.trackEntries![0].problemId, "personal-ribbon");
  assert.equal(data.trackEntries![0].title, "Source title 1");
  assert.equal(data.trackEntries![0].rating, 1300);
  assert.deepEqual(data.problems[0], base.problems[0]);
  assert.equal(
    data.problems[1].tags.length,
    0,
    "The hidden sheet hint must not become a public problem tag",
  );
  assert.equal(data.activeTrackId, "track-one");
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});

test("multiple tracks share problems and history, while copied-sheet retries stay idempotent", () => {
  let data = attempted(
    { ...emptyData(), problems: [problem()] },
    "personal-ribbon",
    "independent",
  );
  data = importTrack(data, draft(), undefined, now);
  assert.throws(
    () => importTrack(data, draft("duplicate"), undefined, now),
    /already/,
  );
  const copy = copyTrackDraft(draft());
  data = importTrack(data, copy, { duplicates: "copy" }, now);
  assert.equal(data.problems.length, 3);
  assert.equal(data.attempts.length, 1);
  assert.equal(findDuplicateTracks(data, copy).length, 2);
  assert.equal(trackProgress(data, copy.id, now).independent, 1);
  assert.equal(importTrack(data, copy, { duplicates: "copy" }, now), data);
  assert.equal(
    trackEntries(data, "track-one")[0].problemId,
    trackEntries(data, copy.id)[0].problemId,
  );
});

test("a retained failed preview can be corrected without changing its operation or duplicating memberships", () => {
  const preview = draft();
  const optimistic = importTrack(emptyData(), preview, undefined, now);
  preview.title = "Corrected track title";
  preview.stages[0].entries[0].title = "Corrected source title";
  const corrected = importTrack(optimistic, preview, undefined, now);
  assert.equal(corrected.tracks!.length, 1);
  assert.equal(corrected.trackEntries!.length, 3);
  assert.equal(corrected.problems.length, 3);
  assert.equal(corrected.tracks![0].id, preview.id);
  assert.equal(corrected.tracks![0].title, "Corrected track title");
  assert.equal(corrected.trackEntries![0].title, "Corrected source title");
});

test("unresolved identity, mismatched references, duplicate IDs, and unsafe source links cannot commit", () => {
  const missing = draft();
  missing.stages[0].entries[0].code = "";
  assert.throws(() => importTrack(emptyData(), missing), /unresolved/);
  const data = importTrack(emptyData(), draft(), undefined, now);
  assert.throws(
    () =>
      validateData({
        ...data,
        trackEntries: data.trackEntries!.map((entry, index) =>
          index ? entry : { ...entry, problemId: data.problems[1].id },
        ),
      }),
    /Track records/,
  );
  assert.throws(
    () => validateData({ ...data, tracks: [...data.tracks!, data.tracks![0]] }),
    /Track records/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        trackEntries: data.trackEntries!.map((entry) => ({
          ...entry,
          url: "javascript:alert(1)",
        })),
      }),
    /Track records/,
  );
  assert.throws(
    () => validateData({ ...data, activeTrackId: "missing" }),
    /Track records/,
  );
});

test("legacy notebooks and backups gain empty track collections without losing existing fields", () => {
  const old = JSON.parse(JSON.stringify(emptyData()));
  delete old.tracks;
  delete old.trackStages;
  delete old.trackEntries;
  delete old.activeTrackId;
  delete old.settings.textSize;
  const migrated = validateData(old);
  assert.deepEqual(migrated.tracks, []);
  assert.equal(migrated.activeTrackId, null);
  assert.equal(migrated.settings.textSize, "comfortable");
  assert.deepEqual(
    decodeBackup(
      encodeBackup({
        ...migrated,
        settings: { ...migrated.settings, textSize: "large" },
      }),
    ).settings.textSize,
    "large",
  );
  assert.throws(
    () =>
      validateData({
        ...migrated,
        settings: { ...migrated.settings, textSize: "tiny" },
      }),
    /text size/,
  );
});

test("editing a track reorders memberships and preserves immutable source and all practice history", () => {
  let data = importTrack(emptyData(), draft(), undefined, now);
  data = attempted(data, data.trackEntries![0].problemId, "hint");
  const edited = trackDraft(data, "track-one");
  edited.title = "My track";
  edited.sourceName = "replace.docx";
  edited.sourceFingerprint = "different";
  edited.stages[0].entries.reverse();
  edited.stages[0].entries.pop();
  data = updateTrack(data, edited, now);
  assert.equal(data.tracks![0].title, "My track");
  assert.equal(data.tracks![0].sourceName, "practice.docx");
  assert.equal(data.tracks![0].sourceFingerprint, "sheet-fingerprint");
  assert.deepEqual(
    stageEntries(data, edited.stages[0].id).map((entry) => entry.code),
    ["1000C2", "1000C1"],
  );
  assert.equal(data.problems.length, 3);
  assert.equal(data.attempts.length, 1);
});

test("removing a track preserves timed session/attempt snapshots, revisits, platform records, and underlying problems", () => {
  let data = importTrack(activity("alpha"), draft(), undefined, now);
  const entry = data.trackEntries![0];
  const context = trackContextForEntry(data, entry.id)!;
  data = attempted(data, entry.problemId, "hint");
  data.attempts[0].trackContext = context;
  data = {
    ...withPracticeSession(
      data,
      data.problems[0],
      30,
      now.getTime(),
      "focused",
    ),
    session: {
      ...withPracticeSession(
        data,
        data.problems[0],
        30,
        now.getTime(),
        "focused",
      ).session!,
      trackContext: context,
    },
  };
  const removed = validateData(removeTrack(data, "track-one"));
  assert.equal(removed.tracks!.length, 0);
  assert.equal(removed.activeTrackId, null);
  assert.deepEqual(removed.problems, data.problems);
  assert.deepEqual(removed.codeforces, data.codeforces);
  assert.deepEqual(removed.attempts, data.attempts);
  assert.deepEqual(removed.session, data.session);
});

test("platform acceptance is distinct from reflected understanding and imported time remains unknown", () => {
  const pending = importTrack(activity("alpha"), draft(), undefined, now);
  const entry = pending.trackEntries![0];
  let progress = trackEntryProgress(pending, entry, now);
  assert.equal(progress.accepted, true);
  assert.equal(progress.attempted, true);
  assert.equal(progress.reflected, false);
  assert.equal(progress.independent, false);
  assert.equal(progress.measuredMinutes, 0);
  assert.equal(nextTrackEntry(pending, "track-one", now)?.entry.id, entry.id);
  const reflected = saveQuickReflection(
    pending,
    pending.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: "approach",
      takeaway: "Recheck the invariant.",
      reviewAt: null,
      overrideSchedule: true,
    },
    now,
  );
  progress = trackEntryProgress(reflected, entry, now);
  assert.equal(progress.accepted, true);
  assert.equal(progress.assisted, true);
  assert.equal(progress.independent, false);
  assert.equal(
    nextTrackEntry(reflected, "track-one", now)?.entry.id,
    entry.id,
    "Assisted solve with no schedule remains unfinished",
  );
  assert.deepEqual(progress.takeaways, ["Recheck the invariant."]);
});

test("a different connected profile never inherits another handle's acceptance or learning", () => {
  const alpha = importTrack(activity("alpha"), draft(), undefined, now);
  const beta = connectProfile(
    alpha,
    { handle: "beta", rating: null, rank: null },
    now,
  );
  const entry = alpha.trackEntries![0];
  const progress = trackEntryProgress(beta, entry, now);
  assert.equal(progress.accepted, false);
  assert.equal(progress.attempted, false);
  assert.equal(progress.independent, false);
  const recommendation = nextTrackEntry(beta, "track-one", now)!;
  assert.equal(recommendation.fresh, true);
  assert.equal(recommendation.problem.cfHandle, undefined);
  assert.notEqual(recommendation.problem.id, entry.problemId);
  const newTrack = importTrack(
    beta,
    draft("beta-track"),
    { duplicates: "copy" },
    now,
  );
  assert.equal(
    newTrack.problems.find(
      (problem) =>
        problem.id ===
        newTrack.trackEntries!.find((entry) => entry.trackId === "beta-track")!
          .problemId,
    )?.cfHandle,
    undefined,
  );
});

test("next eligible selection prioritizes due revisits, preserves exclusions, and advances independent work", () => {
  let data = importTrack(emptyData(), draft(), undefined, now);
  const entries = trackEntries(data, "track-one");
  data = attempted(data, entries[0].problemId, "independent");
  data = attempted(data, entries[1].problemId, "hint");
  assert.equal(nextTrackEntry(data, "track-one", now)?.entry.id, entries[1].id);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === entries[1].problemId
        ? { ...problem, reviewAt: "2026-10-09" }
        : problem,
    ),
  };
  assert.equal(nextTrackEntry(data, "track-one", now)?.entry.id, entries[2].id);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === entries[2].problemId
        ? { ...problem, skippedOn: localDate(now) }
        : problem,
    ),
  };
  assert.equal(nextTrackEntry(data, "track-one", now), null);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === entries[0].problemId
        ? { ...problem, reviewAt: localDate(now) }
        : problem,
    ),
  };
  assert.equal(nextTrackEntry(data, "track-one", now)?.entry.id, entries[0].id);
  assert.equal(nextTrackEntry(data, "track-one", now)?.revisit, true);
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === entries[0].problemId
        ? { ...problem, deferredUntil: "2026-10-08" }
        : problem,
    ),
  };
  assert.equal(nextTrackEntry(data, "track-one", now), null);
  data = {
    ...data,
    problems: data.problems.map((problem) => ({ ...problem, archived: true })),
  };
  assert.equal(nextTrackEntry(data, "track-one", now), null);
});

test("track practice uses the existing reflection schedule and snapshots the last practised position", () => {
  let data = importTrack(emptyData(), draft(), undefined, now);
  const entry = data.trackEntries![1];
  const { problem } = trackProblem(data, entry, now);
  const context = trackContextForEntry(data, entry.id)!;
  const focused = withPracticeSession(
    data,
    problem,
    30,
    now.getTime() - 600000,
    "focus",
  );
  data = attempted({ ...focused, session: null }, problem.id, "hint");
  data.attempts[0].trackContext = context;
  data = {
    ...data,
    problems: data.problems.map((value) =>
      value.id === problem.id
        ? {
            ...value,
            ...nextReview(value, "hint", now, data.settings.reviewDays),
          }
        : value,
    ),
  };
  const progress = trackProgress(data, "track-one", now);
  assert.equal(progress.measuredMinutes, 10);
  assert.equal(progress.lastPractised?.entry.id, entry.id);
  assert.equal(progress.lastPractised?.stage.id, context.stageId);
  assert.equal(
    data.problems.find((value) => value.id === problem.id)!.reviewAt,
    "2026-10-12",
  );
  assert.equal(trackEntryProgress(data, entry, now).revisitDue, false);
  assert.equal(
    trackEntryProgress(data, entry, new Date("2026-10-12T12:00:00.000Z"))
      .revisitDue,
    true,
  );
  assert.deepEqual(validateData(data), data);
});

test("flat track identities merge independent track/stage edits, and overlapping edits preserve recovery semantics", () => {
  const base = importTrack(emptyData(), draft(), undefined, now);
  const local = {
    ...base,
    tracks: base.tracks!.map((track) => ({ ...track, title: "Local title" })),
  };
  const remote = {
    ...base,
    trackStages: base.trackStages!.map((stage) => ({
      ...stage,
      description: "Remote objective",
    })),
  };
  const merged = mergeWorkspaces(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data.tracks![0].title, "Local title");
  assert.equal(merged.data.trackStages![0].description, "Remote objective");
  const conflict = mergeWorkspaces(base, local, {
    ...base,
    tracks: base.tracks!.map((track) => ({ ...track, title: "Remote title" })),
  });
  assert.ok(conflict.conflicts.some((path) => path.endsWith(".title")));
  assert.equal(conflict.data.tracks![0].title, "Remote title");
});

test("duplicate membership shares learning dimensions without inventing extra measured time", () => {
  let data = importTrack(
    emptyData(),
    draft("repeated", ["189A", "189A"]),
    undefined,
    now,
  );
  data = attempted(data, data.trackEntries![0].problemId, "independent");
  assert.equal(data.problems.length, 1);
  assert.equal(trackProgress(data, "repeated", now).independent, 2);
  assert.equal(trackProgress(data, "repeated", now).measuredMinutes, 10);
  assert.equal(nextTrackEntry(data, "repeated", now), null);
});

test("every stage can recommend its own next eligible entry without a lock on earlier stages", () => {
  const preview = draft();
  const coreEntry = preview.stages[0].entries.pop()!;
  preview.stages.push({
    id: "core",
    title: "Core Patterns",
    description: "Combine the invariants.",
    suggestedTime: "30 minutes",
    entries: [coreEntry],
  });
  const data = importTrack(emptyData(), preview, undefined, now);
  assert.equal(nextTrackEntry(data, preview.id, now)?.entry.code, "189A");
  assert.equal(
    nextTrackEntry(data, preview.id, now, "core")?.entry.code,
    "1000C2",
  );
});

test("an unrelated existing ID cannot replace the problem selected for a track practice session", () => {
  const unrelated = {
    ...problem(),
    id: "track-problem:contest:189:A",
    url: "https://codeforces.com/problemset/problem/4/A",
    problemCode: "4A",
  };
  const data = importTrack(
    { ...emptyData(), problems: [unrelated] },
    draft("collision", ["189A"]),
    undefined,
    now,
  );
  const selected = nextTrackEntry(data, "collision", now)!;
  assert.notEqual(selected.problem.id, unrelated.id);
  const focused = withPracticeSession(
    data,
    selected.problem,
    30,
    now.getTime(),
    "correct-session",
  );
  assert.equal(
    focused.problems.find((value) => value.id === focused.session!.problemId)!
      .problemCode,
    "189A",
  );
});

test("inconsistent legacy platform identity is preserved but cannot grant reuse or track progress", () => {
  const original = activity("alpha");
  const inconsistent = {
    ...original,
    problems: original.problems.map((problem) => ({
      ...problem,
      url: "https://codeforces.com/problemset/problem/4/A",
      problemCode: "4A",
    })),
  };
  const imported = importTrack(
    inconsistent,
    draft("consistent-track", ["189A"]),
    undefined,
    now,
  );
  assert.equal(imported.problems.length, 2);
  assert.deepEqual(imported.problems[0], inconsistent.problems[0]);
  assert.notEqual(
    imported.trackEntries![0].problemId,
    inconsistent.problems[0].id,
  );
  assert.equal(
    trackEntryProgress(imported, imported.trackEntries![0], now).accepted,
    false,
  );
  assert.equal(
    trackEntryProgress(imported, imported.trackEntries![0], now).attempted,
    false,
  );
});
