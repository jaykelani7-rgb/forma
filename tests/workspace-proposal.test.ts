import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/lib/model";
import { importTrack, trackDraft, updateTrack } from "../src/lib/tracks";
import {
  assertSafeProblemEdit,
  validateWorkspaceProposal,
  WorkspaceValidationError,
} from "../src/lib/workspace-proposal";
import { encodeBackup, decodeBackup } from "../src/lib/concurrency";
const data = importTrack(emptyData(), {
  id: "track",
  title: "Track",
  sourceName: "sheet",
  sourceFingerprint: "sheet",
  stages: [
    {
      id: "stage",
      title: "Stage",
      description: "",
      suggestedTime: "",
      entries: [
        {
          id: "entry",
          title: "381A",
          code: "381A",
          url: "",
          rating: null,
          pattern: "",
        },
      ],
    },
  ],
});
test("reject an invalid relationship before optimistic exposure, preserve original export and later valid save", () => {
  const original = data.problems[0];
  const changed = {
    ...original,
    problemCode: "189A",
    url: "https://codeforces.com/problemset/problem/189/A",
  };
  assert.throws(
    () => assertSafeProblemEdit(data, original, changed),
    WorkspaceValidationError,
  );
  assert.throws(
    () => validateWorkspaceProposal({ ...data, problems: [changed] }),
    WorkspaceValidationError,
  );
  assert.equal(data.trackEntries![0].problemId, original.id);
  const valid = validateWorkspaceProposal({
    ...data,
    problems: [{ ...original, title: "Better title", rating: 1100 }],
  });
  const backup = decodeBackup(encodeBackup(valid));
  assert.equal(backup.problems[0].title, "Better title");
  assert.equal(backup.trackEntries![0].code, "381A");
});
test("history identity is locked while metadata edits and canonical URL variants remain safe", () => {
  const original = data.problems[0];
  const personal = {
    ...data,
    activeTrackId: null,
    tracks: [],
    trackStages: [],
    trackEntries: [],
    attempts: [
      {
        id: "attempt",
        problemId: original.id,
        startedAt: "2026-10-01T10:00:00Z",
        completedAt: "2026-10-01T10:10:00Z",
        elapsedMs: 600000,
        outcome: "hint" as const,
        difficulty: null,
        takeaway: "",
        notes: "Original notes",
      },
    ],
  };
  assert.throws(
    () =>
      assertSafeProblemEdit(personal, original, {
        ...original,
        problemCode: "189A",
      }),
    /original Codeforces ID/,
  );
  assert.throws(
    () =>
      assertSafeProblemEdit(personal, original, {
        ...original,
        platform: "Other",
      }),
    /recorded practice/,
  );
  assert.doesNotThrow(() =>
    assertSafeProblemEdit(personal, original, {
      ...original,
      title: "Readable title",
      rating: 900,
      url: "https://codeforces.com/contest/381/problem/A",
    }),
  );
  assert.equal(
    decodeBackup(encodeBackup(personal)).attempts[0].notes,
    "Original notes",
  );
});
test("track editor can replace membership while retaining original problem history", () => {
  const draft = trackDraft(data, "track");
  draft.stages[0].entries[0].code = "189A";
  draft.stages[0].entries[0].url = "";
  const changed = updateTrack(data, draft);
  assert.notEqual(changed.trackEntries![0].problemId, data.problems[0].id);
  assert.ok(changed.problems.some((p) => p.id === data.problems[0].id));
  assert.doesNotThrow(() => validateWorkspaceProposal(changed));
});
