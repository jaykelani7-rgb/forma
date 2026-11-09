import assert from "node:assert/strict";
import test from "node:test";
import { finishPracticeReflection } from "../packages/core/src/companion";
import { mergeWorkspaces } from "../src/lib/concurrency";
import { catalogueProblemToSaved, type CatalogueProblem } from "../src/lib/discovery";
import { learningHistory } from "../src/lib/learning";
import { emptyData, validateData, type Attempt, type Data, type Problem } from "../src/lib/model";
import { selectTakeawayPractice, withTakeawayPractice } from "../src/lib/takeaway-practice";

const now = Date.parse("2026-11-09T08:00:00Z");
const stamp = new Date(now - 60000).toISOString();
const takeaway = "State what each entry means before writing the transition.";
const sourceId = "timed:original-attempt";

function catalogueRow(number: number, rating: number, tags = ["dp"]): CatalogueProblem {
  return {
    key: `contest:${number}:A`,
    title: `Catalogue problem ${number}`,
    code: `${number}A`,
    url: `https://codeforces.com/problemset/problem/${number}/A`,
    rating,
    tags,
  };
}

function save(row: CatalogueProblem, id = row.code): Problem {
  return catalogueProblemToSaved(row, id, new Date(stamp));
}

function attempt(problemId: string, id: string, text = ""): Attempt {
  return {
    id, problemId, startedAt: stamp, completedAt: stamp, elapsedMs: 0,
    outcome: "unsolved", difficulty: null, notes: "", takeaway: text,
  };
}

function setup(): Data {
  const source = save(catalogueRow(100, 1400, ["implementation", "Dynamic programming"]), "source");
  return {
    ...emptyData(),
    problems: [source],
    attempts: [attempt(source.id, "original-attempt", takeaway)],
  };
}

function catalogue(...problems: CatalogueProblem[]) {
  return { problems, fetchedAt: stamp, stale: false };
}

test("suggests one near-rated shared topic and excludes canonical evidence even for unsuccessful practice", () => {
  const data = setup();
  const attempted = save(catalogueRow(101, 1400), "earlier-timed");
  attempted.url = "https://codeforces.com/contest/101/problem/A?locale=en";
  const submitted = save(catalogueRow(102, 1400), "earlier-submission");
  const recalled = save(catalogueRow(103, 1400), "earlier-recall");
  const archived = { ...save(catalogueRow(104, 1400)), archived: true };
  const withoutLink = { ...save(catalogueRow(105, 1400)), url: "" };
  data.problems.push(attempted, submitted, recalled, archived, withoutLink);
  data.attempts.push(attempt(attempted.id, "earlier-timed-attempt"));
  data.codeforces.submissions.push({
    id: 1, handle: "other_recorded_profile", problemId: submitted.id,
    submittedAt: stamp, verdict: "WRONG_ANSWER", language: "C++",
  });
  data.revisions = [{
    id: "recall", problemId: recalled.id, handle: null, activity: "explain",
    outcome: "unrecalled", response: "", cue: "", completedAt: stamp, nextReviewAt: null,
  }];
  const answer = catalogueRow(106, 1500, ["implementation", "dp"]);
  const suggestion = selectTakeawayPractice(data, sourceId, catalogue(
    catalogueRow(100, 1400), catalogueRow(101, 1400), catalogueRow(102, 1400),
    catalogueRow(103, 1400), catalogueRow(104, 1400), catalogueRow(105, 1400),
    catalogueRow(107, 1700), catalogueRow(108, 1400, ["graphs"]),
    catalogueRow(109, 1500), answer,
  ));
  assert.equal(suggestion?.problem.key, answer.key);
  assert.equal(suggestion?.context.topic, "dynamic programming");
  assert.equal(suggestion?.context.takeaway, takeaway);
  assert.equal(selectTakeawayPractice(data, sourceId, null), null);
});

test("the catalogue can complete missing source metadata and a saved candidate is reused", () => {
  const data = setup();
  data.problems[0].rating = null;
  data.problems[0].tags = [];
  const saved = save(catalogueRow(111, 1400), "saved-untried");
  data.problems.push(saved);
  const suggestion = selectTakeawayPractice(data, sourceId, catalogue(
    catalogueRow(100, 1400), catalogueRow(110, 1400),
  ));
  assert.ok(suggestion);
  assert.equal(suggestion.savedProblemId, saved.id);
  const started = withTakeawayPractice(data, suggestion, now, "transfer", "unused");
  assert.equal(started.session?.problemId, saved.id);
  assert.equal(started.problems.length, 2);
  assert.equal(started.session?.targetMinutes, data.settings.defaultDuration);
});

test("fresh problem and session are linked, and the original takeaway survives reload and reflection", () => {
  const data = setup();
  const suggestion = selectTakeawayPractice(data, sourceId, catalogue(catalogueRow(121, 1400)));
  assert.ok(suggestion);
  const started = withTakeawayPractice(data, suggestion, now, "new-session", "new-problem");
  const reopened = validateData(JSON.parse(JSON.stringify(started)));
  assert.equal(reopened.session?.problemId, "new-problem");
  assert.equal(reopened.problems.find((problem) => problem.id === "new-problem")?.title, suggestion.problem.title);
  assert.deepEqual(reopened.session?.takeawayPractice, suggestion.context);
  assert.throws(() => validateData({ ...reopened, session: {
    ...reopened.session, takeawayPractice: { ...suggestion.context, topic: " " },
  } }), /connection is invalid/);
  reopened.attempts[0].takeaway = "Edited after the new session started.";
  const finished = finishPracticeReflection(reopened, "new-session", { outcome: "independent" }, now + 30000);
  assert.equal(finished.session, null);
  assert.deepEqual(finished.attempts.at(-1)?.takeawayPractice, suggestion.context);
  assert.deepEqual(learningHistory(finished).find((record) => record.id === "timed:new-session")?.takeawayPractice, suggestion.context);
});

test("starting revalidates the offered match against active sessions, attempts and edited source text", () => {
  const data = setup();
  const saved = save(catalogueRow(131, 1400));
  data.problems.push(saved);
  const suggestion = selectTakeawayPractice(data, sourceId, null);
  assert.ok(suggestion);
  const started = withTakeawayPractice(data, suggestion, now, "session", "unused");
  assert.throws(() => withTakeawayPractice(started, suggestion, now, "other", "unused"), /already open/);
  const stale = { ...data, attempts: [...data.attempts, attempt(saved.id, "new-attempt")] };
  assert.throws(() => withTakeawayPractice(stale, suggestion, now, "other", "unused"), /match has changed/);
  const edited = { ...data, attempts: [{ ...data.attempts[0], takeaway: "Changed." }] };
  assert.throws(() => withTakeawayPractice(edited, suggestion, now, "other", "unused"), /match has changed/);
  assert.equal(selectTakeawayPractice(edited, "missing", null), null);
});

test("concurrent history or source edits conflict with a new start and preserve already started sessions", () => {
  const base = setup();
  const saved = save(catalogueRow(141, 1400));
  base.problems.push(saved);
  const suggestion = selectTakeawayPractice(base, sourceId, null);
  assert.ok(suggestion);
  const started = withTakeawayPractice(base, suggestion, now, "new-session", "unused");
  const remote = { ...base, attempts: [...base.attempts, attempt(saved.id, "new-evidence")] };
  const conflict = mergeWorkspaces(base, started, remote);
  assert.deepEqual(conflict.conflicts, ["workspace.session.takeawayPractice"]);
  assert.equal(conflict.data.session, null);
  const sourceEdit = { ...base, attempts: [{ ...base.attempts[0], takeaway: "Edited." }] };
  assert.deepEqual(mergeWorkspaces(base, started, sourceEdit).conflicts, ["workspace.session.takeawayPractice"]);
  assert.deepEqual(mergeWorkspaces(base, started, base).conflicts, []);

  const paused = { ...started, session: { ...started.session!, runningSince: null } };
  const remoteWithEvidence = { ...started, attempts: remote.attempts };
  const merged = mergeWorkspaces(started, paused, remoteWithEvidence);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.data.session?.runningSince, null);
  assert.deepEqual(merged.data.session?.takeawayPractice, suggestion.context);
});
