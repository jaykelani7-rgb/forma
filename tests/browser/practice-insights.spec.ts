import { expect, test, type Page } from "@playwright/test";
import { connectProfile, mergeActivity } from "../../src/lib/codeforces";
import { linkLearningAttempts } from "../../src/lib/learning";
import {
  learningEvidenceHref,
  memoryRecordAnchor,
} from "../../src/lib/learning-insights";
import {
  emptyData,
  validateData,
  type Attempt,
  type Data,
  type Problem,
} from "../../src/lib/model";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-08T04:30:00.000Z");
const title =
  "A patient interval problem with a deliberately long supporting title — " +
  "UnbrokenIntervalName".repeat(4);
const personalId = "insight-personal";
const alpha = "insight_alpha";
const beta = "insight_beta";

function problem(id: string, code: string, tags: string[]): Problem {
  return {
    id,
    title: id === personalId ? title : "An untouched tagged follow-up",
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/${code.match(/^\d+/)?.[0]}/${code.replace(/^\d+/, "")}`,
    problemCode: code,
    tags,
    rating: 800,
    createdAt: "2026-10-01T04:30:00.000Z",
    reviewAt: null,
    reviewCount: 0,
  };
}
function timed(
  id: string,
  day: number,
  outcome: Attempt["outcome"],
  extra: Partial<Attempt> = {},
): Attempt {
  return {
    id,
    problemId: personalId,
    startedAt: `2026-10-0${day}T04:20:00.000Z`,
    completedAt: `2026-10-0${day}T04:30:00.000Z`,
    elapsedMs: 600000,
    outcome,
    difficulty: null,
    notes: `Saved source notes for ${id}.`,
    takeaway: "Keep the remaining interval explicit.",
    mistakes: ["edges"],
    ...extra,
  };
}
function addProfile(data: Data, handle: string, submissionId: number): Data {
  return mergeActivity(
    connectProfile(data, { handle, rating: null, rank: null }, now),
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id: submissionId,
            submittedAt: "2026-10-06T04:30:00.000Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              code: "381A",
              title,
              url: problem(personalId, "381A", []).url,
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
function fixture(): Data {
  let data = addProfile(
    {
      ...emptyData(),
      problems: [
        problem(personalId, "381A", ["two pointers"]),
        problem("insight-untouched", "279B", ["binary search"]),
      ],
      attempts: [
        timed("insight-first", 6, "hint"),
        timed("insight-second", 7, "independent"),
        timed("insight-archived-timed", 7, "editorial", {
          mistakes: ["numeric"],
          notes: "Archived measured source retained separately.",
        }),
      ],
    },
    alpha,
    1,
  );
  data = linkLearningAttempts(
    data,
    "insight-archived-timed",
    data.codeforces.practiceAttempts.find((item) => item.handle === alpha)!.id,
    "timed",
    now,
  );
  data = addProfile(data, beta, 2);
  data = {
    ...data,
    problems: data.problems.map((item) =>
      item.id === personalId
        ? {
            ...item,
            reviewAt: "2026-10-08",
            reviewManual: true,
            reviewUpdatedAt: now.toISOString(),
          }
        : item,
    ),
    revisions: [
      {
        id: "insight-alpha-recall",
        problemId: personalId,
        handle: alpha,
        activity: "explain",
        outcome: "cue",
        response: "Archived profile recall: explain which endpoints remain.",
        cue: "Which positions are still available?",
        completedAt: "2026-10-07T05:00:00.000Z",
        nextReviewAt: "2026-10-08",
      },
      {
        id: "insight-beta-recall",
        problemId: personalId,
        handle: beta,
        activity: "complexity",
        outcome: "independent",
        response: "Current profile recall: each endpoint moves at most once.",
        cue: "Count each pointer move.",
        completedAt: "2026-10-07T06:00:00.000Z",
        nextReviewAt: "2026-10-10",
      },
    ],
    settings: { ...data.settings, textSize: "large" },
  };
  return validateData(data);
}
async function seed(
  page: Page,
  data = fixture(),
  theme: "light" | "dark" = "light",
) {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.practice-insights-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.practice-insights-fixture", "seeded");
    },
    { data, theme },
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
        const request = indexedDB.open("forma-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
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
async function customPeriod(
  page: Page,
  from = "2026-10-06",
  through = "2026-10-07",
) {
  await page
    .getByLabel("Learning period", { exact: true })
    .selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("Through", { exact: true }).fill(through);
}

test("selected dates expose repeated explicit labels and open the exact saved source without changing the plan", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/progress");
  await customPeriod(page);
  const insights = page.getByRole("region", {
    name: "Useful observations",
    exact: true,
  });
  const repeated = insights
    .getByRole("heading", {
      name: "Labels you recorded more than once",
      exact: true,
    })
    .locator("..");
  await expect(repeated).toContainText("2026-10-06 through 2026-10-07");
  await expect(repeated).toContainText("2 reflected coding records considered");
  const label = repeated
    .locator("summary")
    .filter({ hasText: "Missed edge case" });
  await label.focus();
  await page.keyboard.press("Enter");
  await expect(label.locator("..")).toHaveAttribute("open", "");
  const links = repeated.getByRole("link", { name: title, exact: true });
  await expect(links).toHaveCount(2);
  const before = await durable(page);
  await links.nth(1).click();
  const anchor = memoryRecordAnchor("practice", "timed:insight-first");
  await expect(page.locator(`[id="${anchor}"]`)).toBeVisible();
  await expect(page.locator(`[id="${anchor}"]`)).toBeInViewport();
  await expect(page.locator(`[id="${anchor}"]`)).toContainText(
    "Saved source notes for insight-first.",
  );
  expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(anchor);
  await expect(
    page.getByText(
      "Read-only evidence for personal practice. The connected profile is unchanged.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Re-solve the problem", exact: true }),
  ).toBeDisabled();
  const after = await durable(page);
  expect(after.attempts).toEqual(before.attempts);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.practicePlans ?? []).toEqual(before.practicePlans ?? []);
  expect(after.codeforces.connectedHandle).toBe(beta);
  await page.goto("/progress");
  await customPeriod(page, "2026-10-07", "2026-10-07");
  await expect(
    page.getByRole("heading", {
      name: "Labels you recorded more than once",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("profile-scoped Progress links an archived personal recall source in a read-only view and keeps timed chart credit isolated", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/progress");
  await customPeriod(page);
  await expect(
    page.getByRole("combobox", { name: "Learning profile", exact: true }),
  ).toHaveValue(beta);
  const chart = page.getByRole("img", {
    name: /Week of .*sessions.*Flexible goal/,
  });
  await expect(chart).toHaveAttribute(
    "aria-label",
    /Week of Oct 5: 2 sessions/,
  );
  const insights = page.getByRole("region", {
    name: "Useful observations",
    exact: true,
  });
  await expect(insights).toContainText("1 saved written-recall check");
  await expect(insights).toContainText("0 due written-recall schedules");
  await page
    .getByRole("combobox", { name: "Learning profile", exact: true })
    .selectOption(alpha);
  await expect(chart).toHaveAttribute(
    "aria-label",
    /Week of Oct 5: 3 sessions/,
  );
  await expect(insights).toContainText("1 due written-recall schedule");
  const revision = insights
    .getByRole("heading", { name: "Revision to return to", exact: true })
    .locator("..");
  await revision
    .locator("summary")
    .filter({ hasText: "View recent recall outcomes" })
    .click();
  const href = learningEvidenceHref(
    personalId,
    "revision",
    "insight-alpha-recall",
    alpha,
  );
  const link = revision.locator(`a[href="${href}"]`).last();
  await expect(link).toBeVisible();
  const before = await durable(page);
  await link.click();
  const record = page.locator(
    `[id="${memoryRecordAnchor("revision", "insight-alpha-recall")}"]`,
  );
  await expect(record).toBeVisible();
  await expect(record).toBeInViewport();
  await expect(record).toContainText(
    "Archived profile recall: explain which endpoints remain.",
  );
  await expect(
    page.getByText(
      `Read-only evidence for ${alpha}. The connected profile is unchanged.`,
    ),
  ).toBeVisible();
  await expect(
    page.locator(
      `[id="${memoryRecordAnchor("revision", "insight-beta-recall")}"]`,
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Explain the approach or invariant",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Recall complexity and edge cases",
      exact: true,
    }),
  ).toBeDisabled();
  await page.reload();
  await expect(record).toContainText(
    "Archived profile recall: explain which endpoints remain.",
  );
  const after = await durable(page);
  expect(after.codeforces.connectedHandle).toBe(beta);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.attempts).toEqual(before.attempts);
  expect(after.practicePlans ?? []).toEqual(before.practicePlans ?? []);
});

test("unknown evidence profiles show an honest read-only fallback rather than changing the active profile", async ({
  page,
}) => {
  await seed(page);
  await page.goto(
    `/problems/${personalId}?profile=unknown_fixture&revision=explain&from=%2Fprogress`,
  );
  await expect(
    page.getByText(
      "The requested learning profile is not saved in this workspace. Showing this problem’s usual history in a read-only view.",
    ),
  ).toBeVisible();
  await expect(
    page.locator(
      `[id="${memoryRecordAnchor("revision", "insight-beta-recall")}"]`,
    ),
  ).toContainText("Current profile recall:");
  await expect(
    page.locator(
      `[id="${memoryRecordAnchor("revision", "insight-alpha-recall")}"]`,
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Explain the approach or invariant",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await durable(page)).codeforces.connectedHandle).toBe(beta);
});

for (const theme of ["light", "dark"] as const) {
  test(`Progress observations remain readable in ${theme}, Large text, reduced motion and a narrow layout`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, fixture(), theme);
    await page.goto("/progress");
    await customPeriod(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
    const insights = page.getByRole("region", {
      name: "Useful observations",
      exact: true,
    });
    await insights.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const repeated = insights
      .getByRole("heading", {
        name: "Labels you recorded more than once",
        exact: true,
      })
      .locator("..");
    const label = repeated
      .locator("summary")
      .filter({ hasText: "Missed edge case" });
    await label.focus();
    await page.keyboard.press("Enter");
    await expect(label.locator("..")).toHaveAttribute("open", "");
    const link = repeated
      .getByRole("link", { name: title, exact: true })
      .first();
    await link.focus();
    await expect(link).toBeFocused();
    expect(
      await link.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).not.toBe("none");
    await insights.screenshot({
      path: `docs/forma-plan-progress-${testInfo.project.name}-${theme}-large.png`,
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
    }));
    expect(overflow.content).toBeLessThanOrEqual(overflow.width + 2);
    await label.focus();
    await page.keyboard.press("Enter");
    await expect(label.locator("..")).not.toHaveAttribute("open", "");
    expect((await durable(page)).attempts).toHaveLength(3);
  });
}
