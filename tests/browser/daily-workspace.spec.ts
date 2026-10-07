import { expect, test, type Page } from "@playwright/test";
import type { Data } from "../../src/lib/model";
import { dailyFixture, dailyHandle } from "../fixtures/daily-workspace";

test.use({ timezoneId: "Asia/Kolkata" });
const beforeMidnight = "2026-10-06T23:59:50+05:30";
const yesterday = new Date("2026-10-06T12:00:00+05:30");
const followingDay = "2026-10-07T12:00:00+05:30";

async function seed(page: Page) {
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.daily-fixture")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "dark");
    localStorage.setItem("forma.daily-fixture", "seeded");
  }, dailyFixture(yesterday));
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: followingDay, stale: false, problems: [] },
    }),
  );
}

async function saved(page: Page): Promise<{ revision: number; data: Data }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("workspaces")
            .objectStore("workspaces")
            .get("personal");
          read.onsuccess = () => {
            resolve(read.result);
            database.close();
          };
          read.onerror = () => {
            reject(read.error);
            database.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

function summary(page: Page) {
  return page.locator(".cf-today-summary");
}
async function expectNewDay(page: Page) {
  await expect(summary(page)).toContainText(
    "4 of 4 in today’s reflection batch",
  );
  await expect
    .poll(async () =>
      (await saved(page)).data.codeforces.reflectionBatches?.some(
        (batch) => batch.handle === dailyHandle && batch.date === "2026-10-07",
      ),
    )
    .toBe(true);
}

test("an open tab crossing local midnight selects the next batch without a page reload", async ({
  page,
}) => {
  await seed(page);
  await page.clock.install({ time: "2026-10-06T23:59:45+05:30" });
  await page.goto("/");
  await expect(summary(page)).toContainText(
    "2 of 5 in today’s reflection batch",
  );
  await page.clock.pauseAt(beforeMidnight);
  await page.evaluate(() => {
    document.documentElement.setAttribute(
      "data-overnight-instance",
      "original-tab",
    );
  });
  await page.clock.runFor(11000);
  await expectNewDay(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-overnight-instance",
    "original-tab",
  );
  const revision = (await saved(page)).revision;
  await page.clock.runFor(60000);
  expect((await saved(page)).revision).toBe(revision);
});

test("a suspended tab returning visible on another day reconciles once", async ({
  page,
}) => {
  await seed(page);
  await page.clock.install({ time: yesterday });
  await page.goto("/");
  await expect(summary(page)).toContainText(
    "2 of 5 in today’s reflection batch",
  );
  await page.clock.pauseAt("2026-10-06T12:01:00+05:30");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.setSystemTime(followingDay);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectNewDay(page);
  const revision = (await saved(page)).revision;
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1000);
  expect((await saved(page)).revision).toBe(revision);
});

test("returning from the demo on the following day initializes the personal workspace batch", async ({
  page,
}) => {
  await seed(page);
  await page.clock.install({ time: yesterday });
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Explore the demo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Go to my workspace", exact: true }),
  ).toBeVisible();
  await page.clock.setSystemTime(followingDay);
  await page
    .getByRole("button", { name: "Go to my workspace", exact: true })
    .click();
  // Workspace switches intentionally return to Today, where the reconciled
  // personal data must appear; Settings' demo button is no longer on screen.
  await expectNewDay(page);
  expect((await saved(page)).data.codeforces.connectedHandle).toBe(dailyHandle);
});
