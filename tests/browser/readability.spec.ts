import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { emptyData, localDate, type Data } from "../../src/lib/model";
import { withPracticeSession } from "../../src/lib/practice-session";
import { importTrack, trackContextForEntry } from "../../src/lib/tracks";

const longTitle =
  "A patient two-pointer problem with a deliberately long name and a boundary invariant to remember — " +
  "UnbrokenProblemName".repeat(5);
const trackId = "readability-track";
const stageId = "readability-stage";
const firstEntryId = "readability-first";
const stagePath = `/tracks/${trackId}/stages/${stageId}`;
const routes = [
  "/",
  "/problems",
  "/activity",
  "/progress",
  "/revisit",
  "/settings",
  "/tracks",
  `/tracks/${trackId}`,
  stagePath,
];

function fixture(session = false): Data {
  const now = new Date();
  let data = mergeActivity(
    connectProfile(
      emptyData(),
      { handle: "readability_fixture", rating: 1500, rank: "specialist" },
      now,
    ),
    "readability_fixture",
    [
      {
        handle: "readability_fixture",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 990001,
            submittedAt: now.toISOString(),
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:3501:C1",
              code: "3501C1",
              title: longTitle,
              url: "https://codeforces.com/problemset/problem/3501/C1",
              rating: 1400,
              tags: ["two pointers"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  data = saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: "approach",
      takeaway: "Keep the boundary monotonic and verify the empty-window case.",
      reviewAt: localDate(now),
      overrideSchedule: true,
    },
    now,
  );
  data = importTrack(
    data,
    {
      id: trackId,
      title: "Two pointers for sustained, readable practice",
      sourceName: "readability-fixture.docx",
      sourceFingerprint: "readability-fixture",
      stages: [
        {
          id: stageId,
          title: "Foundation",
          description:
            "Practise clear window invariants with a calm and readable problem list.",
          suggestedTime: "20–30 minutes before hints",
          entries: [
            {
              id: firstEntryId,
              title: longTitle,
              code: "3501C1",
              url: "https://codeforces.com/problemset/problem/3501/C1",
              rating: 1400,
              pattern: "This source hint is hidden until explicitly requested.",
            },
            {
              id: "readability-second",
              title: "A fresh C2 follow-up with a useful invariant",
              code: "3501C2",
              url: "https://codeforces.com/problemset/problem/3501/C2",
              rating: 1500,
              pattern: "Sliding window",
            },
          ],
        },
      ],
    },
    { duplicates: "reject" },
    now,
  );
  data.activeTrackId = trackId;
  if (session) {
    const entry = data.trackEntries!.find(
      (value) => value.id === firstEntryId,
    )!;
    const problem = data.problems.find(
      (value) => value.id === entry.problemId,
    )!;
    data = withPracticeSession(
      data,
      problem,
      30,
      now.getTime(),
      "readability-session",
      false,
      trackContextForEntry(data, firstEntryId) ?? undefined,
    );
    data.session!.runningSince = null;
    data.session!.notes =
      "A useful note that wraps comfortably on a narrow screen.";
  }
  return data;
}

async function seed(page: Page, theme: "light" | "dark", data = fixture()) {
  await page.addInitScript(
    ({ theme, data }) => {
      if (localStorage.getItem("forma.readability-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.readability-fixture", "seeded");
    },
    { theme, data },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (route) =>
    route.fulfill({
      json: {
        handle: "readability_fixture",
        from: 1,
        count: 50,
        submissions: [],
      },
    }),
  );
}
async function open(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-text-size",
    /comfortable|large/,
  );
  await page.evaluate(() => document.fonts.ready);
  const enter = page.locator(".page-enter").first();
  if (await enter.count()) await expect(enter).toHaveCSS("opacity", "1");
}
async function noHorizontalOverflow(page: Page, label: string) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }));
  expect(
    sizes.scroll,
    `${label}: document width ${sizes.width}, content width ${sizes.scroll}`,
  ).toBeLessThanOrEqual(sizes.width + 2);
}
async function typographyAudit(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const root = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const errors: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (
        !parent ||
        !(parent instanceof HTMLElement) ||
        !node.textContent?.trim() ||
        !parent.closest("main, nav, aside, dialog")
      )
        continue;
      const box = parent.getBoundingClientRect(),
        style = getComputedStyle(parent);
      if (
        box.width <= 1 ||
        box.height <= 1 ||
        style.visibility === "hidden" ||
        style.display === "none"
      )
        continue;
      const size = Number.parseFloat(style.fontSize);
      if (size < root * 0.75 - 0.2)
        errors.push(
          `${parent.className || parent.tagName}: ${size}px ${node.textContent.trim().slice(0, 70)}`,
        );
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "nav a, button, input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea",
    )) {
      const box = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      if (box.width <= 1 || box.height <= 1 || style.visibility === "hidden")
        continue;
      if (element.tagName === "BUTTON" && !element.textContent?.trim())
        continue;
      const minimum = element.matches("input,select,textarea")
        ? root
        : root * 0.9375;
      const size = Number.parseFloat(style.fontSize);
      if (size < minimum - 0.2)
        errors.push(
          `control ${element.className || element.tagName}: ${size}px ${element.textContent?.trim().slice(0, 50) || element.getAttribute("aria-label")}`,
        );
    }
    return { root, errors };
  });
  expect(result.errors, `${label}: undersized text`).toEqual([]);
  return result.root;
}

// Resolve transparent backgrounds through their actual ancestor surfaces, then
// composite any foreground alpha. The audit targets HTML text, not chart shapes.
async function contrastAudit(page: Page, label: string) {
  const errors = await page.evaluate(() => {
    type Color = [number, number, number, number];
    const color = (value: string): Color => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (value.startsWith("color(srgb"))
        return [
          values[0] * 255,
          values[1] * 255,
          values[2] * 255,
          values[3] ?? 1,
        ];
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    };
    const over = (front: Color, back: Color): Color => [
      front[0] * front[3] + back[0] * (1 - front[3]),
      front[1] * front[3] + back[1] * (1 - front[3]),
      front[2] * front[3] + back[2] * (1 - front[3]),
      1,
    ];
    const background = (element: HTMLElement): Color => {
      const ancestors: HTMLElement[] = [];
      for (let at: HTMLElement | null = element; at; at = at.parentElement)
        ancestors.unshift(at);
      return ancestors.reduce(
        (base, at) => over(color(getComputedStyle(at).backgroundColor), base),
        [255, 255, 255, 1] as Color,
      );
    };
    const luminance = (value: Color) =>
      value
        .slice(0, 3)
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, channel, index) =>
            sum + channel * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const results: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement;
      if (
        !(parent instanceof HTMLElement) ||
        !node.textContent?.trim() ||
        !parent.closest("main, nav, aside, dialog")
      )
        continue;
      const box = parent.getBoundingClientRect(),
        style = getComputedStyle(parent);
      if (
        box.width <= 1 ||
        box.height <= 1 ||
        style.visibility === "hidden" ||
        parent.closest(
          "button:disabled, input:disabled, select:disabled, textarea:disabled",
        )
      )
        continue;
      const bg = background(parent),
        text = color(style.color);
      text[3] *= Number(style.opacity);
      const foreground = over(text, bg),
        first = luminance(foreground),
        second = luminance(bg);
      const ratio =
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      const large =
        Number.parseFloat(style.fontSize) >= 24 ||
        (Number.parseFloat(style.fontSize) >= 18.66 &&
          Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5) - 0.02)
        results.push(
          `${parent.className || parent.tagName}: ${ratio.toFixed(2)}:1 ${node.textContent.trim().slice(0, 60)}`,
        );
    }
    return [...new Set(results)];
  });
  expect(errors, `${label}: rendered text contrast`).toEqual([]);
}
async function focusVisible(field: Locator) {
  await field.focus();
  const focused = await field.evaluate((element) => {
    const style = getComputedStyle(element);
    const color = (raw: string) => raw.match(/[\d.]+/g)?.map(Number) ?? [];
    let background = color(style.backgroundColor);
    for (
      let parent = element.parentElement;
      parent && background[3] === 0;
      parent = parent.parentElement
    )
      background = color(getComputedStyle(parent).backgroundColor);
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, channel, index) =>
            sum + channel * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const outlineLuminance = luminance(color(style.outlineColor)),
      backgroundLuminance = luminance(background);
    return {
      active: document.activeElement === element,
      outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
      contrast:
        (Math.max(outlineLuminance, backgroundLuminance) + 0.05) /
        (Math.min(outlineLuminance, backgroundLuminance) + 0.05),
    };
  });
  expect(focused.active).toBe(true);
  expect(focused.outline).not.toBe("none");
  expect(focused.width).toBeGreaterThanOrEqual(2);
  expect(focused.color).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.contrast).toBeGreaterThanOrEqual(3);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: every destination has readable typography and contrast with a persisted Large preference`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    await seed(page, theme);
    for (const route of routes) {
      await open(page, route);
      expect(await typographyAudit(page, `${theme} Comfortable ${route}`)).toBe(
        16,
      );
      await contrastAudit(page, `${theme} Comfortable ${route}`);
      await noHorizontalOverflow(page, `${theme} Comfortable ${route}`);
    }
    await open(page, "/");
    await page.screenshot({
      path: `docs/forma-readable-today-${info.project.name}-${theme === "dark" ? "ink" : "light"}.png`,
    });
    await open(page, "/settings");
    await page
      .getByRole("group", { name: "Text size", exact: true })
      .getByRole("button", { name: "Large", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
    await expect(
      page.getByRole("button", { name: "Large", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Large", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const route of routes) {
      await open(page, route);
      expect(await typographyAudit(page, `${theme} Large ${route}`)).toBe(20);
      await contrastAudit(page, `${theme} Large ${route}`);
      await noHorizontalOverflow(page, `${theme} Large ${route}`);
    }
    await open(page, "/settings");
    await page
      .getByRole("group", { name: "Text size", exact: true })
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.screenshot({
      path: `docs/forma-readable-settings-large-${info.project.name}-${theme === "dark" ? "ink" : "light"}.png`,
    });
    const appearance = page.getByRole("group", {
      name: "Appearance",
      exact: true,
    });
    const other = appearance.getByRole("button", {
      name: theme === "light" ? "Ink" : "Warm paper",
      exact: true,
    });
    await other.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      theme === "light" ? "dark" : "light",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
    await page.evaluate(() =>
      Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished),
      ),
    );
    await contrastAudit(page, `${theme} switched theme, selected controls`);
    await page
      .getByRole("button", { name: "Comfortable", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "comfortable",
    );
    await expect(
      page.getByRole("button", { name: "Comfortable", exact: true }),
    ).toBeEnabled();
    await expect(
      page.locator(".text-size-options").getByRole("alert"),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Comfortable", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test(`${theme}: long names, keyboard dialogs, error/hover/focus states and 200% reflow remain usable`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await seed(page, theme);
    await open(page, "/settings");
    await page.getByRole("button", { name: "Large", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
    await page.setViewportSize({
      width: info.project.name === "mobile" ? 320 : 640,
      height: 960,
    });
    await open(page, "/problems");
    await expect(
      page.getByText(longTitle, { exact: true }).first(),
    ).toBeVisible();
    await noHorizontalOverflow(page, `${theme} narrow long names`);
    const add = page.getByRole("button", { name: "Add problem", exact: true });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Problem name", { exact: true }),
    ).toBeFocused();
    await focusVisible(dialog.getByLabel("Problem name", { exact: true }));
    await dialog
      .getByLabel("Problem name", { exact: true })
      .fill("Readable validation example");
    await dialog
      .getByLabel("Problem link optional", { exact: true })
      .fill("mailto:fixture@example.com");
    await dialog
      .getByRole("button", { name: "Add problem", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "http:// or https://",
    );
    await typographyAudit(page, `${theme} dialog and error text`);
    await contrastAudit(page, `${theme} inline error text`);
    await dialog
      .getByRole("button", { name: "Add problem", exact: true })
      .hover();
    await page.evaluate(() =>
      Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished),
      ),
    );
    await contrastAudit(page, `${theme} primary button hover`);
    if (info.project.name === "desktop")
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
    await noHorizontalOverflow(
      page,
      `${theme} ${info.project.name === "desktop" ? "200% CSS zoom" : "320px Large"} dialog`,
    );
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Add problem", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await noHorizontalOverflow(
      page,
      `${theme} ${info.project.name === "desktop" ? "200% CSS zoom" : "320px Large"} problem list`,
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await open(page, stagePath);
    await noHorizontalOverflow(page, `${theme} narrow track stage`);
    await contrastAudit(page, `${theme} track stage`);
  });

  test(`${theme}: a focused session and its reflection keep text and actions readable at Large size`, async ({
    page,
  }) => {
    const data = fixture(true);
    data.settings.textSize = "large";
    await seed(page, theme, data);
    await open(page, "/session");
    await typographyAudit(page, `${theme} focus session`);
    await contrastAudit(page, `${theme} focus session`);
    await noHorizontalOverflow(page, `${theme} focus session`);
    await page
      .getByRole("button", { name: "Finish session", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "How did this attempt feel?",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Needed a hint", exact: true })
      .click();
    await expect(
      page.getByLabel("Proposed revisit date", { exact: true }),
    ).toBeVisible();
    await typographyAudit(page, `${theme} reflection`);
    await contrastAudit(page, `${theme} selected reflection controls`);
    await noHorizontalOverflow(page, `${theme} reflection`);
    const save = page.getByRole("button", {
      name: "Save reflection",
      exact: true,
    });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    await save.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Back to the session", exact: true }),
    ).toBeFocused();
  });
}
