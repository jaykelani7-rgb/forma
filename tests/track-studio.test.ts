import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  emptyData,
  validateData,
  type Data,
  type Problem,
} from "../src/lib/model";
import { connectProfile } from "../src/lib/codeforces";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";
import { saveRevision, problemMemory } from "../src/lib/memory";
import { commitWorkspace, loadWorkspace } from "../src/lib/storage";
import {
  importTrack,
  updateTrack,
  trackDraft,
  trackContextForEntry,
  trackEntries,
  nextTrackEntry,
} from "../src/lib/tracks";
import {
  addPastedEntries,
  createManualEntry,
  createManualStage,
  createManualTrackDraft,
  entryNeedsReview,
  parseExtractedTrack,
  parsePastedProblems,
  trackDraftReview,
} from "../src/lib/track-studio";
import type { TrackImportDraft } from "../src/lib/tracks-types";

const now = new Date("2026-10-08T12:00:00Z");
const entries = (draft: TrackImportDraft) =>
  draft.stages.flatMap((stage) => stage.entries);
function personal(
  id: string,
  code: string,
  extra: Partial<Problem> = {},
): Problem {
  return {
    id,
    title: code,
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/${code.match(/^\d+/)![0]}/${code.replace(/^\d+/, "")}`,
    problemCode: code,
    tags: [],
    rating: null,
    createdAt: now.toISOString(),
    reviewAt: null,
    reviewCount: 0,
    ...extra,
  };
}

test("manual tracks and empty stages save without fabricated problems and keep unique operation fingerprints", () => {
  const first = createManualTrackDraft(),
    second = createManualTrackDraft();
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
  const empty = importTrack(emptyData(), first, undefined, now);
  assert.equal(empty.problems.length, 0);
  assert.deepEqual(empty.tracks![0].stageIds, []);
  assert.deepEqual(decodeBackup(encodeBackup(empty)), empty);
  first.stages.push(createManualStage("Later"));
  const staged = updateTrack(empty, first, now);
  assert.equal(staged.trackStages!.length, 1);
  assert.deepEqual(staged.trackStages![0].entryIds, []);
  assert.equal(nextTrackEntry(staged, first.id, now), null);
  assert.deepEqual(decodeBackup(encodeBackup(staged)), staged);
});

test("pasted lists preserve duplicate membership, A/A1/A2, explicit Gym namespace, and title-only candidates", () => {
  const text =
    "Stage 1: Foundation\n381A, 381A1, 381A2, 381A\nhttps://codeforces.com/gym/381/problem/A\nCut Ribbon without an ID";
  const draft = parsePastedProblems(text);
  assert.deepEqual(
    entries(draft).map((entry) => entry.code),
    ["381A", "381A1", "381A2", "381A", "381A", ""],
  );
  assert.equal(draft.stages[0].title, "Foundation");
  assert.equal(
    entries(draft)[4].url,
    "https://codeforces.com/gym/381/problem/A",
  );
  const summary = trackDraftReview(draft);
  assert.equal(summary.total, 6);
  assert.equal(summary.duplicateCount, 1);
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(entries(draft)[5].title, "Cut Ribbon without an ID");
  assert.ok(
    entries(draft).every(
      (entry) => entry.rating === null && entry.pattern === "",
    ),
  );
  assert.equal(
    parsePastedProblems(text).sourceFingerprint,
    draft.sourceFingerprint,
  );
  assert.notEqual(parsePastedProblems(text).id, draft.id);
});

test("space-delimited repeated IDs remain individual visible candidates rather than being silently deduplicated", () => {
  const draft = parsePastedProblems("381A 381A 381A1");
  assert.deepEqual(
    entries(draft).map((entry) => entry.code),
    ["381A", "381A", "381A1"],
  );
  assert.equal(trackDraftReview(draft).duplicateCount, 1);
});

test("PDF annotation identities preserve source locations and order while uncertain headings stay Ungrouped", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "Warm up",
        kind: "pdf-text",
        location: "Page 1, line 1",
        page: 1,
        heading: true,
      },
      {
        text: "Sereja and Dima",
        kind: "pdf-text",
        location: "Page 1, line 2",
        page: 1,
        links: ["https://codeforces.com/contest/381/problem/A"],
      },
      {
        text: "Stage II: Core patterns",
        kind: "pdf-text",
        location: "Page 2, line 1",
        page: 2,
      },
      {
        text: "Gym 381A1 — Source title | Rating: 1200 | Pattern: Opposite ends",
        kind: "pdf-text",
        location: "Page 2, line 2",
        page: 2,
      },
    ],
    "sheet.pdf",
    "controlled-pdf",
  );
  assert.deepEqual(
    draft.stages.map((stage) => stage.title),
    ["Ungrouped", "Core patterns"],
  );
  assert.equal(entries(draft)[0].code, "");
  assert.equal(entries(draft)[1].title, "Sereja and Dima");
  assert.equal(entries(draft)[1].code, "381A");
  assert.equal(
    entries(draft)[2].url,
    "https://codeforces.com/gym/381/problem/A1",
  );
  assert.equal(entries(draft)[2].rating, 1200);
  assert.equal(entries(draft)[2].pattern, "Opposite ends");
  assert.deepEqual(
    entries(draft).map((entry) => entry.source!.page),
    [1, 1, 2],
  );
  assert.equal(entries(draft)[1].source!.text, "Sereja and Dima");
});

test("only complete table-header rows are omitted; a candidate beside header-like text stays visible", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "Problem | Rating | Pattern",
        kind: "pdf-text",
        location: "Page 1, header",
      },
      {
        text: "Problem | Rating | 381A",
        kind: "pdf-text",
        location: "Page 1, row 1",
      },
      {
        text: "Problem | Rating | A title without a link",
        kind: "pdf-text",
        location: "Page 1, row 2",
      },
      {
        text: "Problem | Rating",
        kind: "pdf-text",
        location: "Page 1, linked row",
        links: ["https://codeforces.com/contest/189/problem/A"],
      },
    ],
    "header-like.pdf",
    "header-like",
  );
  assert.equal(entries(draft).length, 3);
  assert.equal(entries(draft)[0].code, "381A");
  assert.equal(entries(draft)[1].code, "");
  assert.equal(entries(draft)[1].source!.location, "Page 1, row 2");
  assert.equal(entries(draft)[2].code, "189A");
});

test("PDF hyperlink and printed identity contradictions require a deliberate correction", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "381B — Printed name",
        kind: "pdf-text",
        location: "Page 2, row 4",
        page: 2,
        links: ["https://codeforces.com/contest/381/problem/A"],
      },
    ],
    "conflicting.pdf",
    "conflicting",
  );
  assert.equal(entries(draft).length, 1);
  assert.equal(entries(draft)[0].code, "");
  assert.equal(entries(draft)[0].url, "");
  assert.equal(trackDraftReview(draft).unresolvedCount, 1);
  assert.ok(
    entries(draft)[0].source!.reviewReasons!.some((reason) =>
      /More than one/.test(reason),
    ),
  );
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /unresolved/,
  );
  const repaired = entries(draft)[0];
  repaired.code = "381B";
  repaired.title = "Printed name";
  assert.equal(
    entryNeedsReview(repaired),
    false,
    "Choosing one identity repairs a row that originally had no single identity",
  );
  const saved = importTrack(emptyData(), draft, undefined, now);
  assert.equal(saved.trackEntries![0].code, "381B");
  assert.equal(
    saved.trackEntries![0].source!.text,
    "381B — Printed name\nHyperlink: https://codeforces.com/contest/381/problem/A",
  );
  assert.equal(
    decodeBackup(encodeBackup(saved)).trackEntries![0].source!.text,
    saved.trackEntries![0].source!.text,
    "The conflicting annotation remains available after saving and restoring a backup",
  );
});

test("ambiguous OCR tokens and conflicting identities retain exact evidence without character substitutions", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "38IA — OCR title",
        kind: "ocr",
        location: "Image line 1",
        confidence: 62,
      },
      {
        text: "381A or 381B — Uncertain row",
        kind: "ocr",
        location: "Image line 2",
        confidence: 90,
      },
      {
        text: "A title without a hyperlink",
        kind: "ocr",
        location: "Image line 3",
        confidence: 91,
      },
    ],
    "scan.png",
    "controlled-scan",
  );
  assert.equal(entries(draft).length, 3);
  assert.ok(
    entries(draft).every((entry) => entry.code === "" && entry.url === ""),
  );
  assert.equal(entries(draft)[0].source!.text, "38IA — OCR title");
  assert.ok(
    entries(draft)[0].source!.reviewReasons!.some((reason) =>
      /low/i.test(reason),
    ),
  );
  assert.ok(
    entries(draft)[1].source!.reviewReasons!.some((reason) =>
      /More than one/.test(reason),
    ),
  );
  assert.equal(trackDraftReview(draft).unresolvedCount, 3);
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /unresolved/,
  );
});

test("recognized OCR IDs require review, deliberate identity corrections resolve it, and explicit exclusions alone remove rows", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "381A — Sereja and Dima",
        kind: "ocr",
        location: "Page 1, line 1",
        page: 1,
        confidence: 98,
      },
      {
        text: "A missing-link title",
        kind: "ocr",
        location: "Page 1, line 2",
        page: 1,
        confidence: 90,
      },
    ],
    "scan.pdf",
    "review-gate",
  );
  assert.equal(entryNeedsReview(entries(draft)[0]), true);
  entries(draft)[1].excluded = true;
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /flagged source/,
  );
  const corrected = structuredClone(draft);
  entries(corrected)[0].code = "381B";
  entries(corrected)[0].url = "https://codeforces.com/problemset/problem/381/B";
  assert.equal(entryNeedsReview(entries(corrected)[0]), false);
  assert.equal(
    importTrack(emptyData(), corrected, undefined, now).trackEntries![0].code,
    "381B",
  );
  entries(draft)[0].reviewed = true;
  const saved = importTrack(emptyData(), draft, undefined, now);
  assert.equal(saved.trackEntries!.length, 1);
  assert.equal(
    entries(draft).length,
    2,
    "The correction draft still contains the excluded candidate",
  );
  assert.equal(saved.trackEntries![0].source!.text, "381A — Sereja and Dima");
  assert.ok(!Object.hasOwn(saved.trackEntries![0], "reviewed"));
  assert.ok(!Object.hasOwn(saved.trackEntries![0], "excluded"));
  assert.equal(
    importTrack(saved, draft, undefined, now),
    saved,
    "An exact retained reviewed draft retries the same operation",
  );
  assert.equal(
    entryNeedsReview(entries(trackDraft(saved, draft.id))[0]),
    false,
    "Saved source review remains acknowledged when reopening Studio",
  );
});

test("OCR annotated identities still require explicit review when the printed title has no ID", () => {
  const draft = parseExtractedTrack(
    [
      {
        text: "Sereja and Dima",
        kind: "ocr",
        location: "Scanned page 1",
        links: ["https://codeforces.com/gym/381/problem/A"],
      },
    ],
    "annotated-scan.pdf",
    "annotated-scan",
  );
  assert.equal(entries(draft)[0].code, "381A");
  assert.equal(entryNeedsReview(entries(draft)[0]), true);
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /flagged source/,
  );
});

test("raw invalid or conflicting identity edits fail validation without rewriting the retained source", () => {
  const draft = parsePastedProblems("381A — Sereja and Dima");
  const original = structuredClone(draft);
  entries(draft)[0].code = "38IA";
  assert.equal(trackDraftReview(draft).unresolvedCount, 1);
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /unresolved/,
  );
  entries(draft)[0].code = "381B";
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /same problem/,
  );
  entries(draft)[0].code = "381A";
  entries(draft)[0].url = "https://example.com/381/A";
  assert.throws(
    () => importTrack(emptyData(), draft, undefined, now),
    /supported URL/,
  );
  assert.deepEqual(entries(draft)[0].source, entries(original)[0].source);
});

test("adding a batch preserves existing IDs and retains every unresolved pasted row for correction", () => {
  const draft = createManualTrackDraft();
  const stage = createManualStage("Foundation");
  const original = createManualEntry();
  original.title = "Original";
  original.code = "381A";
  stage.entries.push(original);
  draft.stages.push(stage);
  const expanded = addPastedEntries(draft, stage.id, "189A\nMissing identity");
  assert.equal(expanded.id, draft.id);
  assert.equal(expanded.stages[0].id, stage.id);
  assert.equal(entries(expanded)[0].id, original.id);
  assert.deepEqual(
    entries(expanded).map((entry) => entry.code),
    ["381A", "189A", ""],
  );
  assert.equal(
    entries(draft).length,
    1,
    "Draft helpers leave the previous revision untouched",
  );
  assert.throws(
    () => addPastedEntries(draft, "removed-stage", "189A"),
    /Choose a stage/,
  );
});

test("source notes and evidence round trip with old backups remaining valid, and unsafe evidence is rejected", () => {
  const draft = parsePastedProblems("381A — Source title");
  draft.sourceNotes = "Imported from my handwritten sheet.";
  draft.stages[0].sourceNotes = "Page 2 combines these rows.";
  const saved = importTrack(emptyData(), draft, undefined, now);
  assert.deepEqual(decodeBackup(encodeBackup(saved)), saved);
  assert.equal(trackDraft(saved, draft.id).sourceNotes, draft.sourceNotes);
  assert.equal(
    trackDraft(saved, draft.id).stages[0].sourceNotes,
    draft.stages[0].sourceNotes,
  );
  const legacy = structuredClone(saved);
  delete legacy.tracks![0].sourceNotes;
  delete legacy.trackStages![0].sourceNotes;
  delete legacy.trackEntries![0].source;
  assert.deepEqual(validateData(legacy), legacy);
  for (const source of [
    { kind: "ai", location: "Source", text: "" },
    { kind: "ocr", location: "Source", text: "", page: 0 },
    { kind: "ocr", location: "Source", text: "", confidence: 101 },
    { kind: "ocr", location: "Source", text: "", reviewReasons: [""] },
  ]) {
    assert.throws(
      () =>
        validateData({
          ...saved,
          trackEntries: [{ ...saved.trackEntries![0], source }],
        }),
      /Track records/,
    );
  }
  assert.throws(
    () =>
      validateData({
        ...saved,
        tracks: [{ ...saved.tracks![0], sourceNotes: "x".repeat(5001) }],
      }),
    /Track records/,
  );
});

test("moving, replacing, and removing membership preserve original practice, reflections, recall, schedules, and context snapshots", () => {
  const draft = parsePastedProblems(
    "Stage 1: Original\n381A — Original title\nStage 2: Later\n189A — Cut Ribbon",
  );
  let data = importTrack(emptyData(), draft, undefined, now);
  const first = data.trackEntries![0];
  const context = trackContextForEntry(data, first.id)!;
  data = {
    ...data,
    problems: data.problems.map((problem) =>
      problem.id === first.problemId
        ? {
            ...problem,
            reviewAt: "2026-10-15",
            reviewUpdatedAt: now.toISOString(),
          }
        : problem,
    ),
    attempts: [
      {
        id: "practice-before-edit",
        problemId: first.problemId,
        startedAt: "2026-10-08T11:30:00Z",
        completedAt: now.toISOString(),
        elapsedMs: 1800000,
        outcome: "hint",
        difficulty: "approach",
        takeaway: "Keep the invariant explicit.",
        notes: "Original notes.",
        mistakes: ["invariant"],
        approach: "Move one pointer.",
        trackContext: context,
      },
    ],
  };
  data = saveRevision(data, {
    id: "recall-before-edit",
    problemId: first.problemId,
    handle: null,
    activity: "explain",
    outcome: "cue",
    response: "Only the ends remain.",
    cue: "Which choices remain?",
    completedAt: now.toISOString(),
    nextReviewAt: "2026-10-11",
    trackContext: context,
  });
  data = validateData(data);
  const before = structuredClone(data);
  const edit = trackDraft(data, draft.id);
  const moved = edit.stages[0].entries.shift()!;
  edit.stages[1].entries.unshift(moved);
  edit.stages[0].title = "Renamed empty stage";
  data = updateTrack(data, edit, now);
  assert.equal(
    data.trackEntries!.find((entry) => entry.id === first.id)!.stageId,
    edit.stages[1].id,
  );
  assert.deepEqual(data.attempts, before.attempts);
  assert.deepEqual(data.revisions, before.revisions);
  const replace = trackDraft(data, draft.id);
  const replacement = entries(replace).find((entry) => entry.id === first.id)!;
  replacement.code = "189A";
  replacement.url = "https://codeforces.com/problemset/problem/189/A";
  replacement.title = "Replacement";
  data = updateTrack(data, replace, now);
  const replaced = data.trackEntries!.find((entry) => entry.id === first.id)!;
  assert.equal(replaced.id, first.id);
  assert.notEqual(replaced.problemId, first.problemId);
  assert.equal(
    data.problems.length,
    2,
    "Replacement reuses the other existing identity",
  );
  assert.deepEqual(data.attempts, before.attempts);
  assert.deepEqual(data.revisions, before.revisions);
  assert.deepEqual(data.problems, before.problems);
  assert.equal(problemMemory(data, replaced.problemId).history.length, 0);
  assert.equal(problemMemory(data, first.problemId).history.length, 1);
  const remove = trackDraft(data, draft.id);
  remove.stages = [];
  data = updateTrack(data, remove, now);
  assert.equal(trackEntries(data, draft.id).length, 0);
  assert.deepEqual(data.attempts, before.attempts);
  assert.deepEqual(data.revisions, before.revisions);
  assert.deepEqual(data.attempts[0].trackContext, context);
  assert.deepEqual(data.revisions![0].trackContext, context);
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});

test("identity replacement reuses only personal/current-profile problems and never borrows another profile's history", () => {
  let base: Data = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  base = {
    ...base,
    problems: [
      personal("alpha-189A", "189A", {
        cfHandle: "alpha",
        cfKey: "contest:189:A",
      }),
    ],
  };
  let data = importTrack(base, parsePastedProblems("381A"), undefined, now);
  data = connectProfile(
    data,
    { handle: "beta", rating: null, rank: null },
    now,
  );
  const edit = trackDraft(data, data.tracks![0].id);
  entries(edit)[0].code = "189A";
  entries(edit)[0].url = "";
  entries(edit)[0].title = "Beta's membership";
  const saved = updateTrack(data, edit, now);
  const selected = saved.problems.find(
    (problem) => problem.id === saved.trackEntries![0].problemId,
  )!;
  assert.notEqual(selected.id, "alpha-189A");
  assert.equal(selected.cfHandle, undefined);
  assert.deepEqual(
    saved.problems.find((problem) => problem.id === "alpha-189A"),
    base.problems[0],
  );
  const personalReuse = {
    ...saved,
    problems: [...saved.problems, personal("personal-4A", "4A")],
  };
  const second = trackDraft(personalReuse, edit.id);
  entries(second)[0].code = "4A";
  entries(second)[0].url = "";
  assert.equal(
    updateTrack(personalReuse, second, now).trackEntries![0].problemId,
    "personal-4A",
  );
});

test("Gym and contest memberships stay separate while explicit legacy Gym evidence remains reusable", () => {
  const legacy = personal("legacy-gym", "381A", {
    url: "https://codeforces.com/gym/381/problem/A",
    cfKey: "contest:381:A",
    cfHandle: "alpha",
  });
  const base = {
    ...connectProfile(
      emptyData(),
      { handle: "alpha", rating: null, rank: null },
      now,
    ),
    problems: [legacy],
  };
  const draft = parsePastedProblems(
    "https://codeforces.com/gym/381/problem/A\nhttps://codeforces.com/contest/381/problem/A",
  );
  const saved = importTrack(base, draft, undefined, now);
  assert.equal(saved.trackEntries![0].problemId, legacy.id);
  assert.notEqual(saved.trackEntries![1].problemId, legacy.id);
  assert.equal(saved.problems.length, 2);
  assert.deepEqual(saved.problems[0], legacy);
  assert.equal(trackDraftReview(draft).duplicateCount, 0);
  assert.deepEqual(validateData(saved), saved);
});

test("failed manual save keeps one exact draft operation and a successful retry reloads all source notes", async () => {
  const key = "account:studio-manual-failed";
  const base = await loadWorkspace(key);
  const draft = createManualTrackDraft();
  draft.sourceNotes = "A source note retained across retry.";
  const proposed = importTrack(base.data, draft, undefined, now);
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
  assert.deepEqual((await loadWorkspace(key)).data, base.data);
  const retry = importTrack(proposed, draft, undefined, now);
  assert.equal(retry, proposed);
  await commitWorkspace(key, await loadWorkspace(key), retry);
  const restored = (await loadWorkspace(key)).data;
  assert.equal(restored.tracks!.length, 1);
  assert.equal(restored.tracks![0].id, draft.id);
  assert.equal(restored.tracks![0].sourceNotes, draft.sourceNotes);
  assert.deepEqual(restored.problems, []);
  assert.deepEqual(decodeBackup(encodeBackup(restored)), restored);
});
