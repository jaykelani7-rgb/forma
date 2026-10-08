import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  localDate,
  validateData,
  type Data,
  type Problem,
  type Attempt,
} from "../src/lib/model";
import {
  practiceCandidates,
  practicePreferences,
  reconcilePracticePlan,
  currentPracticePlan,
  practicePlanView,
  setPlanAvailability,
  replacePlanItem,
  decidePlanItem,
  endPracticePlan,
  continuePracticePlan,
  markPlanStarted,
  setPlanTimebox,
  setPracticePreferences,
  resolvePlanProblem,
} from "../src/lib/practice-plan";
import { validatePracticePreferences } from "../src/lib/practice-plan-types";
import {
  importTrack,
  removeTrack,
  trackContextForEntry,
} from "../src/lib/tracks";
import { withPracticeSession } from "../src/lib/practice-session";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../src/lib/codeforces";
import { saveRevision } from "../src/lib/memory";
import { linkLearningAttempts } from "../src/lib/learning";
import { decodeBackup, encodeBackup } from "../src/lib/concurrency";

const now = new Date(2026, 9, 8, 12, 0, 0);
const later = new Date(now.getTime() + 1800000);
const problem = (id: string, reviewAt: string | null = null): Problem => ({
  id,
  title: id,
  platform: "LeetCode",
  url: "",
  problemCode: "",
  tags: ["arrays"],
  rating: null,
  createdAt: new Date(2026, 9, 1).toISOString(),
  reviewAt,
  reviewCount: 0,
});
const attempt = (
  problemId: string,
  id = "completed-session",
  completedAt = later.toISOString(),
  outcome: Attempt["outcome"] = "unsolved",
): Attempt => ({
  id,
  problemId,
  startedAt: now.toISOString(),
  completedAt,
  elapsedMs: 600000,
  outcome,
  difficulty: null,
  notes: "Original notes.",
  takeaway: "Participation does not imply solving.",
});
function sheet(base = emptyData(), codes = ["4A", "5A", "6A"]): Data {
  return importTrack(
    base,
    {
      id: "track",
      title: "Foundation Practice",
      sourceName: "manual",
      sourceFingerprint: "plan-track",
      stages: [
        {
          id: "stage",
          title: "Foundation",
          description: "",
          suggestedTime: "Source suggests 45 minutes",
          entries: codes.map((code, index) => ({
            id: `entry-${index}`,
            title: `Problem ${code}`,
            code,
            url: "",
            rating: null,
            pattern: "Do not expose this hint",
          })),
        },
      ],
    },
    undefined,
    now,
  );
}
function recall(data: Data, id: string, nextReviewAt = localDate(now)): Data {
  return saveRevision(data, {
    id: `prior-${id}`,
    problemId: id,
    handle: null,
    activity: "explain",
    outcome: "cue",
    response: "My earlier explanation.",
    cue: "Keep the invariant.",
    completedAt: new Date(now.getTime() - 86400000).toISOString(),
    nextReviewAt,
  });
}

test("backup validation rejects a real later-day record as completion of an older unbound plan", () => {
  const data = reconcilePracticePlan(
    { ...emptyData(), problems: [problem("calendar-proof", localDate(now))] },
    now,
  );
  const plan = currentPracticePlan(data, now)!;
  const record = attempt(
    "calendar-proof",
    "later-day-proof",
    new Date(now.getTime() + 86400000).toISOString(),
  );
  const forged = {
    ...data,
    attempts: [record],
    practicePlans: [
      {
        ...plan,
        items: plan.items.map((item) => ({
          ...item,
          status: "completed" as const,
          completion: {
            type: "attempt" as const,
            recordId: record.id,
            completedAt: record.completedAt,
          },
        })),
      },
    ],
  };
  assert.throws(
    () => validateData(forged),
    /saved identity, profile, and date/,
  );
});

test("new user has optional defaults and an honest empty plan with no generated history", () => {
  const source = emptyData(),
    data = reconcilePracticePlan(source, now),
    view = practicePlanView(data, now);
  assert.equal(view.primary, null);
  assert.equal(view.plan!.budgetMinutes, 30);
  assert.deepEqual(
    practicePreferences(source).preferredDays,
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.equal(view.restart, null);
  assert.deepEqual(data.attempts, []);
  assert.deepEqual(data.revisions, []);
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});
test("short budgets select one shorter allocation and normal budgets never fill the entire overdue backlog", () => {
  const source = {
    ...emptyData(),
    problems: Array.from({ length: 9 }, (_, i) =>
      problem(`due-${i}`, localDate(now)),
    ),
  };
  const short = setPlanAvailability(source, 10, now),
    long = setPlanAvailability(source, 60, now);
  assert.equal(currentPracticePlan(short, now)!.items.length, 1);
  assert.equal(currentPracticePlan(short, now)!.items[0].timeboxMinutes, 10);
  assert.equal(practicePlanView(short, now).backlogCount, 9);
  assert.equal(currentPracticePlan(long, now)!.items.length, 2);
  assert.equal(practicePlanView(long, now).allocatedMinutes, 60);
  assert.equal(source.settings.defaultDuration, 30);
});
test("unfinished session takes priority even on a configured rest day and retains original context", () => {
  let data = sheet({
    ...emptyData(),
    problems: [problem("due", localDate(now))],
  });
  data = setPracticePreferences(data, {
    dailyMinutes: 15,
    preferredDays: [],
    mode: "mixed",
    targetDate: null,
  });
  const entry = data.trackEntries![1],
    selected = data.problems.find((problem) => problem.id === entry.problemId)!;
  const focused = withPracticeSession(
    data,
    selected,
    30,
    now.getTime() - 600000,
    "open",
    false,
    trackContextForEntry(data, entry.id)!,
  );
  const planned = reconcilePracticePlan(focused, now),
    primary = practicePlanView(planned, now).primary!;
  assert.equal(primary.kind, "session");
  assert.equal(primary.problemId, selected.id);
  assert.equal(primary.trackContext!.entryId, entry.id);
  assert.equal(currentPracticePlan(planned, now)!.items.length, 1);
  assert.deepEqual(planned.session, focused.session);
});
test("coding and written recall retain separate future dates and share an explicit relationship without duplicate default activities", () => {
  let data: Data = {
    ...emptyData(),
    problems: [problem("same", localDate(now))],
  };
  data = recall(data, "same");
  const candidates = practiceCandidates(data, now);
  assert.deepEqual(
    candidates.map((item) => item.kind),
    ["coding", "recall"],
  );
  assert.equal(candidates[0].relatedRecallAt, localDate(now));
  assert.equal(candidates[1].relatedCodingAt, localDate(now));
  const plan = setPlanAvailability(data, 60, now);
  assert.equal(currentPracticePlan(plan, now)!.items.length, 1);
  const onlyRecall = {
    ...data,
    problems: data.problems.map((problem) => ({
      ...problem,
      reviewAt: localDate(new Date(now.getTime() + 86400000)),
    })),
  };
  assert.equal(
    practicePlanView(reconcilePracticePlan(onlyRecall, now), now).primary!.kind,
    "recall",
  );
  const futureRecall = recall(
    data,
    "same",
    localDate(new Date(now.getTime() + 86400000)),
  );
  assert.equal(
    practiceCandidates(futureRecall, now).some(
      (item) => item.kind === "recall",
    ),
    false,
  );
});
test("equal priority uses due date, coding before recall, then canonical identity rather than insertion order", () => {
  const first = {
    ...emptyData(),
    problems: [
      problem("z", "2026-10-06"),
      problem("a", "2026-10-06"),
      problem("older", "2026-10-05"),
    ],
  };
  const second = { ...first, problems: [...first.problems].reverse() };
  assert.deepEqual(
    practiceCandidates(first, now).map((item) => item.problem.id),
    ["older", "a", "z"],
  );
  assert.deepEqual(
    practiceCandidates(first, now).map((item) => item.key),
    practiceCandidates(second, now).map((item) => item.key),
  );
});
test("following a track changes optional activity ordering while the primary due revisit keeps priority", () => {
  const source = sheet({
    ...emptyData(),
    problems: [problem("due-a", "2026-10-06"), problem("due-b", "2026-10-07")],
  });
  const mixed = setPlanAvailability(source, 60, now);
  const track = setPlanAvailability(
    setPracticePreferences(source, {
      ...practicePreferences(source),
      mode: "track",
    }),
    60,
    now,
  );
  assert.deepEqual(
    currentPracticePlan(mixed, now)!.items.map((item) => item.kind),
    ["coding", "coding"],
  );
  assert.deepEqual(
    currentPracticePlan(track, now)!.items.map((item) => item.kind),
    ["coding", "track"],
  );
  assert.equal(
    currentPracticePlan(track, now)!.items[1].reason.includes("Foundation"),
    true,
  );
  assert.equal(
    JSON.stringify(currentPracticePlan(track, now)).includes(
      "Do not expose this hint",
    ),
    false,
  );
  assert.equal(
    practiceCandidates(source, now).find((item) => item.kind === "track")!
      .sourceTimeSuggestion,
    "Source suggests 45 minutes",
  );
});
test("skips, deferrals and archival apply to the shared identity group while old profile imports stay isolated", () => {
  let data = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  const manual = {
    ...problem("personal", localDate(now)),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
  };
  const imported = {
    ...manual,
    id: "imported",
    cfHandle: "alpha",
    cfKey: "contest:4:A",
    skippedOn: localDate(now),
  };
  data = { ...data, problems: [manual, imported] };
  assert.equal(practiceCandidates(data, now).length, 0);
  const available = {
    ...data,
    problems: data.problems.map((problem) => ({ ...problem, skippedOn: null })),
  };
  assert.equal(
    currentPracticePlan(setPlanAvailability(available, 60, now), now)!.items
      .length,
    1,
  );
  const deferred = {
    ...available,
    problems: available.problems.map((problem) =>
      problem.id === "imported"
        ? { ...problem, deferredUntil: "2026-10-09" }
        : problem,
    ),
  };
  assert.equal(practiceCandidates(deferred, now).length, 0);
  const archived = {
    ...available,
    problems: available.problems.map((problem) =>
      problem.id === "imported" ? { ...problem, archived: true } : problem,
    ),
  };
  assert.equal(practiceCandidates(archived, now).length, 0);
  const beta = connectProfile(
    archived,
    { handle: "beta", rating: null, rank: null },
    now,
  );
  assert.equal(practiceCandidates(beta, now).length, 1);
  assert.equal(practiceCandidates(beta, now)[0].problem.id, "personal");
});
test("empty or independently completed active track does not produce imaginary or repeated next work", () => {
  const empty = sheet(emptyData(), []);
  assert.equal(
    practicePlanView(reconcilePracticePlan(empty, now), now).primary,
    null,
  );
  const active = sheet();
  const finished = {
    ...active,
    attempts: active.problems.map((problem, i) =>
      attempt(
        problem.id,
        `past-${i}`,
        new Date(now.getTime() - 3600000).toISOString(),
        "independent",
      ),
    ),
  };
  assert.equal(
    practicePlanView(reconcilePracticePlan(finished, now), now).primary,
    null,
  );
});
test("refreshes retain selected IDs, explanations, order and availability instead of reshuffling", () => {
  const planned = setPlanAvailability(sheet(), 45, now);
  const stable = reconcilePracticePlan(validateData(planned), later);
  assert.deepEqual(
    currentPracticePlan(stable, later),
    currentPracticePlan(planned, now),
  );
  assert.equal(reconcilePracticePlan(stable, later), stable);
});
test("adding a track after an empty first visit fills the empty plan without a second planner", () => {
  const initial = reconcilePracticePlan(emptyData(), now);
  const data = reconcilePracticePlan(sheet(initial), later);
  assert.equal(
    practicePlanView(data, later).primary!.trackContext!.entryId,
    "entry-0",
  );
  assert.equal(data.practicePlans!.length, 1);
});
test("a schedule changed after selection retains stale evidence and replaces it visibly", () => {
  const source = {
    ...emptyData(),
    problems: [problem("first", "2026-10-07"), problem("second", "2026-10-08")],
  };
  const initial = reconcilePracticePlan(source, now),
    original = practicePlanView(initial, now).primary!;
  const changed = reconcilePracticePlan(
    {
      ...initial,
      problems: initial.problems.map((problem) =>
        problem.id === "first"
          ? {
              ...problem,
              reviewAt: "2026-10-09",
              reviewManual: true,
              reviewUpdatedAt: later.toISOString(),
            }
          : problem,
      ),
    },
    later,
  );
  const old = currentPracticePlan(changed, later)!.items.find(
    (item) => item.id === original.id,
  )!;
  assert.equal(old.status, "stale");
  assert.equal(old.scheduleAt, "2026-10-07");
  assert.equal(practicePlanView(changed, later).primary!.problemId, "second");
  assert.match(currentPracticePlan(changed, later)!.messages[0], /schedule/);
});
test("removed track membership invalidates pending selection and never reattributes its original context", () => {
  const initial = reconcilePracticePlan(sheet(), now),
    original = practicePlanView(initial, now).primary!;
  const changed = reconcilePracticePlan(removeTrack(initial, "track"), later);
  assert.equal(
    currentPracticePlan(changed, later)!.items.find(
      (item) => item.id === original.id,
    )!.status,
    "stale",
  );
  assert.deepEqual(
    currentPracticePlan(changed, later)!.items.find(
      (item) => item.id === original.id,
    )!.trackContext,
    original.trackContext,
  );
  assert.match(currentPracticePlan(changed, later)!.messages[0], /membership/);
});
test("timebox participation completes only from an actual saved attempt, including an unsolved outcome", () => {
  const initial = reconcilePracticePlan(
      { ...emptyData(), problems: [problem("timed")] },
      now,
    ),
    item = practicePlanView(initial, now).primary!;
  const started = markPlanStarted(
    withPracticeSession(
      initial,
      initial.problems[0],
      10,
      now.getTime(),
      "saved-session",
    ),
    item.id,
    "saved-session",
    now,
  );
  const ended = endPracticePlan(started, later);
  assert.equal(currentPracticePlan(ended, later)!.items[0].status, "pending");
  assert.equal(ended.attempts.length, 0);
  const saved = reconcilePracticePlan(
    {
      ...started,
      session: null,
      attempts: [attempt("timed", "saved-session")],
    },
    later,
  );
  assert.equal(currentPracticePlan(saved, later)!.items[0].status, "completed");
  assert.deepEqual(currentPracticePlan(saved, later)!.items[0].completion, {
    type: "attempt",
    recordId: "saved-session",
    completedAt: later.toISOString(),
  });
  assert.equal(saved.attempts[0].outcome, "unsolved");
  assert.equal(saved.attempts[0].elapsedMs, 600000);
  assert.deepEqual(decodeBackup(encodeBackup(saved)), saved);
});
test("written recall completion does not complete coding or create measured duration", () => {
  let source: Data = {
    ...emptyData(),
    problems: [problem("recall", "2026-10-09")],
  };
  source = recall(source, "recall");
  const initial = reconcilePracticePlan(source, now),
    item = practicePlanView(initial, now).primary!;
  const saved = reconcilePracticePlan(
    saveRevision(initial, {
      id: "new-recall",
      problemId: "recall",
      handle: null,
      activity: "explain",
      outcome: "unrecalled",
      response: "Still learning.",
      cue: "",
      completedAt: later.toISOString(),
      nextReviewAt: "2026-10-09",
    }),
    later,
  );
  assert.equal(
    currentPracticePlan(saved, later)!.items.find(
      (value) => value.id === item.id,
    )!.completion!.type,
    "revision",
  );
  assert.equal(saved.problems[0].reviewAt, "2026-10-09");
  assert.deepEqual(saved.attempts, []);
  assert.deepEqual(decodeBackup(encodeBackup(saved)), saved);
});
test("completion in another tab follows a new actual canonical timed record and excludes old records", () => {
  const manual = {
    ...problem("one", localDate(now)),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
  };
  const other = { ...manual, id: "two" };
  const initial = reconcilePracticePlan(
    {
      ...emptyData(),
      problems: [manual, other],
      attempts: [
        attempt("two", "old", new Date(now.getTime() - 3600000).toISOString()),
      ],
    },
    now,
  );
  assert.equal(currentPracticePlan(initial, now)!.items[0].status, "pending");
  const changed = reconcilePracticePlan(
    {
      ...initial,
      attempts: [...initial.attempts, attempt("two", "other-tab")],
    },
    later,
  );
  assert.equal(
    currentPracticePlan(changed, later)!.items[0].completion!.recordId,
    "other-tab",
  );
  assert.equal(changed.problems.length, 2);
  assert.equal(changed.attempts.length, 2);
});
test("manual replacement, skip and deferral retain decisions and never invent learning records", () => {
  const initial = reconcilePracticePlan(
      { ...emptyData(), problems: [problem("a"), problem("b"), problem("c")] },
      now,
    ),
    first = practicePlanView(initial, now).primary!;
  const chosen = replacePlanItem(
    initial,
    first.id,
    practiceCandidates(initial, now).find((item) => item.problem.id === "b")!
      .key,
    now,
  );
  const primary = practicePlanView(chosen, now).primary!;
  assert.equal(primary.problemId, "b");
  assert.equal(primary.deliberate, true);
  const skipped = decidePlanItem(chosen, primary.id, "skip", undefined, now);
  assert.equal(
    currentPracticePlan(skipped, now)!.items.find(
      (item) => item.id === primary.id,
    )!.status,
    "skipped",
  );
  assert.deepEqual(reconcilePracticePlan(skipped, later), skipped);
  assert.equal(
    skipped.problems.find((problem) => problem.id === "b")!.skippedOn,
    localDate(now),
  );
  const extra = continuePracticePlan(skipped, now),
    selected = practicePlanView(extra, now).primary!;
  const deferred = decidePlanItem(
    extra,
    selected.id,
    "defer",
    "2026-10-09",
    now,
  );
  assert.equal(
    currentPracticePlan(deferred, now)!.items.find(
      (item) => item.id === selected.id,
    )!.deferredUntil,
    "2026-10-09",
  );
  assert.equal(deferred.attempts.length, 0);
  assert.equal(deferred.revisions!.length, 0);
});
test("ending and deliberately continuing a plan does not solve or reflect a problem", () => {
  const initial = reconcilePracticePlan(sheet(), now),
    ended = endPracticePlan(initial, now);
  assert.equal(practicePlanView(ended, now).primary, null);
  const continued = continuePracticePlan(ended, later);
  assert.equal(
    practicePlanView(continued, later).primary!.id,
    practicePlanView(initial, now).primary!.id,
  );
  assert.deepEqual(continued.attempts, initial.attempts);
  assert.deepEqual(continued.revisions, initial.revisions);
});
test("edited larger timebox is an explicit allocation and an override never changes usual preferences", () => {
  const initial = setPlanAvailability(sheet(), 10, now),
    item = practicePlanView(initial, now).primary!;
  const edited = setPlanTimebox(initial, item.id, 45, now);
  assert.equal(practicePlanView(edited, now).allocatedMinutes, 45);
  assert.equal(currentPracticePlan(edited, now)!.budgetMinutes, 10);
  assert.equal(practicePreferences(edited).dailyMinutes, 30);
  assert.equal(practicePlanView(edited, now).primary!.deliberate, true);
});
test("local midnight creates another day plan while retaining an active session without interruption", () => {
  const before = new Date(2026, 9, 8, 23, 58),
    after = new Date(2026, 9, 9, 0, 3);
  const source = { ...emptyData(), problems: [problem("night")] };
  const active = withPracticeSession(
    source,
    source.problems[0],
    30,
    before.getTime(),
    "night-session",
  );
  const initial = reconcilePracticePlan(active, before),
    next = reconcilePracticePlan(initial, after);
  assert.equal(next.practicePlans!.length, 2);
  assert.equal(
    practicePlanView(next, after).primary!.sessionId,
    "night-session",
  );
  assert.deepEqual(next.session, initial.session);
});
test("timezone offset changes retain a plan on the same local date and report the stored boundary", () => {
  const initial = reconcilePracticePlan(sheet(), now);
  const shifted = new Date(now);
  Object.defineProperty(shifted, "getTimezoneOffset", {
    value: () => now.getTimezoneOffset() - 60,
  });
  const retained = reconcilePracticePlan(initial, shifted);
  assert.deepEqual(
    currentPracticePlan(retained, shifted),
    currentPracticePlan(initial, now),
  );
  assert.equal(practicePlanView(retained, shifted).timezoneChanged, true);
});
test("configured rest day stays optional and availability deliberately opts in", () => {
  const source = setPracticePreferences(sheet(), {
    dailyMinutes: 30,
    preferredDays: [],
    mode: "track",
    targetDate: "2027-04-01",
  });
  const initial = reconcilePracticePlan(source, now);
  assert.equal(practicePlanView(initial, now).primary, null);
  const chosen = setPlanAvailability(initial, 15, now);
  assert.equal(practicePlanView(chosen, now).primary!.timeboxMinutes, 15);
  assert.equal(practicePlanView(chosen, now).preferredDay, false);
  assert.equal(practicePreferences(chosen).targetDate, "2027-04-01");
});
test("return after a break uses scoped saved practice evidence and sparse data stays honest", () => {
  const source = {
    ...emptyData(),
    problems: [problem("past")],
    attempts: [
      attempt(
        "past",
        "past",
        new Date(now.getTime() - 9 * 86400000).toISOString(),
      ),
    ],
  };
  assert.equal(practicePlanView(source, now).restart!.days, 9);
  assert.equal(practicePlanView(emptyData(), now).restart, null);
  const recent = {
    ...source,
    attempts: [
      ...source.attempts,
      attempt(
        "past",
        "recent",
        new Date(now.getTime() - 86400000).toISOString(),
      ),
    ],
  };
  assert.equal(practicePlanView(recent, now).restart, null);
});
test("invalid preferences, impossible dates and fabricated completion cannot reach a workspace", () => {
  for (const value of [
    { dailyMinutes: 4, preferredDays: [], mode: "track", targetDate: null },
    {
      dailyMinutes: 30,
      preferredDays: [1, 1],
      mode: "mixed",
      targetDate: null,
    },
    { dailyMinutes: 30, preferredDays: [7], mode: "mixed", targetDate: null },
    {
      dailyMinutes: 30,
      preferredDays: [],
      mode: "mixed",
      targetDate: "2026-02-31",
    },
  ])
    assert.throws(() => validatePracticePreferences(value));
  const source = reconcilePracticePlan(sheet(), now);
  const invented = {
    ...source,
    practicePlans: source.practicePlans!.map((plan) => ({
      ...plan,
      items: plan.items.map((item) => ({
        ...item,
        status: "completed",
        completion: {
          type: "attempt",
          recordId: "does-not-exist",
          completedAt: later.toISOString(),
        },
      })),
    })),
  };
  assert.throws(() => validateData(invented), /actual saved|must match/);
  assert.throws(() =>
    decidePlanItem(
      source,
      practicePlanView(source, now).primary!.id,
      "defer",
      "2026-02-31",
      now,
    ),
  );
  assert.equal(validateData(emptyData()).practicePlans, undefined);
});

test("a manually started coding session takes priority over pending recall for the same identity", () => {
  const source = recall(
    { ...emptyData(), problems: [problem("both", "2026-10-09")] },
    "both",
  );
  const initial = reconcilePracticePlan(source, now),
    original = practicePlanView(initial, now).primary!;
  assert.equal(original.kind, "recall");
  const started = reconcilePracticePlan(
    withPracticeSession(
      initial,
      initial.problems[0],
      15,
      now.getTime(),
      "manual-coding",
    ),
    now,
  );
  const view = practicePlanView(started, now);
  assert.equal(view.primary!.kind, "session");
  assert.equal(view.primary!.activity, "coding");
  assert.equal(view.remaining.length, 0);
  assert.equal(
    view.plan!.items.find((item) => item.id === original.id)!.status,
    "stale",
  );
  assert.match(
    view.plan!.items.find((item) => item.id === original.id)!.changeReason!,
    /recall remains separately due/,
  );
  assert.equal(currentPracticePlan(started, now)!.items.length, 2);
});

test("an old-profile session remains resumable after switching profile and its saved result only completes the old-profile plan", () => {
  const alpha = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  const imported = {
    ...problem("alpha-problem", localDate(now)),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
    cfHandle: "alpha",
    cfKey: "contest:4:A",
  };
  const original = reconcilePracticePlan(
      { ...alpha, problems: [imported] },
      now,
    ),
    item = practicePlanView(original, now).primary!;
  const started = markPlanStarted(
    withPracticeSession(original, imported, 30, now.getTime(), "alpha-session"),
    item.id,
    "alpha-session",
    now,
  );
  const switched = reconcilePracticePlan(
    connectProfile(started, { handle: "beta", rating: null, rank: null }, now),
    now,
  );
  assert.equal(currentPracticePlan(switched, now)!.handle, "alpha");
  assert.equal(practicePlanView(switched, now).primary!.problemId, imported.id);
  assert.equal(practiceCandidates(switched, now).length, 1);
  const saved = reconcilePracticePlan(
    {
      ...switched,
      session: null,
      attempts: [attempt(imported.id, "alpha-session")],
    },
    later,
  );
  assert.equal(currentPracticePlan(saved, later)!.handle, "beta");
  assert.equal(practicePlanView(saved, later).primary, null);
  assert.equal(
    saved.practicePlans!.find((plan) => plan.handle === "alpha")!.items[0]
      .completion!.recordId,
    "alpha-session",
  );
  assert.deepEqual(decodeBackup(encodeBackup(saved)), saved);
});

test("one saved session spanning midnight reconciles genuine evidence on both day plans without copying the attempt", () => {
  const before = new Date(2026, 9, 8, 23, 58),
    after = new Date(2026, 9, 9, 0, 3);
  const source = { ...emptyData(), problems: [problem("night")] };
  const active = withPracticeSession(
    source,
    source.problems[0],
    30,
    before.getTime(),
    "night-session",
  );
  const planned = reconcilePracticePlan(
    reconcilePracticePlan(active, before),
    after,
  );
  const saved = reconcilePracticePlan(
    {
      ...planned,
      session: null,
      attempts: [
        {
          ...attempt("night", "night-session", after.toISOString()),
          startedAt: before.toISOString(),
        },
      ],
    },
    after,
  );
  assert.equal(
    saved.practicePlans!.every((plan) => plan.items[0].status === "completed"),
    true,
  );
  assert.equal(saved.attempts.length, 1);
});

test("a later day’s unrelated activity never retrospectively completes an unbound older pending plan", () => {
  const initial = reconcilePracticePlan(
    { ...emptyData(), problems: [problem("same")] },
    now,
  );
  const nextDay = new Date(2026, 9, 9, 12),
    after = new Date(2026, 9, 9, 12, 30);
  const rolled = reconcilePracticePlan(initial, nextDay);
  const saved = reconcilePracticePlan(
    {
      ...rolled,
      attempts: [
        {
          ...attempt("same", "next-day", after.toISOString()),
          startedAt: nextDay.toISOString(),
        },
      ],
    },
    after,
  );
  assert.equal(
    saved.practicePlans!.find((plan) => plan.day === localDate(now))!.items[0]
      .status,
    "pending",
  );
  assert.equal(currentPracticePlan(saved, after)!.items[0].status, "completed");
});

test("accepted imports alone do not complete a plan or gain time; a real saved reflection supplies completion evidence that survives later editing", () => {
  let source = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  source = mergeActivity(
    source,
    "alpha",
    [
      {
        handle: "alpha",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 1,
            submittedAt: new Date(now.getTime() - 9 * 86400000).toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:4:A",
              title: "Watermelon",
              code: "4A",
              url: "https://codeforces.com/problemset/problem/4/A",
              rating: 800,
              tags: ["math"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  source = {
    ...source,
    problems: source.problems.map((problem) => ({
      ...problem,
      reviewAt: localDate(now),
      reviewManual: true,
      reviewUpdatedAt: now.toISOString(),
    })),
  };
  const initial = reconcilePracticePlan(source, now),
    item = practicePlanView(initial, now).primary!;
  assert.equal(currentPracticePlan(initial, now)!.items[0].status, "pending");
  const imported = initial.codeforces.practiceAttempts[0];
  const reflected = reconcilePracticePlan(
    saveQuickReflection(
      initial,
      imported.id,
      {
        outcome: "editorial",
        difficulty: null,
        takeaway: "Accepted with assistance.",
        reviewAt: "2026-10-09",
        overrideSchedule: true,
      },
      later,
    ),
    later,
  );
  const completed = currentPracticePlan(reflected, later)!.items.find(
    (value) => value.id === item.id,
  )!;
  assert.equal(completed.completion!.type, "reflection");
  assert.equal(reflected.attempts.length, 0);
  assert.equal(practicePlanView(reflected, later).restart, null);
  assert.equal(reflected.codeforces.reflections[0].outcome, "editorial");
  const editedAt = new Date(later.getTime() + 1000);
  const edited = saveQuickReflection(
    reflected,
    imported.id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Corrected original reflection.",
      reviewAt: "2026-10-09",
      overrideSchedule: false,
    },
    editedAt,
  );
  assert.deepEqual(
    currentPracticePlan(validateData(edited), editedAt)!.items.find(
      (value) => value.id === item.id,
    )!.completion,
    completed.completion,
  );
});

test("manually clearing a revisit without a saved learning record only invalidates the pending plan", () => {
  const initial = reconcilePracticePlan(
    { ...emptyData(), problems: [problem("scheduled", localDate(now))] },
    now,
  );
  const cleared = reconcilePracticePlan(
    {
      ...initial,
      problems: initial.problems.map((problem) => ({
        ...problem,
        reviewAt: null,
        reviewManual: true,
        reviewCompletedAt: later.toISOString(),
        reviewUpdatedAt: later.toISOString(),
      })),
    },
    later,
  );
  assert.equal(practicePlanView(cleared, later).completed.length, 0);
  assert.equal(cleared.attempts.length, 0);
  assert.equal(currentPracticePlan(cleared, later)!.items[0].status, "stale");
});

test("old profile practice cannot turn a new profile’s personal collection into familiar evidence", () => {
  const alpha = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  const personal = {
    ...problem("personal"),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
  };
  const imported = {
    ...personal,
    id: "imported-alpha",
    cfHandle: "alpha",
    cfKey: "contest:4:A",
  };
  const beta = connectProfile(
    {
      ...alpha,
      problems: [personal, imported],
      attempts: [
        attempt(
          imported.id,
          "old-alpha",
          new Date(now.getTime() - 9 * 86400000).toISOString(),
          "editorial",
        ),
      ],
    },
    { handle: "beta", rating: null, rank: null },
    now,
  );
  const selected = practiceCandidates(beta, now)[0];
  assert.equal(selected.problem.id, personal.id);
  assert.match(selected.reason, /untouched/);
  assert.equal(
    selected.evidence.some((source) => /assistance/.test(source.label)),
    false,
  );
  assert.equal(practicePlanView(beta, now).restart, null);
});

test("canonical Gym and contest namespace candidates stay distinct while A, A1 and A2 identities remain exact", () => {
  const source: Data = {
    ...emptyData(),
    problems: [
      {
        ...problem("gym", localDate(now)),
        platform: "Codeforces",
        problemCode: "100A",
        url: "https://codeforces.com/gym/100/problem/A",
      },
      {
        ...problem("contest", localDate(now)),
        platform: "Codeforces",
        problemCode: "100A",
        url: "https://codeforces.com/contest/100/problem/A",
      },
      {
        ...problem("a1", localDate(now)),
        platform: "Codeforces",
        problemCode: "100A1",
        url: "https://codeforces.com/contest/100/problem/A1",
      },
      {
        ...problem("a2", localDate(now)),
        platform: "Codeforces",
        problemCode: "100A2",
        url: "https://codeforces.com/contest/100/problem/A2",
      },
    ],
  };
  assert.equal(
    new Set(
      practiceCandidates(source, now).map((candidate) => candidate.identity),
    ).size,
    4,
  );
  assert.equal(
    practicePlanView(setPlanAvailability(source, 90, now), now).plan!.items
      .length,
    3,
  );
});

test("an unrecorded problem identity edit validates before reconciliation and retains the stale original plan evidence", () => {
  const original = {
    ...problem("editable"),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
  };
  const planned = reconcilePracticePlan(
      { ...emptyData(), problems: [original] },
      now,
    ),
    selected = practicePlanView(planned, now).primary!;
  const edited = validateData({
    ...planned,
    problems: planned.problems.map((problem) => ({
      ...problem,
      problemCode: "5A",
      url: "https://codeforces.com/problemset/problem/5/A",
    })),
  });
  const reconciled = validateData(reconcilePracticePlan(edited, later));
  const old = currentPracticePlan(reconciled, later)!.items.find(
    (item) => item.id === selected.id,
  )!;
  assert.equal(old.identity, "contest:4:A");
  assert.equal(old.status, "stale");
  assert.match(old.changeReason!, /identity was edited/);
  assert.equal(
    practicePlanView(reconciled, later).primary!.identity,
    "contest:5:A",
  );
  const malformed = {
    ...reconciled,
    practicePlans: reconciled.practicePlans!.map((plan) => ({
      ...plan,
      items: plan.items.map((item) => ({ ...item, identity: "invented:4:A" })),
    })),
  };
  assert.throws(() => validateData(malformed), /invalid references/);
});

test("resolving a plan on one canonical copy resumes the real session on another copy and preserves both contexts", () => {
  const source = sheet(emptyData(), ["4A"]);
  const first = source.problems[0],
    duplicate = { ...first, id: "personal-copy" };
  const planned = reconcilePracticePlan(
      { ...source, problems: [...source.problems, duplicate] },
      now,
    ),
    selected = practicePlanView(planned, now).primary!;
  const context = {
    trackId: "original-track",
    stageId: "original-stage",
    entryId: "original-entry",
    trackTitle: "Original session source",
    stageTitle: "Earlier practice",
  };
  // A removed membership may remain on an already saved real session snapshot.
  const active: Data = {
    ...planned,
    session: {
      id: "copy-session",
      problemId: duplicate.id,
      startedAt: now.toISOString(),
      runningSince: null,
      elapsedMs: 0,
      targetMinutes: 30,
      notes: "Real saved session notes.",
      timerVisible: true,
      phase: "focus",
      trackContext: context,
    },
  };
  const checked = reconcilePracticePlan(validateData(active), now),
    primary = practicePlanView(checked, now).primary!;
  const resolved = resolvePlanProblem(checked, primary)!;
  assert.equal(primary.problemId, first.id);
  assert.deepEqual(primary.trackContext, selected.trackContext);
  assert.equal(primary.sessionId, "copy-session");
  assert.equal(resolved.problem.id, duplicate.id);
  assert.deepEqual(resolved.trackContext, context);
  assert.equal(checked.session!.notes, "Real saved session notes.");
  const afterMidnight = new Date(2026, 9, 9, 0, 3);
  const saved = reconcilePracticePlan(
    {
      ...checked,
      session: null,
      attempts: [
        {
          ...attempt(duplicate.id, "copy-session", afterMidnight.toISOString()),
          trackContext: context,
        },
      ],
    },
    afterMidnight,
  );
  assert.equal(
    saved.practicePlans!.find((plan) => plan.day === localDate(now))!.items[0]
      .completion!.recordId,
    "copy-session",
  );
  assert.equal(saved.attempts.length, 1);
});

test("a later explicit profile link preserves genuine completed evidence while removing participation from the old profile plan", () => {
  const personal = {
    ...problem("personal-canonical"),
    platform: "Codeforces",
    problemCode: "4A",
    url: "https://codeforces.com/problemset/problem/4/A",
  };
  const alpha = connectProfile(
    emptyData(),
    { handle: "alpha", rating: null, rank: null },
    now,
  );
  const planned = reconcilePracticePlan(
    { ...alpha, problems: [personal] },
    now,
  );
  const completed = reconcilePracticePlan(
    { ...planned, attempts: [attempt(personal.id, "personal-timed")] },
    later,
  );
  const originalCompletion = currentPracticePlan(completed, later)!.items[0]
    .completion;
  const linkedAt = new Date(later.getTime() + 1000);
  let beta = connectProfile(
    completed,
    { handle: "beta", rating: null, rank: null },
    linkedAt,
  );
  beta = mergeActivity(
    beta,
    "beta",
    [
      {
        handle: "beta",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 1,
            submittedAt: later.toISOString(),
            verdict: "OK",
            language: "C++",
            problem: {
              key: "contest:4:A",
              title: "Watermelon",
              code: "4A",
              url: personal.url,
              rating: 800,
              tags: [],
            },
          },
        ],
      },
    ],
    "refresh",
    linkedAt,
  );
  const proposed = linkLearningAttempts(
    beta,
    "personal-timed",
    beta.codeforces.practiceAttempts[0].id,
    "timed",
    linkedAt,
  );
  const reconciled = validateData(
    reconcilePracticePlan(validateData(proposed), linkedAt),
  );
  const old = reconciled.practicePlans!.find((plan) => plan.handle === "alpha")!
    .items[0];
  assert.equal(old.status, "stale");
  assert.deepEqual(old.completion, originalCompletion);
  assert.match(old.changeReason!, /explicitly linked to another profile/);
  assert.equal(reconciled.attempts.length, 1);
  assert.equal(reconciled.learningLinks!.length, 1);
  assert.deepEqual(decodeBackup(encodeBackup(reconciled)), reconciled);
  const oldScope = connectProfile(
    reconciled,
    { handle: "alpha", rating: null, rank: null },
    linkedAt,
  );
  assert.equal(practicePlanView(oldScope, linkedAt).completed.length, 0);
  const unproven = {
    ...proposed,
    learningLinks: proposed.learningLinks!.map((link) => ({
      ...link,
      linkedAt: now.toISOString(),
    })),
  };
  assert.throws(
    () => validateData(unproven),
    /saved identity, profile, and date/,
  );
  const forgedIdentity = {
    ...reconciled,
    practicePlans: reconciled.practicePlans!.map((plan) =>
      plan.handle === "alpha"
        ? {
            ...plan,
            items: plan.items.map((item) => ({
              ...item,
              identity: "contest:5:A",
            })),
          }
        : plan,
    ),
  };
  assert.throws(
    () => validateData(forgedIdentity),
    /saved identity, profile, and date/,
  );
});

test("the literal Codeforces handle personal cannot collide with disconnected notebook plan scope", () => {
  const disconnected = reconcilePracticePlan(
    { ...emptyData(), problems: [problem("own")] },
    now,
  );
  const connected = reconcilePracticePlan(
    connectProfile(
      disconnected,
      { handle: "personal", rating: null, rank: null },
      now,
    ),
    now,
  );
  assert.equal(connected.practicePlans!.length, 2);
  assert.equal(currentPracticePlan(connected, now)!.handle, "personal");
  const notebook = connected.practicePlans!.find(
    (plan) => plan.handle === null,
  )!;
  assert.notEqual(notebook.id, currentPracticePlan(connected, now)!.id);
  assert.deepEqual(decodeBackup(encodeBackup(connected)), connected);
});
