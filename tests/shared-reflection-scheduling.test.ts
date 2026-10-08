import test from "node:test";
import assert from "node:assert/strict";
import {
  connectProfile,
  mergeActivity,
  relevantSchedule,
  saveQuickReflection,
} from "../src/lib/codeforces";
import {
  completeRevisit,
  emptyData,
  rescheduleProblem,
  validateData,
  type Data,
  type Problem,
} from "../src/lib/model";
import { sharedPracticeState } from "../src/lib/practice-state";
import { linkLearningAttempts } from "../src/lib/learning";

const importedAt = new Date("2026-10-07T08:00:00Z");
const manualAt = new Date("2026-10-08T08:00:00Z");
const editedAt = new Date("2026-10-09T08:00:00Z");

function sharedCopies(): Data {
  let data = mergeActivity(
    connectProfile(
      emptyData(),
      { handle: "memory_fixture", rating: null, rank: null },
      importedAt,
    ),
    "memory_fixture",
    [
      {
        handle: "memory_fixture",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 101,
            submittedAt: importedAt.toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              code: "381A",
              title: "Sereja and Dima",
              url: "https://codeforces.com/problemset/problem/381/A",
              rating: 800,
              tags: [],
            },
          },
        ],
      },
    ],
    "refresh",
    importedAt,
  );
  const imported = data.problems[0];
  const personal: Problem = {
    id: "personal-381A",
    title: imported.title,
    platform: imported.platform,
    url: imported.url,
    problemCode: imported.problemCode,
    tags: [],
    rating: imported.rating,
    createdAt: "2026-10-06T08:00:00.000Z",
    reviewAt: null,
    reviewCount: 0,
  };
  data = { ...data, problems: [...data.problems, personal] };
  return saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Keep the remaining interval explicit.",
      reviewAt: "2026-10-12",
      overrideSchedule: false,
    },
    importedAt,
  );
}

function edit(data: Data, overrideSchedule = false) {
  return saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "editorial",
      difficulty: null,
      takeaway: "Edited reflection without replacing deliberate scheduling.",
      reviewAt: "2026-10-16",
      overrideSchedule,
    },
    editedAt,
  );
}

test("an imported reflection edit preserves a later matching personal manual date and only a deliberate override supersedes it", () => {
  const data = rescheduleProblem(
    sharedCopies(),
    "personal-381A",
    "2026-10-20",
    manualAt,
  );
  const originalImported = data.problems.find((problem) => problem.cfHandle)!;
  const preserved = edit(data);
  assert.equal(preserved.codeforces.reflections[0].outcome, "editorial");
  assert.deepEqual(preserved.problems, data.problems);
  assert.equal(
    sharedPracticeState(preserved, originalImported, editedAt).codingAt,
    "2026-10-20",
  );
  assert.equal(
    preserved.problems.find((problem) => problem.cfHandle)?.reviewUpdatedAt,
    importedAt.toISOString(),
  );
  const overridden = edit(preserved, true);
  assert.equal(
    sharedPracticeState(overridden, originalImported, editedAt).codingAt,
    "2026-10-16",
  );
  assert.equal(
    overridden.problems.find((problem) => problem.cfHandle)?.reviewUpdatedAt,
    editedAt.toISOString(),
  );
  assert.deepEqual(
    overridden.problems.find((problem) => problem.id === "personal-381A"),
    data.problems.find((problem) => problem.id === "personal-381A"),
  );
  assert.deepEqual(
    overridden.codeforces.submissions,
    data.codeforces.submissions,
  );
  assert.deepEqual(validateData(overridden), overridden);
});

test("a completed matching personal coding revisit cannot be revived by editing earlier imported reflection without override", () => {
  const data = completeRevisit(sharedCopies(), "personal-381A", manualAt);
  const imported = data.problems.find((problem) => problem.cfHandle)!;
  const preserved = edit(data);
  assert.equal(
    sharedPracticeState(preserved, imported, editedAt).codingAt,
    null,
  );
  assert.deepEqual(preserved.problems, data.problems);
  const overridden = edit(preserved, true);
  assert.equal(
    sharedPracticeState(overridden, imported, editedAt).codingAt,
    "2026-10-16",
  );
  assert.equal(
    overridden.problems.find((problem) => problem.id === "personal-381A")
      ?.reviewCompletedAt,
    manualAt.toISOString(),
  );
  assert.deepEqual(
    overridden.codeforces.submissions,
    data.codeforces.submissions,
  );
});

test("a newer timed attempt on a matching personal copy owns scheduling unless it is explicitly linked to the imported event", () => {
  let data = sharedCopies();
  const imported = data.codeforces.practiceAttempts[0];
  data = {
    ...data,
    attempts: [
      {
        id: "newer-timed",
        problemId: "personal-381A",
        startedAt: manualAt.toISOString(),
        completedAt: manualAt.toISOString(),
        elapsedMs: 60_000,
        outcome: "hint",
        difficulty: null,
        takeaway: "",
        notes: "",
      },
    ],
  };
  assert.equal(relevantSchedule(data, imported), false);
  assert.deepEqual(edit(data, true).problems, data.problems);
  const linked: Data = {
    ...data,
    learningLinks: [
      {
        timedAttemptId: "newer-timed",
        importedAttemptId: imported.id,
        handle: imported.handle,
        linkedAt: editedAt.toISOString(),
        reflectionSource: "codeforces",
      },
    ],
  };
  assert.equal(relevantSchedule(linked, imported), true);
  assert.equal(
    sharedPracticeState(edit(linked, true), data.problems[0], editedAt)
      .codingAt,
    "2026-10-16",
  );
});

test("a matching decision from another Codeforces handle does not constrain the imported source being reflected", () => {
  let data = sharedCopies();
  data = connectProfile(
    data,
    { handle: "other_fixture", rating: null, rank: null },
    manualAt,
  );
  const other: Problem = {
    ...data.problems.find((problem) => problem.cfHandle)!,
    id: "other-381A",
    cfHandle: "other_fixture",
    reviewAt: "2026-10-30",
    reviewManual: true,
    reviewUpdatedAt: manualAt.toISOString(),
    reviewAttemptId: undefined,
  };
  data = { ...data, problems: [...data.problems, other] };
  const saved = edit(data);
  assert.equal(
    sharedPracticeState(saved, saved.problems[0], editedAt, {
      handle: "memory_fixture",
    }).codingAt,
    "2026-10-16",
  );
  assert.equal(
    sharedPracticeState(saved, other, editedAt).codingAt,
    "2026-10-30",
  );
  assert.deepEqual(
    saved.problems.find((problem) => problem.id === other.id),
    other,
  );
});
test("a newer personal event explicitly linked to a different profile cannot block the source profile's scheduling", () => {
  let data = sharedCopies();
  const original = data.codeforces.practiceAttempts[0];
  data = mergeActivity(
    connectProfile(
      data,
      { handle: "other_fixture", rating: null, rank: null },
      manualAt,
    ),
    "other_fixture",
    [
      {
        handle: "other_fixture",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 102,
            submittedAt: manualAt.toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              code: "381A",
              title: "Sereja and Dima",
              url: "https://codeforces.com/problemset/problem/381/A",
              rating: 800,
              tags: [],
            },
          },
        ],
      },
    ],
    "refresh",
    manualAt,
  );
  data = {
    ...data,
    attempts: [
      {
        id: "linked-other",
        problemId: "personal-381A",
        startedAt: manualAt.toISOString(),
        completedAt: manualAt.toISOString(),
        elapsedMs: 60000,
        outcome: "hint",
        difficulty: null,
        takeaway: "",
        notes: "",
      },
    ],
  };
  const other = data.codeforces.practiceAttempts.find(
    (a) => a.handle === "other_fixture",
  )!;
  data = linkLearningAttempts(
    data,
    "linked-other",
    other.id,
    "timed",
    manualAt,
  );
  assert.equal(relevantSchedule(data, original), true);
  const saved = saveQuickReflection(
    data,
    original.id,
    {
      outcome: "editorial",
      difficulty: null,
      takeaway: "Original profile evidence",
      reviewAt: "2026-10-16",
      overrideSchedule: true,
    },
    editedAt,
  );
  assert.equal(
    sharedPracticeState(saved, saved.problems[0], editedAt, {
      handle: "memory_fixture",
    }).codingAt,
    "2026-10-16",
  );
  assert.doesNotThrow(() => validateData(saved));
});
