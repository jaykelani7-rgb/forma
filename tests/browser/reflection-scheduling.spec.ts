import { expect, test, type Page } from "@playwright/test";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { addDays, emptyData, type Data } from "../../src/lib/model";
import type { SubmissionInput } from "../../src/lib/codeforces-types";

test.use({ timezoneId: "Asia/Kolkata" });
const morning = new Date("2026-10-07T04:30:00.000Z");
const title = "A second look at the invariant";
const handle = "schedule_fixture";

function submission(id: number, time: Date): SubmissionInput {
  return {
    id,
    submittedAt: time.toISOString(),
    verdict: "OK",
    language: "GNU C++20",
    problem: {
      key: "contest:1100:A",
      title,
      code: "1100A",
      url: "https://codeforces.com/problemset/problem/1100/A",
      rating: 1200,
      tags: ["implementation"],
    },
  };
}

function oldPractice(): Data {
  const oldTime = addDays(morning, -7);
  let data = mergeActivity(
    connectProfile(
      emptyData(),
      { handle, rating: 1400, rank: "specialist" },
      oldTime,
    ),
    handle,
    [{ handle, from: 1, count: 50, submissions: [submission(101, oldTime)] }],
    "refresh",
    oldTime,
  );
  data = saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Name the invariant.",
      reviewAt: "2026-10-07",
      overrideSchedule: false,
    },
    oldTime,
  );
  return data;
}

async function seed(page: Page, data: Data) {
  await page.clock.install({ time: morning });
  await page.clock.setFixedTime(morning);
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.scheduling-fixture")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "dark");
    localStorage.setItem("forma.scheduling-fixture", "seeded");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: morning.toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    return route.fulfill({
      json:
        action === "profile"
          ? { handle, rating: 1400, rank: "specialist" }
          : {
              handle,
              from: 1,
              count: 50,
              submissions: [
                submission(102, new Date(morning.getTime() + 60 * 60_000)),
                submission(101, addDays(morning, -7)),
              ],
            },
    });
  });
}

async function stored(page: Page): Promise<Data | null> {
  return page.evaluate(
    () =>
      new Promise<Data | null>((resolve, reject) => {
        const opened = indexedDB.open("forma-workspaces", 1);
        opened.onsuccess = () => {
          const request = opened.result
            .transaction("workspaces")
            .objectStore("workspaces")
            .get("personal");
          request.onsuccess = () => {
            resolve(request.result?.data ?? null);
            opened.result.close();
          };
          request.onerror = () => reject(request.error);
        };
        opened.onerror = () => reject(opened.error);
      }),
  );
}

async function saveDialog(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("completed revisit does not suppress a new assisted attempt's dialog default or erase its later opt-out", async ({
  page,
}) => {
  await seed(page, oldPractice());
  await page.goto("/revisit");
  await page
    .getByRole("button", { name: "Complete this revisit", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewCompletedAt)
    .toBe(morning.toISOString());
  await page.clock.setFixedTime(new Date(morning.getTime() + 2 * 60 * 60_000));
  await page.goto("/activity");
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page))?.codeforces.practiceAttempts.length)
    .toBe(2);
  await page
    .getByRole("button", { name: `Reflect: ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Used a hint", exact: true })
    .click();
  await expect(dialog.getByLabel("Proposed revisit date")).toHaveValue(
    "2026-10-12",
  );
  await saveDialog(page);
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewAt)
    .toBe("2026-10-12");
  await page
    .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "No revisit", exact: true })
    .click();
  await saveDialog(page);
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewAt)
    .toBeNull();
  await page
    .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Used the editorial", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Proposed revisit date"),
  ).toHaveCount(0);
  await saveDialog(page);
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewManual)
    .toBe(true);
  await page
    .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "No revisit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("dialog").getByLabel("Proposed revisit date"),
  ).toHaveCount(0);
});

test("new assisted dialog preserves a deliberately scheduled date", async ({
  page,
}) => {
  const data = oldPractice();
  data.problems[0].reviewAt = "2026-11-10";
  data.problems[0].reviewManual = true;
  await seed(page, data);
  await page.clock.setFixedTime(new Date(morning.getTime() + 2 * 60 * 60_000));
  await page.goto("/activity");
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page))?.codeforces.practiceAttempts.length)
    .toBe(2);
  await page
    .getByRole("button", { name: `Reflect: ${title}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Used a hint", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Proposed revisit date"),
  ).toHaveValue("2026-11-10");
  await saveDialog(page);
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewAt)
    .toBe("2026-11-10");
});

test("editing an older dialog keeps the newer reflection's schedule", async ({
  page,
}) => {
  let data = oldPractice();
  data = mergeActivity(
    data,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [submission(102, new Date(morning.getTime() - 60_000))],
      },
    ],
    "refresh",
    morning,
  );
  const latest = data.codeforces.practiceAttempts.find((attempt) =>
    attempt.submissionIds.includes(102),
  )!;
  data = saveQuickReflection(
    data,
    latest.id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Newer reflection.",
      reviewAt: "2026-10-12",
      overrideSchedule: false,
    },
    morning,
  );
  await seed(page, data);
  await page.goto("/activity");
  await page
    .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Used the editorial", exact: true })
    .click();
  await expect(dialog).toContainText(
    "A newer reflected attempt sets this problem’s revisit",
  );
  await expect(dialog.getByLabel("Proposed revisit date")).toHaveCount(0);
  await saveDialog(page);
  await expect
    .poll(async () => (await stored(page))?.problems[0].reviewAt)
    .toBe("2026-10-12");
});

test("a failed reflection write keeps dialog input and never claims it was saved", async ({
  page,
}) => {
  const data = mergeActivity(
    oldPractice(),
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [submission(102, new Date(morning.getTime() - 60_000))],
      },
    ],
    "refresh",
    morning,
  );
  await seed(page, data);
  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (
        this.name === "workspaces" &&
        localStorage.getItem("forma.fail-reflection") === "armed"
      ) {
        localStorage.setItem("forma.fail-reflection", "failed");
        throw new DOMException("Fixture write failure", "QuotaExceededError");
      }
      return originalPut.apply(this, args);
    };
  });
  await page.goto("/activity");
  await page
    .getByRole("button", { name: `Reflect: ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Used a hint", exact: true })
    .click();
  await dialog
    .getByLabel(/One thing to remember/)
    .fill("Keep this takeaway until the write can be recovered.");
  await page.evaluate(() =>
    localStorage.setItem("forma.fail-reflection", "armed"),
  );
  await dialog
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Reflection was not committed",
  );
  await expect(dialog.getByRole("alert")).toContainText(
    "recovery copies in Settings",
  );
  await expect(dialog.getByLabel(/One thing to remember/)).toHaveValue(
    "Keep this takeaway until the write can be recovered.",
  );
  await expect(
    dialog.getByRole("button", { name: "Save reflection", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/Reflection saved\./)).toHaveCount(0);
  expect((await stored(page))?.codeforces.reflections).toEqual(
    data.codeforces.reflections,
  );
});
