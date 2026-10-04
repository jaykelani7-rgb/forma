import test from "node:test";
import assert from "node:assert/strict";
import {
  Data,
  Problem,
  Session,
  archiveProblem,
  automaticPracticeEligible,
  breakthroughs,
  clockTime,
  completeRevisit,
  createDemo,
  deferProblem,
  elapsed,
  emptyData,
  localDate,
  nextReview,
  rescheduleProblem,
  safeUrl,
  skipRecommendation,
  suggestion,
  validateData,
  weekActivity,
} from "../src/lib/model";
import { loadPersonal } from "../src/lib/storage";

const now = new Date("2026-10-04T12:00:00");
const problem: Problem = {
  id: "one",
  title: "An idea",
  platform: "Manual",
  url: "",
  problemCode: "",
  tags: ["Arrays"],
  rating: null,
  createdAt: now.toISOString(),
  reviewAt: null,
  reviewCount: 0,
};
const fixture = (): Data => ({ ...emptyData(), problems: [{ ...problem }] });

test("timestamps account for background time and preserve pauses across serialization", () => {
  const session: Session = {
    id: "session",
    problemId: problem.id,
    startedAt: now.toISOString(),
    runningSince: now.getTime(),
    elapsedMs: 5000,
    targetMinutes: 30,
    notes: "Boundary case",
    timerVisible: true,
    phase: "focus",
  };
  assert.equal(elapsed(session, now.getTime() + 120000), 125000);
  const recovered = validateData({ ...fixture(), session }).session!;
  assert.equal(elapsed(recovered, now.getTime() + 180000), 185000);
  const paused = { ...recovered, runningSince: null, elapsedMs: 185000 };
  assert.equal(elapsed(paused, now.getTime() + 360000), 185000);
  assert.equal(clockTime(3661000), "01:01:01");
  assert.equal(elapsed(session, now.getTime() - 1000), 5000);
});
test("review rule schedules assistance and expands successful revisits", () => {
  assert.equal(nextReview(problem, "independent", now).reviewAt, null);
  assert.equal(nextReview(problem, "hint", now).reviewAt, "2026-10-09");
  assert.equal(nextReview(problem, "editorial", now).reviewAt, "2026-10-07");
  assert.equal(nextReview(problem, "unsolved", now).reviewAt, "2026-10-05");
  const reviewing = { ...problem, reviewAt: localDate(now) };
  const first = nextReview(reviewing, "independent", now);
  assert.deepEqual(first, { reviewAt: "2026-10-11", reviewCount: 1 });
  assert.equal(
    nextReview({ ...reviewing, ...first }, "independent", now).reviewAt,
    "2026-10-18",
  );
  assert.equal(
    nextReview({ ...reviewing, reviewCount: 9 }, "independent", now).reviewAt,
    "2026-11-03",
  );
  assert.equal(
    nextReview({ ...reviewing, reviewCount: 3 }, "hint", now).reviewCount,
    0,
  );
  assert.equal(
    nextReview({ ...problem, reviewCount: 3 }, "independent", now).reviewAt,
    null,
  );
});
test("focus preference uses supported topics and explains insufficient data", () => {
  const data = fixture();
  data.problems.push({
    ...problem,
    id: "cp",
    title: "Greedy idea",
    tags: ["Greedy"],
  });
  data.settings.focus = "cp";
  assert.equal(suggestion(data, now)?.problem.id, "cp");
  assert.equal(suggestion(data, now)?.focusFallback, false);
  data.problems = data.problems.slice(0, 1);
  assert.equal(suggestion(data, now)?.focusFallback, true);
  assert.equal(suggestion(emptyData(), now), null);
});
test("ready revisits come before new problems without penalizing missed dates", () => {
  const data = fixture();
  data.problems.push({ ...problem, id: "review", reviewAt: "2026-09-25" });
  assert.equal(suggestion(data, now)?.problem.id, "review");
});
test("automatic suggestions respect future dates, deliberate deferrals, skips and archives", () => {
  const data = fixture();
  data.problems[0].reviewAt = "2026-11-04";
  assert.equal(suggestion(data, now), null);
  assert.equal(automaticPracticeEligible(data.problems[0], now), false);
  let changed = rescheduleProblem(data, problem.id, "2026-10-04");
  assert.equal(suggestion(changed, now)?.problem.id, problem.id);
  changed = skipRecommendation(changed, problem.id, now);
  assert.equal(suggestion(changed, now), null);
  assert.equal(changed.problems[0].reviewAt, "2026-10-04");
  assert.equal(
    suggestion(changed, new Date("2026-10-05T12:00:00"))?.problem.id,
    problem.id,
  );
  changed = deferProblem(changed, problem.id, "2026-11-04");
  assert.equal(suggestion(changed, new Date("2026-10-05T12:00:00")), null);
  changed = archiveProblem(changed, problem.id);
  assert.equal(suggestion(changed, new Date("2026-11-05T12:00:00")), null);
  assert.equal(changed.problems[0].reviewAt, "2026-10-04");
  assert.deepEqual(validateData(changed), changed);
});
test("completing a revisit only completes its schedule and never claims a learning outcome", () => {
  const data = rescheduleProblem(fixture(), problem.id, "2026-10-04");
  const complete = completeRevisit(data, problem.id, now);
  assert.equal(complete.problems[0].reviewAt, null);
  assert.equal(complete.problems[0].reviewManual, true);
  assert.equal(complete.problems[0].reviewCompletedAt, now.toISOString());
  assert.equal(complete.attempts.length, 0);
  assert.deepEqual(validateData(complete), complete);
  assert.throws(
    () => rescheduleProblem(data, problem.id, "2026-02-30"),
    /valid/,
  );
  assert.throws(
    () =>
      validateData({
        ...data,
        problems: [{ ...data.problems[0], deferredUntil: "2026-02-30" }],
      }),
    /preferences/,
  );
});
test("demo data validates and shows both learning and actual weekly activity", () => {
  const data = createDemo(now);
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
  assert.equal(
    weekActivity(data, now).reduce((sum, d) => sum + d.count, 0),
    3,
  );
  assert.ok(breakthroughs(data).length >= 3);
  assert.equal(suggestion(data, now)?.problem.id, "diagonal");
  assert.equal(emptyData().problems.length, 0);
  const early = createDemo(new Date("2026-09-28T00:20:00"));
  assert.ok(
    early.attempts.every(
      (a) => new Date(a.completedAt) <= new Date("2026-09-28T00:20:00"),
    ),
  );
});
test("JSON import rejects broken relationships, duplicates, malformed settings, and unsafe URLs", () => {
  assert.throws(() => validateData({}), /supported/);
  assert.throws(
    () => validateData({ ...fixture(), problems: [problem, problem] }),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateData({
        ...fixture(),
        settings: { ...emptyData().settings, weeklyGoal: 1.5 },
      }),
    /settings/,
  );
  assert.throws(
    () =>
      validateData({
        ...fixture(),
        problems: [{ ...problem, url: "javascript:alert(1)" }],
      }),
    /unsafe/,
  );
  assert.throws(
    () =>
      validateData({
        ...fixture(),
        problems: [{ ...problem, reviewAt: "2026-02-30" }],
      }),
    /invalid/,
  );
  const demo = createDemo(now);
  assert.throws(
    () =>
      validateData({
        ...demo,
        attempts: [{ ...demo.attempts[0], problemId: "missing" }],
      }),
    /missing problem/,
  );
  assert.throws(
    () =>
      validateData({
        ...demo,
        attempts: [{ ...demo.attempts[0], outcome: "toString" }],
      }),
    /invalid/,
  );
  assert.throws(
    () =>
      validateData({
        ...demo,
        attempts: [{ ...demo.attempts[0], elapsedMs: Infinity }],
      }),
    /invalid/,
  );
  assert.throws(
    () => validateData({ ...demo, session: { id: "s", problemId: "missing" } }),
    /active session/,
  );
  assert.equal(safeUrl("https://codeforces.com/problemset/problem/4/A"), true);
  assert.equal(safeUrl("https://name:password@example.com"), false);
  assert.equal(safeUrl("data:text/html,unsafe"), false);
});
test("import reconstruction drops unknown keys and permits a full export roundtrip", () => {
  const data = createDemo(now);
  const imported = validateData({
    ...data,
    theme: "dark",
    unknown: "discard",
    settings: { ...data.settings, extra: "discard" },
  });
  assert.deepEqual(imported, data);
  assert.equal(Object.hasOwn(imported, "unknown"), false);
});
test("unavailable or corrupted storage returns an empty workspace without overwriting records", () => {
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "{not json}", setItem: () => writes++ },
  });
  const invalid = loadPersonal();
  assert.equal(invalid.data.problems.length, 0);
  assert.ok(invalid.error);
  assert.equal(writes, 0);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    },
  });
  assert.ok(loadPersonal().error);
  Reflect.deleteProperty(globalThis, "localStorage");
});
