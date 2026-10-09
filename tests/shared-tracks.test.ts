import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectProfile } from "../src/lib/codeforces";
import { canonicalProblemIdentity } from "../src/lib/codeforces-identity";
import { createContest } from "../src/lib/contest-lab";
import { parsePracticeSheet } from "../src/lib/docx-import";
import { createDemo, emptyData, validateData } from "../src/lib/model";
import type { Problem } from "../src/lib/model";
import {
  encodeSharedTrack,
  findEquivalentSharedTracks,
  parseSharedTrack,
  readSharedTrackFile,
  sharedTrackFilename,
  sharedTrackFingerprint,
  sharedTrackFromTrack,
  sharedTrackPreview,
  SHARED_TRACK_LIMITS,
} from "../src/lib/shared-tracks";
import type { SharedTrackFile } from "../src/lib/shared-tracks";
import {
  copyTrackDraft,
  findDuplicateTracks,
  importTrack,
  trackDraft,
  trackEntries,
  trackEntryProgress,
  updateTrack,
} from "../src/lib/tracks";

const now = new Date("2026-10-09T09:00:00.000Z");
function file(): SharedTrackFile {
  return {
    format: "forma-track",
    version: 1,
    track: {
      title: "Boundary practice",
      shareDescription: "A public curriculum description",
      stages: [
        {
          title: "Foundation",
          description: "State the invariant.",
          suggestedTime: "15–25 minutes",
          problems: [
            {
              title: "Watermelon",
              code: "4A",
              url: "",
              rating: 800,
              hint: "Parity",
            },
            { title: "First split", code: "4A1", url: "", rating: null },
            { title: "Second split", code: "4A2", url: "", rating: 1200 },
            {
              title: "Training problem",
              code: "Gym 100001A",
              url: "",
              rating: null,
            },
            {
              title: "Contest problem",
              code: "100001A",
              url: "",
              rating: null,
            },
          ],
        },
        {
          title: "Revisit the invariant",
          suggestedTime: "30 minutes",
          problems: [
            {
              title: "Watermelon again",
              code: "4A",
              url: "",
              rating: 800,
              hint: "Parity",
            },
          ],
        },
      ],
    },
  };
}
function preview(value: SharedTrackFile = file()) {
  return parseSharedTrack(JSON.stringify(value));
}
function saved(value: SharedTrackFile = file()) {
  const draft = preview(value);
  return { draft, data: importTrack(emptyData(), draft, undefined, now) };
}
function p(id: string, code: string, handle?: string): Problem {
  return {
    id,
    title: "Recipient catalogue title",
    platform: "Codeforces",
    url: "",
    problemCode: code,
    rating: 1900,
    tags: ["personal-tag"],
    createdAt: now.toISOString(),
    reviewAt: "2026-10-20",
    reviewCount: 3,
    ...(handle
      ? {
          cfHandle: handle,
          cfKey: canonicalProblemIdentity({
            platform: "Codeforces",
            url: "",
            problemCode: code,
          })!,
        }
      : {}),
  };
}

test("the allowlist export omits personal, account, contest, source and scheduling data and leaves the workspace unchanged", () => {
  let sender = connectProfile(
    createDemo(now),
    { handle: "private_handle", rating: 1700, rank: "expert" },
    now,
  );
  const curriculum = preview();
  curriculum.sourceName = "private-local-file.docx";
  curriculum.sourceNotes = "private track source notes";
  curriculum.stages[0].sourceNotes = "private stage source notes";
  curriculum.stages[0].entries[0].source = {
    kind: "docx",
    location: "private-local-file.docx, row 1",
    text: "private extracted evidence",
  };
  sender = importTrack(sender, curriculum, undefined, now);
  sender = createContest(
    sender,
    "private-contest-id",
    "Private contest name",
    30,
    [sender.problems[0]],
    false,
    "manual",
    now,
  );
  sender = validateData({
    ...sender,
    settings: { ...sender.settings, displayName: "Private author name" },
    attempts: sender.attempts.map((attempt) => ({
      ...attempt,
      notes: "Private personal notes",
      takeaway: "Private reflection",
    })),
  });
  const original = structuredClone(sender);
  const output = sharedTrackFromTrack(sender, curriculum.id, {
    includeDescriptions: true,
    includeHints: true,
  });
  const encoded = encodeSharedTrack(output);
  assert.deepEqual(output, {
    ...file(),
    track: {
      ...file().track,
      stages: file().track.stages.map((stage) => ({
        ...stage,
        problems: stage.problems.map((problem) => ({
          ...problem,
          code: trackEntries(sender, curriculum.id).find(
            (entry) => entry.title === problem.title,
          )!.code,
          url: trackEntries(sender, curriculum.id).find(
            (entry) => entry.title === problem.title,
          )!.url,
        })),
      })),
    },
  });
  for (const privateText of [
    "private_handle",
    "private-local-file",
    "private track",
    "private stage",
    "private extracted",
    "Private author",
    "Private personal",
    "Private reflection",
    "Private contest",
    curriculum.id,
    curriculum.stages[0].id,
  ])
    assert.ok(!encoded.includes(privateText), privateText);
  for (const key of [
    "attempts",
    "contests",
    "codeforces",
    "settings",
    "notes",
    "source",
    "sourceNotes",
    "sourceName",
    "id",
    "problemId",
    "reviewAt",
    "cfHandle",
  ])
    assert.ok(!encoded.includes(`"${key}":`), key);
  assert.deepEqual(sender, original);
});

test("optional descriptions and hints require a choice, and an explicit empty share description clears only that text", () => {
  const { draft, data } = saved();
  const minimal = sharedTrackFromTrack(data, draft.id);
  assert.equal(minimal.track.shareDescription, undefined);
  assert.ok(
    minimal.track.stages.every((stage) => stage.description === undefined),
  );
  assert.ok(
    minimal.track.stages.every((stage) =>
      stage.problems.every((problem) => problem.hint === undefined),
    ),
  );
  const descriptions = sharedTrackFromTrack(data, draft.id, {
    includeDescriptions: true,
    shareDescription: "",
  });
  assert.equal(descriptions.track.shareDescription, undefined);
  assert.equal(
    descriptions.track.stages[0].description,
    "State the invariant.",
  );
  const supplied = sharedTrackFromTrack(data, draft.id, {
    shareDescription: "Chosen public attribution",
    includeHints: true,
  });
  assert.equal(supplied.track.shareDescription, "Chosen public attribution");
  assert.equal(supplied.track.stages[0].description, undefined);
  assert.equal(supplied.track.stages[0].problems[0].hint, "Parity");
});

test("the real hundred-problem five-stage document preserves ordered curriculum across a shared round trip", async () => {
  const original = await parsePracticeSheet(
    readFileSync(
      new URL("./fixtures/docx/two-pointers-100.docx", import.meta.url),
    ),
    "CF_100_Two_Pointers_Practice_Sheet.docx",
  );
  const sender = importTrack(emptyData(), original, undefined, now);
  const exported = sharedTrackFromTrack(sender, original.id, {
    includeDescriptions: true,
    includeHints: true,
  });
  const received = parseSharedTrack(encodeSharedTrack(exported));
  const recipient = importTrack(emptyData(), received, undefined, now);
  assert.equal(received.stages.length, 5);
  assert.deepEqual(
    received.stages.map((stage) => stage.entries.length),
    [20, 20, 20, 20, 20],
  );
  assert.deepEqual(
    received.stages.map((stage) => stage.title),
    original.stages.map((stage) => stage.title),
  );
  assert.deepEqual(
    received.stages.map((stage) => stage.suggestedTime),
    original.stages.map((stage) => stage.suggestedTime),
  );
  assert.deepEqual(
    sharedTrackFromTrack(recipient, received.id, {
      includeDescriptions: true,
      includeHints: true,
    }),
    exported,
  );
  const sourceIds = new Set([
    original.id,
    ...original.stages.flatMap((stage) => [
      stage.id,
      ...stage.entries.map((entry) => entry.id),
    ]),
  ]);
  for (const id of [
    received.id,
    ...received.stages.flatMap((stage) => [
      stage.id,
      ...stage.entries.map((entry) => entry.id),
    ]),
  ])
    assert.ok(!sourceIds.has(id));
  assert.equal(recipient.activeTrackId, null);
  assert.equal(recipient.session, null);
  assert.deepEqual(recipient.attempts, []);
});

test("aliases normalize while contest, Gym, split indices and repeated memberships keep their distinct identities and order", () => {
  const input = file();
  input.track.stages[0].problems[0].url =
    "http://www.codeforces.com/contest/0004/problem/a/?locale=en#statement";
  const draft = preview(input);
  const data = importTrack(emptyData(), draft, undefined, now);
  assert.deepEqual(
    trackEntries(data, draft.id).map((entry) => entry.code),
    ["4A", "4A1", "4A2", "100001A", "100001A", "4A"],
  );
  assert.equal(data.problems.length, 5);
  const entries = trackEntries(data, draft.id);
  assert.equal(entries[0].url, "https://codeforces.com/problemset/problem/4/A");
  assert.equal(entries[0].problemId, entries[5].problemId);
  assert.notEqual(entries[3].problemId, entries[4].problemId);
  assert.equal(entries[3].url, "https://codeforces.com/gym/100001/problem/A");
  assert.equal(sharedTrackPreview(data, draft).duplicateCount, 1);
});

test("imports reuse only personal and current-profile records while preserving recipient metadata and practice history", () => {
  let base = connectProfile(
    emptyData(),
    { handle: "old_handle", rating: null, rank: null },
    now,
  );
  base = connectProfile(
    base,
    { handle: "current_handle", rating: null, rank: null },
    now,
  );
  base = validateData({
    ...base,
    problems: [
      p("personal", "4A"),
      p("archived", "4A1", "old_handle"),
      p("current", "4A2", "current_handle"),
    ],
    attempts: [
      {
        id: "personal-reflection",
        problemId: "personal",
        startedAt: "2026-10-08T09:00:00.000Z",
        completedAt: "2026-10-08T09:05:00.000Z",
        elapsedMs: 300000,
        outcome: "independent",
        difficulty: null,
        notes: "My own private notes",
        takeaway: "My own learning",
      },
      {
        id: "archived-reflection",
        problemId: "archived",
        startedAt: "2026-10-08T09:00:00.000Z",
        completedAt: "2026-10-08T09:05:00.000Z",
        elapsedMs: 300000,
        outcome: "independent",
        difficulty: null,
        notes: "Archived profile notes",
        takeaway: "Archived learning",
      },
    ],
  });
  const before = structuredClone(base);
  const draft = preview();
  assert.deepEqual(sharedTrackPreview(base, draft).alreadyPresentIdentities, [
    "contest:4:A",
    "contest:4:A2",
  ]);
  assert.equal(sharedTrackPreview(base, draft).alreadyPresentCount, 3);
  const data = importTrack(base, draft, undefined, now);
  const entries = trackEntries(data, draft.id);
  assert.equal(entries[0].problemId, "personal");
  assert.equal(entries[2].problemId, "current");
  assert.notEqual(entries[1].problemId, "archived");
  assert.equal(trackEntryProgress(data, entries[0], now).independent, true);
  assert.equal(trackEntryProgress(data, entries[1], now).independent, false);
  assert.equal(entries[0].title, "Watermelon");
  assert.equal(entries[0].rating, 800);
  assert.deepEqual(data.problems.slice(0, 3), before.problems);
  assert.deepEqual(data.attempts, before.attempts);
  assert.deepEqual(data.codeforces, before.codeforces);
  assert.deepEqual(data.settings, before.settings);
});

test("duplicate detection uses current ordered curriculum, ignoring fresh IDs, aliases, JSON formatting and export time", () => {
  const { data, draft } = saved();
  const value = file();
  value.track.stages[0].problems[0].url =
    "https://codeforces.com/contest/4/problem/A";
  const reorderedKeys = {
    exportedAt: "2026-10-09T09:00:00.000Z",
    track: value.track,
    version: 1,
    format: "forma-track",
  };
  const same = parseSharedTrack(JSON.stringify(reorderedKeys, null, 8));
  assert.notEqual(same.id, draft.id);
  assert.equal(sharedTrackFingerprint(same), sharedTrackFingerprint(draft));
  assert.deepEqual(
    findDuplicateTracks(data, same).map((track) => track.id),
    [draft.id],
  );
  assert.throws(() => importTrack(data, same, undefined, now), /already/);
  const changed = structuredClone(same);
  changed.stages.reverse();
  assert.deepEqual(findEquivalentSharedTracks(data, changed), []);
  const edited = trackDraft(data, draft.id);
  edited.stages[0].entries[0].pattern = "Changed live curriculum hint";
  const updated = updateTrack(data, edited, now);
  assert.deepEqual(findEquivalentSharedTracks(updated, same), []);
  const corrected = structuredClone(same);
  corrected.stages[0].entries[0].pattern = "Changed live curriculum hint";
  assert.equal(findEquivalentSharedTracks(updated, corrected).length, 1);
});

test("a matching document track is detected despite unrelated source fingerprints, and deliberate copies share recipient history", () => {
  const documentDraft = preview();
  documentDraft.sourceFingerprint = "legacy-document-sha";
  documentDraft.sourceName = "my-original.docx";
  const data = importTrack(emptyData(), documentDraft, undefined, now);
  const same = preview();
  assert.equal(findDuplicateTracks(data, same)[0].id, documentDraft.id);
  const copy = copyTrackDraft(same);
  const copied = importTrack(data, copy, { duplicates: "copy" }, now);
  assert.equal(copied.tracks!.length, 2);
  assert.equal(copied.problems.length, data.problems.length);
  assert.equal(copied.activeTrackId, data.activeTrackId);
  assert.equal(importTrack(copied, copy, { duplicates: "copy" }, now), copied);
  assert.equal(
    trackEntries(copied, copy.id)[0].problemId,
    trackEntries(data, documentDraft.id)[0].problemId,
  );
  assert.ok(
    !documentDraft.stages.some((stage) =>
      copy.stages.some((candidate) => candidate.id === stage.id),
    ),
  );
});

test("unresolved and contradictory safe identities remain editable without altering the workspace before confirmation", () => {
  const value = file();
  value.track.stages[0].problems[0].code = "Unsupported label";
  value.track.stages[0].problems[1].url =
    "https://codeforces.com/problemset/problem/4/A2";
  const draft = preview(value);
  const base = emptyData();
  assert.equal(sharedTrackPreview(base, draft).unresolvedCount, 2);
  assert.throws(() => importTrack(base, draft), /unresolved/);
  assert.deepEqual(base, emptyData());
  const stableIds = [
    draft.id,
    draft.stages[0].id,
    draft.stages[0].entries[0].id,
  ];
  draft.stages[0].entries[0].code = "4A";
  draft.stages[0].entries[1].excluded = true;
  assert.equal(sharedTrackPreview(base, draft).unresolvedCount, 0);
  const corrected = importTrack(base, draft, undefined, now);
  assert.deepEqual(
    [draft.id, draft.stages[0].id, draft.stages[0].entries[0].id],
    stableIds,
  );
  assert.equal(corrected.trackEntries!.length, 5);
  assert.equal(corrected.activeTrackId, null);
});

test("private backups, unrelated formats, future versions and unknown private fields have clear errors", () => {
  for (const value of [
    emptyData(),
    { format: "forma-backup", data: emptyData() },
  ])
    assert.throws(
      () => parseSharedTrack(JSON.stringify(value)),
      /private workspace backup.*Settings/,
    );
  assert.throws(() => parseSharedTrack("[]"), /valid Forma/);
  assert.throws(() => parseSharedTrack("{"), /valid Forma/);
  assert.throws(
    () => parseSharedTrack(JSON.stringify({ ...file(), format: "other" })),
    /not a Forma shared track/,
  );
  assert.throws(
    () => parseSharedTrack(JSON.stringify({ ...file(), version: 2 })),
    /version is not supported/,
  );
  assert.throws(
    () =>
      parseSharedTrack(
        JSON.stringify({ ...file(), notes: "Sender's private notes" }),
      ),
    /only curriculum/,
  );
  const entry = file();
  Object.assign(entry.track.stages[0].problems[0], { accepted: true });
  assert.throws(() => preview(entry), /only curriculum/);
});

test("unsafe URLs cannot enter a preview, while unsupported safe Codeforces identities require correction", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://example.com/contest/4/problem/A",
    "https://codeforces.com.evil.test/contest/4/problem/A",
    "https://user:password@codeforces.com/contest/4/problem/A",
    "https://codeforces.com:8443/contest/4/problem/A",
    "https://codeforces.com/api/user.info?handles=someone",
  ]) {
    const value = file();
    value.track.stages[0].problems[0].url = url;
    assert.throws(() => preview(value), /safe Codeforces problem URL/);
  }
  const value = file();
  value.track.stages[0].problems[0].url =
    "https://codeforces.com/contest/4/problem/unsupported-index";
  assert.equal(
    sharedTrackPreview(emptyData(), preview(value)).unresolvedCount,
    1,
  );
});

test("field types, required titles and all portable limits are enforced before IDs or workspace records are created", () => {
  const invalid: unknown[] = [];
  for (const field of ["title", "shareDescription", "stages"] as const) {
    const value = structuredClone(file());
    Object.assign(value.track, { [field]: 42 });
    invalid.push(value);
  }
  const missingTitle = file();
  missingTitle.track.stages[0].problems[0].title = "  ";
  invalid.push(missingTitle);
  const longTitle = file();
  longTitle.track.title = "t".repeat(241);
  invalid.push(longTitle);
  const longDescription = file();
  longDescription.track.shareDescription = "d".repeat(5001);
  invalid.push(longDescription);
  const longStageDescription = file();
  longStageDescription.track.stages[0].description = "d".repeat(5001);
  invalid.push(longStageDescription);
  const longTime = file();
  longTime.track.stages[0].suggestedTime = "t".repeat(241);
  invalid.push(longTime);
  const longHint = file();
  longHint.track.stages[0].problems[0].hint = "h".repeat(2001);
  invalid.push(longHint);
  const longCode = file();
  longCode.track.stages[0].problems[0].code = "4".repeat(61);
  invalid.push(longCode);
  const longURL = file();
  longURL.track.stages[0].problems[0].url =
    "https://codeforces.com/contest/4/problem/A?" + "x".repeat(2000);
  invalid.push(longURL);
  for (const rating of [-1, 10001, 1.5, "800", false]) {
    const value = file();
    Object.assign(value.track.stages[0].problems[0], { rating });
    invalid.push(value);
  }
  for (const value of invalid)
    assert.throws(() => parseSharedTrack(JSON.stringify(value)));
  const tooManyStages = file();
  tooManyStages.track.stages = Array.from({ length: 101 }, () =>
    structuredClone(file().track.stages[1]),
  );
  assert.throws(() => preview(tooManyStages), /100 ordered stages/);
  const tooManyProblems = file();
  tooManyProblems.track.stages = [
    {
      ...tooManyProblems.track.stages[0],
      problems: Array.from({ length: 1001 }, () => ({
        ...file().track.stages[0].problems[0],
      })),
    },
  ];
  assert.throws(() => preview(tooManyProblems), /1,000 problem/);
  assert.throws(
    () => parseSharedTrack(" ".repeat(SHARED_TRACK_LIMITS.maxFileBytes + 1)),
    /5 MB/,
  );
  const oversizedEncoding = file();
  oversizedEncoding.track.stages = Array.from({ length: 100 }, () => ({
    title: "🧩".repeat(120),
    description: "🧩".repeat(2500),
    suggestedTime: "",
    problems: Array.from({ length: 10 }, () => ({
      title: "🧩".repeat(120),
      code: "4A",
      url: "",
      rating: null,
      hint: "🧩".repeat(1000),
    })),
  }));
  assert.throws(() => encodeSharedTrack(oversizedEncoding), /5 MB/);
});

test("file reads enforce byte limits and abort pending work without allocating preview IDs or fetching destinations", async (t) => {
  const ids = t.mock.method(crypto, "randomUUID");
  const fetches = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network fetch");
  });
  let reads = 0;
  const oversized = {
    size: SHARED_TRACK_LIMITS.maxFileBytes + 1,
    text: async () => {
      reads++;
      return "";
    },
  } as unknown as File;
  await assert.rejects(readSharedTrackFile(oversized), /5 MB/);
  assert.equal(reads, 0);
  const controller = new AbortController();
  let release!: (value: string) => void;
  const pending = {
    size: 100,
    text: () => {
      reads++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
  } as unknown as File;
  const reading = readSharedTrackFile(pending, { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  release(encodeSharedTrack(file()));
  await assert.rejects(
    readSharedTrackFile(pending, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(reads, 1);
  const broken = {
    size: 1,
    text: async () => {
      throw new Error("Underlying OS error");
    },
  } as unknown as File;
  await assert.rejects(readSharedTrackFile(broken), /could not be read/);
  assert.equal(ids.mock.callCount(), 0);
  const actual = await readSharedTrackFile(
    new File([encodeSharedTrack(file())], "practice.forma-track.json"),
  );
  assert.equal(actual.title, "Boundary practice");
  assert.equal(ids.mock.callCount(), 9);
  assert.equal(fetches.mock.callCount(), 0);
});

test("preview duplicate lookup indexes saved records once and invalidates when a saved curriculum is edited", () => {
  const original = preview();
  let data = importTrack(emptyData(), original, undefined, now);
  for (let count = 0; count < 12; count++)
    data = importTrack(
      data,
      copyTrackDraft(original),
      { duplicates: "copy" },
      now,
    );
  let recordReads = 0;
  const observed = { ...data };
  Object.defineProperty(observed, "trackEntries", {
    get: () => {
      recordReads++;
      return data.trackEntries;
    },
  });
  assert.equal(findEquivalentSharedTracks(observed, original).length, 13);
  const initialReads = recordReads;
  assert.equal(
    initialReads,
    1,
    "All saved tracks share a single flat record index.",
  );
  const editing = structuredClone(original);
  editing.title = "An incomplete changed preview";
  findEquivalentSharedTracks(observed, editing);
  findEquivalentSharedTracks(observed, original);
  assert.equal(
    recordReads,
    initialReads,
    "Preview typing reuses immutable saved curriculum, rather than rehashing every record.",
  );
  const savedEdit = trackDraft(data, original.id);
  savedEdit.stages[0].entries.reverse();
  const updated = updateTrack(data, savedEdit, now);
  assert.equal(findEquivalentSharedTracks(updated, original).length, 12);
  assert.deepEqual(
    findEquivalentSharedTracks(updated, savedEdit).map((track) => track.id),
    [original.id],
  );
});

test("optional shared metadata validates without changing old workspaces, and imported markup stays inert text", () => {
  const { draft, data } = saved();
  const older = structuredClone(data);
  delete older.tracks![0].shareDescription;
  assert.equal(validateData(older).tracks![0].shareDescription, undefined);
  assert.equal(
    validateData(data).tracks![0].shareDescription,
    "A public curriculum description",
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        tracks: data.tracks!.map((track) => ({
          ...track,
          shareDescription: "x".repeat(5001),
        })),
      }),
    /Track records/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        tracks: data.tracks!.map((track) => ({
          ...track,
          shareDescription: 42,
        })),
      }),
    /Track records/,
  );
  const markup = file();
  markup.track.stages[0].description = '<script>alert("curriculum")</script>';
  assert.equal(
    preview(markup).stages[0].description,
    markup.track.stages[0].description,
  );
  assert.equal(
    sharedTrackFilename(" ../../ Very long / title 😀 "),
    "very-long-title.forma-track.json",
  );
  assert.equal(sharedTrackFilename("🧩"), "forma-track.forma-track.json");
  assert.equal(draft.sourceName, "Shared track file");
});
