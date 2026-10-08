import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectProfile, mergeActivity } from "../../src/lib/codeforces";
import {
  completeRevisit,
  emptyData,
  rescheduleProblem,
  type Data,
  type Problem,
} from "../../src/lib/model";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-07T04:30:00.000Z");
const title = "Remember the window boundary";

function imported(): Data {
  return mergeActivity(
    connectProfile(
      emptyData(),
      { handle: "memory_fixture", rating: null, rank: null },
      now,
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
            submittedAt: now.toISOString(),
            verdict: "WRONG_ANSWER",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              title,
              code: "381A",
              url: "https://codeforces.com/problemset/problem/381/A",
              rating: 800,
              tags: ["two pointers"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
}

function timed(): Data {
  const data = emptyData();
  data.problems = [
    {
      id: "memory-personal",
      title,
      platform: "Codeforces",
      url: "https://codeforces.com/problemset/problem/381/A",
      problemCode: "381A",
      rating: 800,
      tags: [],
      createdAt: now.toISOString(),
      reviewAt: null,
      reviewCount: 0,
    },
  ];
  data.session = {
    id: "memory-session",
    problemId: data.problems[0].id,
    startedAt: new Date(now.getTime() - 90_000).toISOString(),
    runningSince: null,
    elapsedMs: 90_000,
    targetMinutes: 30,
    notes: "An earlier thought about the left endpoint.",
    timerVisible: true,
    phase: "reflection",
  };
  return data;
}

async function seed(page: Page, data: Data, fail = false) {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ({ data, fail }) => {
      if (!localStorage.getItem("forma.memory-reflection-fixture")) {
        localStorage.setItem("forma.personal.v1", JSON.stringify(data));
        localStorage.setItem("forma.theme", "light");
        localStorage.setItem("forma.memory-reflection-fixture", "seeded");
      }
      if (fail) {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (
            this.name === "workspaces" &&
            localStorage.getItem("forma.memory-write-failure") === "armed"
          ) {
            localStorage.removeItem("forma.memory-write-failure");
            throw new DOMException(
              "An isolated memory fixture write failure",
              "QuotaExceededError",
            );
          }
          return original.apply(this, args);
        };
      }
    },
    { data, fail },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
}

async function durable(page: Page): Promise<Data> {
  return page.evaluate(
    () =>
      new Promise<Data>((resolve, reject) => {
        const open = indexedDB.open("forma-workspaces", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction("workspaces")
            .objectStore("workspaces")
            .get("personal");
          read.onsuccess = () => {
            resolve(read.result.data);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
}

async function learningDetails(form: Locator) {
  await form.getByText("Add learning details", { exact: false }).click();
  await form
    .getByRole("button", { name: "Off-by-one or indexing", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Missed edge case", exact: true })
    .click();
  await form
    .getByLabel("What did you try?", { exact: true })
    .fill("Move the endpoints while keeping the window sum.");
  await form
    .getByLabel("Where did you get stuck?", { exact: true })
    .fill("I moved the left pointer before checking an empty window.");
  await form
    .getByLabel(/One thing to remember/)
    .fill("Check the empty window before advancing.");
}

test("imported verdicts stay unclassified and optional multiple labels can be edited and removed after reload", async ({
  page,
}) => {
  const data = imported();
  data.settings.textSize = "large";
  await seed(page, data);
  await page.goto("/activity");
  await page
    .getByRole("button", { name: `Reflect: ${title}`, exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Off-by-one or indexing", exact: true }),
  ).toBeHidden();
  expect((await durable(page)).codeforces.reflections).toEqual([]);
  await dialog
    .getByRole("button", { name: "Still need to understand it", exact: true })
    .click();
  await learningDetails(dialog);
  await dialog.getByRole("button", { name: "No revisit", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  let saved = (await durable(page)).codeforces.reflections[0];
  expect(saved.mistakes).toEqual(["indexing", "edges"]);
  expect(saved.mistakeNote).toContain("empty window");
  expect(saved.approach).toContain("endpoints");
  await page.reload();
  await page
    .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Off-by-one or indexing", exact: true }),
  ).toBeHidden();
  await dialog.getByText("Add learning details", { exact: false }).click();
  const indexing = dialog.getByRole("button", {
    name: "Off-by-one or indexing",
    exact: true,
  });
  await expect(indexing).toHaveAttribute("aria-pressed", "true");
  await indexing.focus();
  await page.keyboard.press("Space");
  await expect(indexing).toHaveAttribute("aria-pressed", "false");
  await dialog
    .getByRole("button", { name: "Missed edge case", exact: true })
    .click();
  await dialog.getByLabel("Where did you get stuck?", { exact: true }).fill("");
  await dialog.getByLabel("What did you try?", { exact: true }).fill("");
  await dialog
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  saved = (await durable(page)).codeforces.reflections[0];
  expect(saved.mistakes).toEqual([]);
  expect(saved.mistakeNote).toBe("");
  expect(saved.approach).toBe("");
  expect((await durable(page)).codeforces.practiceAttempts).toHaveLength(1);
  await page
    .getByRole("link", { name: `Learning Memory: ${title}`, exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/problems/${encodeURIComponent(data.problems[0].id)}\\?from=%2Factivity$`,
    ),
  );
});

test("timed reflection keeps measured notes and records optional learning details without requiring them", async ({
  page,
}) => {
  await seed(page, timed());
  await page.goto("/session");
  await expect(
    page.getByRole("button", { name: "Off-by-one or indexing", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await learningDetails(page.locator(".reflection-form"));
  await page.getByRole("button", { name: "No revisit", exact: true }).click();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(page.locator(".session-complete")).toBeVisible();
  const data = await durable(page);
  expect(data.attempts).toHaveLength(1);
  expect(data.attempts[0].mistakes).toEqual(["indexing", "edges"]);
  expect(data.attempts[0].elapsedMs).toBe(90_000);
  expect(data.attempts[0].notes).toContain("left endpoint");
  expect(data.session).toBeNull();
});

for (const source of ["timed", "imported"] as const) {
  test(`${source} failed reflection preserves editable learning details and retries one stable record`, async ({
    page,
  }) => {
    const data = source === "timed" ? timed() : imported();
    await seed(page, data, true);
    await page.goto(source === "timed" ? "/session" : "/activity");
    if (source === "imported")
      await page
        .getByRole("button", { name: `Reflect: ${title}`, exact: true })
        .click();
    const form =
      source === "timed"
        ? page.locator(".reflection-form")
        : page.getByRole("dialog");
    await form
      .getByRole("button", {
        name: source === "timed" ? "Needed a hint" : "Used a hint",
        exact: true,
      })
      .click();
    await learningDetails(form);
    await form.getByRole("button", { name: "No revisit", exact: true }).click();
    await page.evaluate(() =>
      localStorage.setItem("forma.memory-write-failure", "armed"),
    );
    await form
      .getByRole("button", { name: "Save reflection", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "Reflection was not committed",
    );
    await expect(
      form.getByLabel("What did you try?", { exact: true }),
    ).toHaveValue("Move the endpoints while keeping the window sum.");
    await expect(
      form.getByRole("button", { name: "Off-by-one or indexing", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect((await durable(page)).attempts).toHaveLength(0);
    expect((await durable(page)).codeforces.reflections).toHaveLength(0);
    await form
      .getByLabel("Where did you get stuck?", { exact: true })
      .fill("A clearer explanation after the failed save.");
    await form
      .getByRole("button", { name: "Retry saving reflection", exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    if (source === "timed")
      await expect(page.locator(".session-complete")).toBeVisible();
    else await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await durable(page);
    const records =
      source === "timed" ? saved.attempts : saved.codeforces.reflections;
    expect(records).toHaveLength(1);
    expect(records[0].mistakes).toEqual(["indexing", "edges"]);
    expect(records[0].mistakeNote).toBe(
      "A clearer explanation after the failed save.",
    );
    await page.reload();
    const restored = await durable(page);
    expect(
      source === "timed" ? restored.attempts : restored.codeforces.reflections,
    ).toEqual(records);
  });
}

for (const completed of [false, true]) {
  test(`imported reflection displays and preserves a matching personal ${completed ? "completed coding revisit" : "manual coding date"} until deliberate override`, async ({
    page,
  }) => {
    let data = imported();
    const original = data.problems[0];
    const personal: Problem = {
      id: "canonical-personal",
      title,
      platform: original.platform,
      url: original.url,
      problemCode: original.problemCode,
      tags: [],
      rating: original.rating,
      createdAt: now.toISOString(),
      reviewAt: null,
      reviewCount: 0,
    };
    data = { ...data, problems: [...data.problems, personal] };
    const manualAt = new Date(now.getTime() + 60_000);
    data = completed
      ? completeRevisit(data, personal.id, manualAt)
      : rescheduleProblem(data, personal.id, "2026-10-20", manualAt);
    await seed(page, data);
    await page.clock.setFixedTime(new Date(now.getTime() + 120_000));
    await page.goto("/activity");
    await page
      .getByRole("button", { name: `Reflect: ${title}`, exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Used a hint", exact: true })
      .click();
    if (completed) {
      await expect(
        dialog.getByText("Keeping your completed coding revisit.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(dialog.getByLabel("Proposed revisit date")).toHaveCount(0);
    } else
      await expect(dialog.getByLabel("Proposed revisit date")).toHaveValue(
        "2026-10-20",
      );
    await dialog
      .getByRole("button", { name: "Save reflection", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect((await durable(page)).problems).toEqual(data.problems);
    await page
      .getByRole("button", { name: `Edit reflection: ${title}`, exact: true })
      .click();
    dialog = page.getByRole("dialog");
    if (completed)
      await dialog
        .getByRole("button", { name: "Suggest a revisit", exact: true })
        .click();
    await dialog.getByLabel("Proposed revisit date").fill("2026-10-16");
    await dialog
      .getByRole("button", { name: "Save reflection", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const saved = await durable(page);
    expect(
      saved.problems.find((problem) => problem.id === original.id)?.reviewAt,
    ).toBe("2026-10-16");
    expect(
      saved.problems.find((problem) => problem.id === personal.id),
    ).toEqual(data.problems.find((problem) => problem.id === personal.id));
    expect(saved.codeforces.reflections).toHaveLength(1);
  });
}
