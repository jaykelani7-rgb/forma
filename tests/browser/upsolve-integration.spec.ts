import { expect, test, type Page } from "@playwright/test";
import {
  emptyData,
  localDate,
  validateData,
  type Attempt,
  type Data,
  type Problem,
} from "../../src/lib/model";
import { connectProfile } from "../../src/lib/codeforces";
import {
  createContest,
  startContest,
  endContest,
  editContest,
  queueUpsolve,
  reconcileContests,
} from "../../src/lib/contest-lab";
import { withPracticeSession } from "../../src/lib/practice-session";
import { setPracticePreferences } from "../../src/lib/practice-plan";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-08T06:30:00Z");
const at = (minutesBefore: number) =>
  new Date(now.getTime() - minutesBefore * 60000);
const titles = {
  A: "Normal-priority boundary practice 4A",
  B: "High-priority interval practice 4B",
};
function problem(index: "A" | "B"): Problem {
  return {
    id: `upsolve-${index}`,
    title: titles[index],
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/4/${index}`,
    problemCode: `4${index}`,
    rating: 1200,
    tags: ["implementation"],
    createdAt: at(70).toISOString(),
    reviewAt: null,
    reviewCount: 0,
  };
}
function queued(two = false, highB = true): Data {
  const problems = [problem("A"), ...(two ? [problem("B")] : [])];
  let data = connectProfile(
    { ...emptyData(), problems },
    { handle: "fixture_user", rating: 1400, rank: "specialist" },
    at(60),
  );
  data = endContest(
    startContest(
      createContest(
        data,
        "upsolve-contest",
        "Priority and correction practice",
        30,
        problems,
        false,
        "manual",
        at(60),
      ),
      "upsolve-contest",
      at(60),
    ),
    "upsolve-contest",
    "early",
    at(50),
  );
  data = editContest(data, "upsolve-contest", (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      status: "working",
      notes: "Original contest scratch stays with the contest.",
      reflection: {
        outcome: "hint",
        difficulty: "edges",
        takeaway: "Original contest reflection remains separate.",
        savedAt: at(49).toISOString(),
      },
    })),
  }));
  data = queueUpsolve(
    data,
    "upsolve-contest",
    "upsolve-contest:0",
    "normal",
    localDate(now),
    at(48),
  );
  if (two)
    data = queueUpsolve(
      data,
      "upsolve-contest",
      "upsolve-contest:1",
      highB ? "high" : "normal",
      localDate(now),
      at(48),
    );
  data = setPracticePreferences(data, {
    dailyMinutes: 15,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  });
  return validateData(data);
}
function completed(): Data {
  let data = queued();
  data = {
    ...data,
    problems: data.problems.map((item) => ({
      ...item,
      reviewAt: localDate(now),
      reviewManual: true,
      reviewUpdatedAt: at(48).toISOString(),
    })),
  };
  data = withPracticeSession(
    data,
    data.problems[0],
    15,
    at(47).getTime(),
    "real-upsolve-session",
  );
  const attempt: Attempt = {
    id: "real-upsolve-session",
    problemId: data.session!.problemId,
    startedAt: at(47).toISOString(),
    completedAt: at(44).toISOString(),
    elapsedMs: 180000,
    outcome: "independent",
    difficulty: null,
    notes: "The later timed practice has its own notes.",
    takeaway: "Keep the invariant explicit.",
  };
  return validateData(
    reconcileContests({ ...data, session: null, attempts: [attempt] }, now),
  );
}
async function seed(page: Page, data: Data) {
  await page.clock.install({ time: now });
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.upsolve-integration-seed")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "light");
    localStorage.setItem("forma.upsolve-integration-seed", "yes");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get("action") === "profile"
          ? { handle: "fixture_user", rating: 1400, rank: "specialist" }
          : { handle: "fixture_user", from: 1, count: 50, submissions: [] },
    }),
  );
}
async function saved(page: Page): Promise<Data> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("workspaces"),
            read = tx.objectStore("workspaces").get("personal");
          read.onsuccess = () => resolve(read.result.data);
          read.onerror = () => reject(read.error);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}
async function currentPlan(page: Page) {
  return ((await saved(page)).practicePlans ?? []).find(
    (plan) => plan.day === localDate(now),
  )!;
}
function card(page: Page, index: "A" | "B") {
  return page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: titles[index], exact: true }),
  });
}
async function correctOutcome(
  page: Page,
  outcome: "Not solved yet" | "Solved independently",
) {
  await page.getByRole("button", { name: /^Edit reflection:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Edit timed reflection" });
  await dialog.getByRole("button", { name: outcome, exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save reflection changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
async function raiseB(page: Page) {
  await page.goto("/contests/upsolve-contest");
  const row = card(page, "B");
  await row.getByText("Upsolve scheduling", { exact: true }).click();
  await row.getByLabel(/^Priority/).selectOption("high");
  await row
    .getByRole("button", { name: "Save upsolve schedule", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).contests![0].problems[1].upsolve!.priority,
    )
    .toBe("high");
}

test("Learning Memory outcome corrections reopen and complete the same real upsolve durably without rewriting its original contest", async ({
  page,
}) => {
  const original = completed(),
    originalContest = original.contests![0],
    originalRow = originalContest.problems[0],
    originalQueue = originalRow.upsolve!,
    originalAttempt = original.attempts[0];
  await seed(page, original);
  await page.goto(`/problems/${problem("A").id}`);
  await correctOutcome(page, "Not solved yet");
  await expect
    .poll(async () => (await saved(page)).attempts[0].outcome)
    .toBe("unsolved");
  let data = await saved(page);
  const reopened = { ...originalQueue };
  delete reopened.completionId;
  expect(data.contests![0].problems[0].upsolve).toEqual(reopened);
  expect(data.contests![0].endedAt).toBe(originalContest.endedAt);
  expect(data.contests![0].problems[0].reflection).toEqual(
    originalRow.reflection,
  );
  expect(data.problems[0].reviewAt).toBe(original.problems[0].reviewAt);
  for (const key of [
    "id",
    "problemId",
    "startedAt",
    "completedAt",
    "elapsedMs",
    "notes",
    "takeaway",
  ] as const)
    expect(data.attempts[0][key]).toEqual(originalAttempt[key]);
  validateData(data);
  await page.reload();
  await page.goto("/contests");
  await expect(card(page, "A")).toContainText("Queued");
  await expect(
    card(page, "A").getByRole("button", { name: "Start upsolve", exact: true }),
  ).toBeEnabled();
  await page.goto(`/problems/${problem("A").id}`);
  await correctOutcome(page, "Solved independently");
  await expect
    .poll(
      async () =>
        (await saved(page)).contests![0].problems[0].upsolve?.completionId,
    )
    .toBe(originalAttempt.id);
  await page.reload();
  data = await saved(page);
  expect(data.attempts).toHaveLength(1);
  expect(data.attempts[0].outcome).toBe("independent");
  expect(data.contests![0].problems[0].upsolve).toEqual(originalQueue);
  expect(data.contests![0].problems[0].reflection).toEqual(
    originalRow.reflection,
  );
  expect(data.contests![0].problems[0].notes).toBe(originalRow.notes);
  validateData(data);
  await page.goto("/contests");
  await expect(card(page, "A")).toContainText("Later practice recorded");
  await expect(
    card(page, "A").getByRole("button", { name: "Start upsolve", exact: true }),
  ).toHaveCount(0);
});

test("a fifteen-minute daily plan visibly selects high-priority 4B and reload preserves its saved priority evidence", async ({
  page,
}) => {
  await seed(page, queued(true));
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(titles.B);
  await expect(page.locator(".session-card")).toContainText(
    "Saved upsolve priority: high.",
  );
  await expect
    .poll(
      async () =>
        (await currentPlan(page))?.items.find(
          (item) => item.status === "pending",
        )?.identity,
    )
    .toBe("contest:4:B");
  const plan = await currentPlan(page),
    pending = plan.items.filter((item) => item.status === "pending");
  expect(plan.budgetMinutes).toBe(15);
  expect(pending).toHaveLength(1);
  expect(pending[0].problemId).toBe(problem("B").id);
  expect(pending[0].upsolvePriority).toBe("high");
  expect(
    pending[0].evidence.some((evidence) =>
      evidence.label.includes("priority at selection: high"),
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".session-card")).toContainText(titles.B);
  expect(await currentPlan(page)).toEqual(plan);
  const data = await saved(page);
  expect(data.attempts).toHaveLength(0);
  expect(data.session).toBeNull();
  validateData(data);
});

test("a deliberate fifteen-minute 4A choice survives another upsolve gaining high priority through contest scheduling", async ({
  page,
}) => {
  await seed(page, queued(true, false));
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(titles.A);
  await page.getByText("Adjust this suggestion", { exact: true }).click();
  await page.getByLabel(/^Activity timebox/).fill("15");
  await page.getByRole("button", { name: "Save timebox", exact: true }).click();
  await expect
    .poll(async () => (await currentPlan(page))?.items[0].deliberate)
    .toBe(true);
  const choice = (await currentPlan(page)).items[0];
  await raiseB(page);
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(titles.A);
  await page.reload();
  await expect(page.locator(".session-card")).toContainText(titles.A);
  const data = await saved(page),
    plan = await currentPlan(page);
  expect(plan.items.find((item) => item.id === choice.id)).toEqual(choice);
  expect(plan.items.filter((item) => item.status === "pending")).toHaveLength(
    1,
  );
  expect(data.contests![0].problems[1].upsolve!.priority).toBe("high");
  expect(data.attempts).toHaveLength(0);
  expect(data.session).toBeNull();
  validateData(data);
});
