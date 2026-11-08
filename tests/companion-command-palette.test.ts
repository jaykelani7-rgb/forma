import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandPaletteIndex,
  getCommandPaletteRecord,
  matchesPaletteQuery,
  searchCommandPalette,
} from "../apps/desktop/renderer/command-palette-search";
import { initialCompanionState } from "../packages/core/src/companion";
import { emptyData, type Problem } from "../src/lib/model";

const first = "2026-11-07T12:00:00.000Z";
const second = "2026-11-08T12:00:00.000Z";
const latest = "2026-11-09T12:00:00.000Z";

function problem(id: string, title: string, code: number, scope?: string, gym = false): Problem {
  return {
    id, title, platform: "Codeforces", url: `https://codeforces.com/${gym ? "gym" : "contest"}/${code}/problem/A`,
    problemCode: `${code}A`, tags: [], rating: null, createdAt: first, reviewAt: null, reviewCount: 0, cfHandle: scope,
  };
}

test("the palette finds exact threads and reflections in the active profile, including saved imports", () => {
  const data = emptyData();
  data.problems = [problem("binary", "Binary Search", 189), problem("active", "Watermelon", 4, "current"), problem("other", "Secret problem", 16, "archived")];
  data.attempts = [
    { id: "with-hint", problemId: "binary", startedAt: first, completedAt: second, elapsedMs: 100,
      outcome: "hint", difficulty: "approach", takeaway: "Tighten the upper bound", approach: "Maintain a feasible endpoint", notes: "Check parity." },
    { id: "alone", problemId: "binary", startedAt: second, completedAt: latest, elapsedMs: 100,
      outcome: "independent", difficulty: null, takeaway: "I needed a hint last time", notes: "This attempt was independent." },
  ];
  data.codeforces.practiceAttempts = [
    { id: "saved-import", problemId: "active", handle: "current", submissionIds: [1], firstSubmittedAt: first, lastSubmittedAt: second,
      inbox: false, skipped: false, wasRevisit: false },
    { id: "unreflected-import", problemId: "active", handle: "current", submissionIds: [2], firstSubmittedAt: second, lastSubmittedAt: latest,
      inbox: false, skipped: false, wasRevisit: false },
  ];
  data.codeforces.reflections = [{ attemptId: "saved-import", outcome: "hint", difficulty: null, takeaway: "Exclude the smallest weight", savedAt: latest }];
  const state = {
    ...initialCompanionState(), handle: "Current",
    thoughts: [{ id: "own", problemId: "binary", text: "A note with an edge case", createdAt: second },
      { id: "hidden", problemId: "other", text: "Secret note", createdAt: latest }],
    desk: [{ id: "exact-thread", problemId: "binary", kind: "thread" as const, text: "Try the lower bound\nwith duplicates", createdAt: latest }],
  };
  const index = buildCommandPaletteIndex({ data, state });
  const [thread] = searchCommandPalette(index, "find my binary-search notes");
  assert.equal(thread.id, "thread:exact-thread");
  assert.equal(getCommandPaletteRecord(index, thread.id)?.sections[0].text, "Try the lower bound\nwith duplicates");
  const hints = searchCommandPalette(index, "show attempts where I needed a hint");
  assert.deepEqual(hints.map(result => result.id), ["reflection:codeforces:current:saved-import", "reflection:timed:with-hint"]);
  const reflection = getCommandPaletteRecord(index, hints[1].id);
  assert.equal(reflection?.date, second);
  assert.ok(reflection?.sections.some(section => section.label === "Approach" && section.text === "Maintain a feasible endpoint"));
  assert.equal(searchCommandPalette(index, "secret").length, 0);
  assert.equal(searchCommandPalette(index, "watermelon").filter(result => result.kind === "reflection").length, 1);
});

test("the palette ranks title and Codeforces matches, bounds results, and prefers recent records on an empty query", () => {
  const data = emptyData();
  data.problems = [problem("contest", "Café Queue", 4), problem("gym", "Gym Queue", 4, undefined, true), problem("unrelated", "Other Queue", 49)];
  const state = { ...initialCompanionState(), thoughts: Array.from({ length: 12 }, (_, i) => ({
    id: `note-${String(i).padStart(2, "0")}`, problemId: "contest", text: `Queue note ${i}`, createdAt: i === 11 ? latest : second,
  })) };
  const index = buildCommandPaletteIndex({ data, state });
  assert.equal(searchCommandPalette(index, "cafe queue")[0].id, "problem:contest");
  assert.equal(searchCommandPalette(index, "4 a")[0].id, "problem:contest");
  assert.deepEqual(searchCommandPalette(index, "gym 4a").map(result => result.id), ["problem:gym"]);
  assert.equal(searchCommandPalette(index, "")[0].id, "thought:note-11");
  assert.equal(searchCommandPalette(index, "queue").length, 8);
  assert.equal(matchesPaletteQuery("Open the current Problem Desk", "show me the problem desk"), true);
});
