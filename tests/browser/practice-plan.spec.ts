import { expect, test, type Page } from "@playwright/test";
import { emptyData, type Data, type Problem } from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";
import { saveRevision } from "../../src/lib/memory";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-08T06:30:00Z");
const codingTitle =
  "A careful boundary in a very long sequence of equal values";
const recallTitle = "Remembering a shrinking interval";
const problem = (id: string, title: string, reviewAt: string): Problem => ({
  id,
  title,
  platform: "LeetCode",
  url: "",
  problemCode: "",
  tags: ["arrays"],
  rating: null,
  createdAt: "2026-10-01T06:30:00.000Z",
  reviewAt,
  reviewCount: 0,
});

function fixture(): Data {
  let data: Data = {
    ...emptyData(),
    problems: [
      problem("coding-due", codingTitle, "2026-10-07"),
      problem("recall-due", recallTitle, "2026-10-20"),
    ],
  };
  data = importTrack(
    data,
    {
      id: "plan-track",
      title: "Foundation with deliberate practice and careful boundaries",
      sourceName: "manual",
      sourceFingerprint: "plan-browser",
      stages: [
        {
          id: "plan-stage",
          title: "Foundation",
          description: "",
          suggestedTime: "Source suggests 25 minutes",
          entries: ["4A", "5A"].map((code, index) => ({
            id: `plan-entry-${index}`,
            title: `Foundation problem ${code}`,
            code,
            url: "",
            rating: null,
            pattern: "Hidden solution hint",
          })),
        },
      ],
    },
    undefined,
    now,
  );
  data = saveRevision(data, {
    id: "prior-recall",
    problemId: "recall-due",
    handle: null,
    activity: "explain",
    outcome: "cue",
    response: "Name the interval.",
    cue: "The unchosen elements.",
    completedAt: "2026-10-07T06:30:00.000Z",
    nextReviewAt: "2026-10-08",
  });
  data.settings.practicePreferences = {
    dailyMinutes: 60,
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    mode: "mixed",
    targetDate: null,
  };
  return data;
}
async function seed(
  page: Page,
  data = fixture(),
  theme: "light" | "dark" = "light",
) {
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.plan-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.plan-fixture", "seeded");
    },
    { data, theme },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
}
async function saved(page: Page): Promise<{ revision: number; data: Data }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            transaction = db.transaction("workspaces"),
            read = transaction.objectStore("workspaces").get("personal");
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => db.close();
        };
      }),
  );
}
const currentPlan = async (page: Page) =>
  (await saved(page)).data.practicePlans!.find(
    (plan) => plan.day === "2026-10-08",
  )!;
async function availability(page: Page, minutes: number) {
  await page.locator('input[name="availableMinutes"]').fill(String(minutes));
  await page
    .getByRole("button", { name: "Apply today’s time", exact: true })
    .click();
  await expect
    .poll(async () => (await currentPlan(page)).budgetMinutes)
    .toBe(minutes);
}
async function abortNextSave(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const transaction = original.call(this, names, mode, options);
      const stores = typeof names === "string" ? [names] : Array.from(names);
      if (
        armed &&
        this.name === "forma-workspaces" &&
        mode === "readwrite" &&
        stores.includes("recoveries")
      ) {
        armed = false;
        transaction.objectStore("workspaces").get("__plan_abort__").onsuccess =
          () => transaction.abort();
      }
      return transaction;
    };
  });
}

test("availability, saved unfinished coding, recall, reload, Memory and Progress form one plan", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(codingTitle);
  await expect(
    page.locator(".today-primary .button.primary:visible"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Then, if time remains" }),
  ).toBeVisible();
  await availability(page, 7);
  const selected = await currentPlan(page);
  expect(
    selected.items.filter((item) => item.status === "pending"),
  ).toHaveLength(1);
  expect(
    selected.items.find((item) => item.status === "pending")!.timeboxMinutes,
  ).toBe(7);
  expect(
    (await saved(page)).data.settings.practicePreferences!.dailyMinutes,
  ).toBe(60);
  await page.reload();
  expect(await currentPlan(page)).toEqual(selected);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page).toHaveURL(/\/session/);
  expect((await saved(page)).data.session!.targetMinutes).toBe(7);
  await page
    .getByLabel("A place for your thoughts")
    .fill("Keep the two boundaries separate.");
  await page.clock.runFor(60000);
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Not solved yet", exact: true })
    .click();
  await page
    .getByLabel("One thing to remember")
    .fill("An unfinished attempt is still useful practice.");
  await page.getByLabel("Proposed revisit date").fill("2026-10-15");
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(page.locator(".session-complete")).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByText("Saved activity in this plan · 1", { exact: true }),
  ).toBeVisible();
  let data = (await saved(page)).data;
  expect(data.attempts).toHaveLength(1);
  expect(data.attempts[0].outcome).toBe("unsolved");
  expect(data.codeforces.submissions).toHaveLength(0);
  expect(
    data.practicePlans![0].items.filter((item) => item.status === "completed"),
  ).toHaveLength(1);
  await availability(page, 40);
  await expect(page.locator(".session-card")).toContainText(recallTitle);
  await page
    .getByRole("link", { name: "Start recall check", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Explain what makes the approach work")
    .fill("The interval contains exactly the remaining values.");
  await dialog
    .getByRole("button", { name: "Recalled independently", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "No further recall", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save recall check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByText("Saved activity in this plan · 2", { exact: true }),
  ).toBeVisible();
  await page.reload();
  data = (await saved(page)).data;
  expect(data.attempts).toHaveLength(1);
  expect(data.revisions).toHaveLength(2);
  expect(data.problems.find((p) => p.id === "recall-due")!.reviewAt).toBe(
    "2026-10-20",
  );
  await page
    .getByText("Saved activity in this plan · 2", { exact: true })
    .click();
  await page
    .getByRole("link", { name: "View saved record", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "What your records show" }),
  ).toContainText("Not solved yet");
  await page.goto("/progress");
  await expect(
    page.getByRole("region", { name: "Useful observations" }),
  ).toContainText("recall");
});

test("skip, deliberate deferral, ending and optional continuation never fabricate activity", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await page.getByText("Adjust this suggestion", { exact: true }).click();
  await page
    .getByRole("button", { name: "Skip today’s recommendation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await currentPlan(page)).items.filter(
          (item) => item.status === "skipped",
        ).length,
    )
    .toBe(1);
  await page.getByText("Defer deliberately", { exact: true }).click();
  await page.getByLabel("Try again on").fill("2026-10-13");
  await page
    .getByRole("button", { name: "Save deferral", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await currentPlan(page)).items.filter(
          (item) => item.status === "deferred",
        ).length,
    )
    .toBe(1);
  const originals = (await saved(page)).data;
  await page
    .getByRole("button", { name: "End today’s plan", exact: true })
    .click();
  await expect.poll(async () => (await currentPlan(page)).status).toBe("ended");
  await page.reload();
  await expect(page.locator(".session-card")).toContainText("set aside");
  await page
    .getByRole("button", {
      name: "Continue with an optional extra",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await currentPlan(page)).status)
    .toBe("active");
  const data = (await saved(page)).data;
  expect(data.attempts).toEqual(originals.attempts);
  expect(data.revisions).toEqual(originals.revisions);
  expect(data.problems).toEqual(originals.problems);
  expect(
    data.practicePlans![0].items.filter((item) => item.status === "completed"),
  ).toHaveLength(0);
});

test("an aborted availability write retains the draft and retry saves one stable plan", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeEnabled();
  const original = await currentPlan(page);
  await page.locator('input[name="availableMinutes"]').fill("12");
  await abortNextSave(page);
  await page
    .getByRole("button", { name: "Apply today’s time", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saving plan", exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[name="availableMinutes"]')).toHaveValue(
    "12",
  );
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeDisabled();
  expect(await currentPlan(page)).toEqual(original);
  await page
    .getByRole("button", { name: "Retry saving plan", exact: true })
    .click();
  await expect
    .poll(async () => (await currentPlan(page)).budgetMinutes)
    .toBe(12);
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeEnabled();
  const record = await saved(page);
  await page.clock.runFor(65000);
  expect((await saved(page)).revision).toBe(record.revision);
  expect(record.data.practicePlans).toHaveLength(1);
  expect(record.data.attempts).toHaveLength(0);
});

test("an aborted planned start retries the original session binding without duplicate history", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await availability(page, 7);
  const original = await currentPlan(page);
  await abortNextSave(page);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saving plan", exact: true }),
  ).toBeVisible();
  expect((await saved(page)).data.session).toBeNull();
  expect(await currentPlan(page)).toEqual(original);
  await page
    .getByRole("button", { name: "Retry saving plan", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Continue session", exact: true }),
  ).toBeVisible();
  const data = (await saved(page)).data;
  expect(data.session!.targetMinutes).toBe(7);
  expect(data.practicePlans).toHaveLength(1);
  expect(
    data.practicePlans![0].items.filter(
      (item) => item.sessionId === data.session!.id,
    ),
  ).toHaveLength(1);
  expect(data.attempts).toHaveLength(0);
  await page.reload();
  expect((await saved(page)).data.session!.id).toBe(data.session!.id);
  await page
    .getByRole("link", { name: "Continue session", exact: true })
    .click();
  await expect(page).toHaveURL(/\/session/);
});

test("saved manual practice in another tab completes the matching planned identity once", async ({
  page,
  context,
}) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(codingTitle);
  const second = await context.newPage();
  await second.clock.install({ time: now });
  await second.goto("/problems/coding-due");
  await second
    .getByRole("button", { name: "Re-solve the problem", exact: true })
    .click();
  await expect(second).toHaveURL(/\/session/);
  await expect(
    page.getByRole("link", { name: "Continue session", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await second
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await second
    .getByLabel("One thing to remember")
    .fill("Saved on the other tab, once.");
  await second
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(second.locator(".session-complete")).toBeVisible();
  await expect(
    page.getByText("Saved activity in this plan · 1", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-card")).toContainText(recallTitle);
  const data = (await saved(page)).data;
  expect(data.attempts).toHaveLength(1);
  expect(data.attempts[0].takeaway).toBe("Saved on the other tab, once.");
  expect(
    data.practicePlans![0].items.filter((item) => item.status === "completed"),
  ).toHaveLength(1);
  await page.reload();
  expect((await saved(page)).data.attempts).toEqual(data.attempts);
});

test("an actual session crossing midnight keeps its timer and supplies both plans with one saved attempt", async ({
  page,
}) => {
  await seed(page);
  await page.clock.setSystemTime("2026-10-08T23:59:50+05:30");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page).toHaveURL(/\/session/);
  const session = (await saved(page)).data.session!;
  await page.clock.runFor(11000);
  await expect
    .poll(async () =>
      (await saved(page)).data.practicePlans!.some(
        (plan) => plan.day === "2026-10-09",
      ),
    )
    .toBe(true);
  expect((await saved(page)).data.session).toEqual(session);
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Not solved yet", exact: true })
    .click();
  await page
    .getByLabel("One thing to remember")
    .fill("A single overnight practice record.");
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(page.locator(".session-complete")).toBeVisible();
  const data = (await saved(page)).data;
  expect(data.attempts).toHaveLength(1);
  expect(data.attempts[0].id).toBe(session.id);
  for (const day of ["2026-10-08", "2026-10-09"]) {
    const plan = data.practicePlans!.find((plan) => plan.day === day)!;
    expect(
      plan.items.filter((item) => item.completion?.recordId === session.id),
    ).toHaveLength(1);
  }
  await page.goto("/");
  await expect(
    page.getByText("Saved activity in this plan · 1", { exact: true }),
  ).toBeVisible();
});

test("a coding schedule changed in another tab invalidates pending evidence with a visible explanation", async ({
  page,
  context,
}) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".session-card")).toContainText(codingTitle);
  const second = await context.newPage();
  await second.clock.install({ time: now });
  await second.goto("/revisit");
  // The revisit list uses one due coding row in this fixture.
  await second
    .getByRole("button", { name: "Reschedule", exact: true })
    .first()
    .click();
  await second
    .getByRole("dialog")
    .getByLabel("Revisit date", { exact: true })
    .fill("2026-10-18");
  await second
    .getByRole("dialog")
    .getByRole("button", { name: "Save date", exact: true })
    .click();
  await expect(second.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await currentPlan(page)).items.some(
        (item) => item.problemId === "coding-due" && item.status === "stale",
      ),
    )
    .toBe(true);
  await expect(page.locator(".session-card")).toContainText(recallTitle);
  await page.getByText("Plan updates", { exact: true }).click();
  await expect(
    page.getByText(/schedule or eligible track order changed/i).first(),
  ).toBeVisible();
  expect((await saved(page)).data.attempts).toHaveLength(0);
});

test("a new user can change optional preferences while today keeps its separate availability", async ({
  page,
}) => {
  await seed(page, emptyData());
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Add my first problem", exact: true }),
  ).toBeVisible();
  await availability(page, 10);
  await page.goto("/settings");
  await page.getByLabel(/Usual daily time budget/).fill("45");
  await page.getByLabel("Sunday", { exact: true }).uncheck();
  await page.getByLabel(/Target date/).fill("2027-02-01");
  await page
    .getByRole("button", { name: "Save practice preferences", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).data.settings.practicePreferences?.dailyMinutes,
    )
    .toBe(45);
  await page.reload();
  await expect(page.getByLabel(/Usual daily time budget/)).toHaveValue("45");
  await page.goto("/");
  await expect(page.locator('input[name="availableMinutes"]')).toHaveValue(
    "10",
  );
  const data = (await saved(page)).data;
  expect(data.settings.practicePreferences!.preferredDays).not.toContain(0);
  expect(data.settings.practicePreferences!.targetDate).toBe("2027-02-01");
  expect(data.attempts).toHaveLength(0);
  expect(data.revisions ?? []).toHaveLength(0);
  await expect(
    page.getByRole("region", { name: "A gentle return" }),
  ).toHaveCount(0);
});

test("failed practice preferences retain typed choices and retry without changing today’s override", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await availability(page, 12);
  await page.goto("/settings");
  await page.getByLabel(/Usual daily time budget/).fill("45");
  await page.getByLabel(/Target date/).fill("2027-03-01");
  await page.getByLabel("Sunday", { exact: true }).uncheck();
  await abortNextSave(page);
  await page
    .getByRole("button", { name: "Save practice preferences", exact: true })
    .click();
  await expect(page.getByText(/Preferences were not committed/)).toBeVisible();
  await expect(page.getByLabel(/Usual daily time budget/)).toHaveValue("45");
  await expect(page.getByLabel(/Target date/)).toHaveValue("2027-03-01");
  expect(
    (await saved(page)).data.settings.practicePreferences!.dailyMinutes,
  ).toBe(60);
  await page
    .getByRole("button", {
      name: "Retry saving practice preferences",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).data.settings.practicePreferences!.dailyMinutes,
    )
    .toBe(45);
  const data = (await saved(page)).data;
  expect(data.settings.practicePreferences!.preferredDays).not.toContain(0);
  expect(data.settings.practicePreferences!.targetDate).toBe("2027-03-01");
  expect(data.practicePlans![0].budgetMinutes).toBe(12);
  expect(data.attempts).toHaveLength(0);
});

test("returning from saved practice offers a short day without resetting learning history", async ({
  page,
}) => {
  const data = fixture();
  data.revisions = [];
  data.attempts = [
    {
      id: "before-break",
      problemId: "coding-due",
      startedAt: "2026-09-28T06:00:00.000Z",
      completedAt: "2026-09-28T06:30:00.000Z",
      elapsedMs: 1800000,
      outcome: "hint",
      difficulty: null,
      takeaway: "Keep my earlier learning.",
      notes: "Saved practice before the break.",
    },
  ];
  await seed(page, data);
  await page.goto("/");
  const welcome = page.getByRole("region", { name: "A gentle return" });
  await expect(welcome).toContainText(
    "Welcome back. Start with one short session?",
  );
  await welcome
    .getByRole("button", { name: "Make today 15 minutes", exact: true })
    .click();
  await expect
    .poll(async () => (await currentPlan(page)).budgetMinutes)
    .toBe(15);
  expect(
    (await saved(page)).data.settings.practicePreferences!.dailyMinutes,
  ).toBe(60);
  expect((await saved(page)).data.attempts).toEqual(data.attempts);
  await page.reload();
  expect((await saved(page)).data.attempts).toEqual(data.attempts);
  await welcome
    .getByRole("button", { name: "Continue normally", exact: true })
    .click();
  await expect(welcome).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`Today stays readable with Large text, long titles and reduced motion in ${theme}`, async ({
    page,
  }, info) => {
    const data = fixture();
    data.settings.textSize = "large";
    await seed(page, data, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (info.project.name === "mobile")
      await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Start session", exact: true }),
    ).toBeEnabled();
    await page.getByText("Why this activity?", { exact: true }).click();
    await page.locator('input[name="availableMinutes"]').focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Apply today’s time", exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (info.project.name === "mobile") {
      await page.locator(".page-footer").scrollIntoViewIfNeeded();
      const footer = await page.locator(".page-footer").boundingBox();
      const navigation = await page.locator(".mobile-nav").boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(navigation!.y);
      await page.evaluate(() => scrollTo(0, 0));
    }
    await page.screenshot({
      path: `docs/forma-plan-${info.project.name}-large-${theme === "dark" ? "ink" : "light"}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}
