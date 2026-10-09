import { expect, test, type Page } from "@playwright/test";
import { emptyData, type Data } from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { linkLearningAttempts } from "../../src/lib/learning";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-07T04:30:00Z");
const title = "Learning a careful two-pointer boundary";
const trackId = "memory-track";
const stageId = "memory-stage";
const path = `/tracks/${trackId}/stages/${stageId}`;
const spoiler =
  "Spoiler: compare the outer endpoints before changing the invariant.";

function trackFixture(): Data {
  return importTrack(
    emptyData(),
    {
      id: trackId,
      title: "A notebook of two pointers",
      sourceName: "memory-fixture.docx",
      sourceFingerprint: "memory-fixture",
      stages: [
        {
          id: stageId,
          title: "Foundation",
          description: "Keep a useful invariant.",
          suggestedTime: "20 minutes",
          entries: [
            {
              id: "memory-entry",
              title,
              code: "381A",
              url: "https://codeforces.com/problemset/problem/381/A",
              rating: 800,
              pattern: "Hidden two-pointer hint",
            },
          ],
        },
      ],
    },
    { duplicates: "reject" },
    now,
  );
}
function reflectedFixture(): Data {
  const data = trackFixture();
  data.settings.textSize = "large";
  data.problems[0].reviewAt = "2026-10-12";
  data.problems[0].reviewManual = true;
  data.attempts = [
    {
      id: "memory-timed",
      problemId: data.problems[0].id,
      startedAt: "2026-10-06T04:00:00Z",
      completedAt: "2026-10-06T04:05:00Z",
      elapsedMs: 300000,
      outcome: "hint",
      difficulty: "edges",
      takeaway: "Check whether both pointers refer to the same element.",
      notes: spoiler,
      approach: "Keep two inclusive boundaries.",
      mistakes: ["indexing", "edges"],
      mistakeNote: "Counted the final element twice.",
      trackContext: {
        trackId,
        stageId,
        entryId: "memory-entry",
        trackTitle: "A notebook of two pointers",
        stageTitle: "Foundation",
      },
    },
  ];
  return data;
}
async function seed(page: Page, data: Data, theme: "light" | "dark" = "light") {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.memory-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.memory-fixture", "seeded");
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

test("track practice, mistake reflection, Memory edit, written revision and reload keep one coherent notebook", async ({
  page,
}, testInfo) => {
  await seed(page, trackFixture());
  await page.goto(path);
  await page
    .getByRole("button", { name: `Start practice: ${title}`, exact: true })
    .click();
  await page.getByLabel("A place for your thoughts").fill(spoiler);
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await page
    .getByLabel("One thing to remember")
    .fill("Notice the final inclusive boundary sooner.");
  await page.getByText("Add learning details", { exact: false }).click();
  await page
    .getByRole("button", { name: "Off-by-one or indexing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Missed edge case", exact: true })
    .click();
  await page
    .getByLabel("What did you try?", { exact: true })
    .fill("Compare the ends and move only one boundary.");
  await page
    .getByLabel("Where did you get stuck?", { exact: true })
    .fill("I counted one element twice.");
  await page.getByLabel("Proposed revisit date").fill("2026-10-12");
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  const memoryLink = page.getByRole("link", {
    name: "View Learning Memory",
    exact: true,
  });
  const toast = page.locator(".toast");
  await expect(toast).toContainText(
    "Reflection saved. A little sharper than before.",
  );
  if (testInfo.project.name === "mobile") {
    // Exercise the actual mobile overlap, after both entrance animations finish.
    // The notification remains visible; waiting for it to disappear would hide
    // the original mouse-down/mouse-up interception race.
    await page.evaluate(async () => {
      const animations = [
        document.querySelector(".session-complete"),
        document.querySelector(".toast"),
      ].flatMap((node) => node?.getAnimations() ?? []);
      await Promise.all(animations.map((animation) => animation.finished));
    });
    const overlap = await memoryLink.evaluate((link) => {
      const linkBox = link.getBoundingClientRect();
      const toastBox = document
        .querySelector(".toast")!
        .getBoundingClientRect();
      const left = Math.max(linkBox.left, toastBox.left);
      const right = Math.min(linkBox.right, toastBox.right);
      const top = Math.max(linkBox.top, toastBox.top);
      const bottom = Math.min(linkBox.bottom, toastBox.bottom);
      if (left >= right || top >= bottom) return null;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      return {
        x: x - linkBox.left,
        y: y - linkBox.top,
        linkReceivesClick:
          document.elementFromPoint(x, y)?.closest("a") === link,
      };
    });
    expect(
      overlap,
      "the saved-reflection notification covers part of the mobile Memory link",
    ).not.toBeNull();
    expect(overlap!.linkReceivesClick).toBe(true);
    await memoryLink.click({ position: { x: overlap!.x, y: overlap!.y } });
  } else await memoryLink.click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(toast).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await expect(toast).toHaveCount(0);
  const summary = page.getByRole("region", { name: "What your records show" });
  await expect(summary).toContainText(
    "Off-by-one or indexing was marked in 1 reflection.",
  );
  await expect(
    page.getByRole("link", { name: "Back to track", exact: true }),
  ).toHaveAttribute("href", path);
  await page.getByRole("button", { name: /^Edit reflection:/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Off-by-one or indexing", exact: true }),
  ).toBeHidden();
  await dialog.getByText("Add learning details", { exact: false }).click();
  await dialog
    .getByRole("button", { name: "Off-by-one or indexing", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save reflection changes", exact: true })
    .click();
  await expect(summary).not.toContainText("Off-by-one or indexing was marked");
  await page
    .getByRole("button", {
      name: "Explain the approach or invariant",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText(spoiler, { exact: true })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Reveal previous notes", exact: true })
    .click();
  await expect(dialog.getByText(spoiler, { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Hide previous notes", exact: true })
    .click();
  await dialog
    .getByLabel("Explain what makes the approach work")
    .fill("The remaining interval contains exactly the unchosen elements.");
  await dialog.getByLabel("My recall cue").fill("Name the remaining interval.");
  await dialog
    .getByRole("button", { name: "Needed a cue", exact: true })
    .click();
  await expect(dialog.getByLabel("Next recall date")).toHaveValue("2026-10-10");
  await dialog.getByLabel("Next recall date").fill("2026-10-11");
  await dialog
    .getByRole("button", { name: "Save recall check", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let saved = await durable(page);
  expect(saved.attempts).toHaveLength(1);
  expect(saved.attempts[0].mistakes).toEqual(["edges"]);
  expect(saved.revisions).toHaveLength(1);
  expect(saved.revisions![0]).toMatchObject({
    activity: "explain",
    outcome: "cue",
    nextReviewAt: "2026-10-11",
  });
  expect(saved.problems[0].reviewAt).toBe("2026-10-12");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "What your records show" }),
  ).toContainText("Needed a cue");
  await page
    .getByRole("button", {
      name: "Recall complexity and edge cases",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("My recall cue")).toHaveValue(
    "Name the remaining interval.",
  );
  await dialog
    .getByLabel("Recall the complexity and important edge cases")
    .fill(
      "O(n) time, O(1) space; a single remaining element needs one selection.",
    );
  await dialog
    .getByRole("button", { name: "Recalled independently", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "No further recall", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save recall check", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  saved = await durable(page);
  expect(saved.revisions).toHaveLength(2);
  expect(saved.revisions!.at(-1)!.nextReviewAt).toBeNull();
  expect(saved.attempts).toHaveLength(1);
  expect(saved.codeforces.submissions).toHaveLength(0);
  expect(saved.problems[0].reviewAt).toBe("2026-10-12");
});

test("re-solving shows recorded difficulties and a scoped cue while previous solution notes wait for reveal", async ({
  page,
}) => {
  const data = reflectedFixture();
  data.revisions = [
    {
      id: "prior-cue",
      problemId: data.problems[0].id,
      handle: null,
      activity: "explain",
      outcome: "cue",
      response: "A shrinking interval.",
      cue: "Name the remaining interval.",
      completedAt: "2026-10-06T05:00:00.000Z",
      nextReviewAt: null,
    },
  ];
  await seed(page, data);
  await page.goto(`/problems/${encodeURIComponent(data.problems[0].id)}`);
  await page
    .getByRole("button", { name: "Re-solve the problem", exact: true })
    .click();
  await expect(page).toHaveURL(/\/session$/);
  const preparation = page.getByRole("region", { name: "Before you re-solve" });
  await expect(preparation).toContainText("Off-by-one or indexing");
  await expect(preparation).toContainText(
    "Your cue: Name the remaining interval.",
  );
  await expect(preparation.getByText(spoiler, { exact: true })).toBeHidden();
  await preparation.getByText("Reveal previous notes", { exact: true }).click();
  await expect(preparation.getByText(spoiler, { exact: true })).toBeVisible();
  const saved = await durable(page);
  expect(saved.attempts).toHaveLength(1);
  expect(saved.revisions).toHaveLength(1);
  expect(saved.session?.phase).toBe("focus");
});

test("a failed recall commit retains the draft and explicit retry writes one revision without false success", async ({
  page,
}) => {
  const data = reflectedFixture();
  await seed(page, data);
  await page.goto(
    `/problems/${encodeURIComponent(data.problems[0].id)}?revision=explain&from=${encodeURIComponent("/revisit")}`,
  );
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Explain what makes the approach work")
    .fill("Every chosen value leaves a smaller unchosen interval.");
  await dialog
    .getByRole("button", { name: "Recalled independently", exact: true })
    .click();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const transaction = original.call(this, names, mode, options);
      const stores = typeof names === "string" ? [names] : [...names];
      if (
        armed &&
        this.name === "forma-workspaces" &&
        mode === "readwrite" &&
        stores.includes("workspaces") &&
        stores.includes("recoveries")
      ) {
        armed = false;
        const read = transaction
          .objectStore("workspaces")
          .get("__memory_abort__");
        read.onsuccess = () => transaction.abort();
      }
      return transaction;
    };
  });
  await dialog
    .getByRole("button", { name: "Save recall check", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Recall was not committed",
  );
  await expect(
    dialog.getByLabel("Explain what makes the approach work"),
  ).toHaveValue("Every chosen value leaves a smaller unchosen interval.");
  expect((await durable(page)).revisions).toHaveLength(0);
  await expect(
    page.getByText("Recall saved. Your coding reattempt date is unchanged.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Explain what makes the approach work")
    .fill(
      "Edited after the failed write: the interval contains only unchosen values.",
    );
  await dialog
    .getByRole("button", { name: "Retry recall save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await durable(page);
  expect(saved.revisions).toHaveLength(1);
  expect(saved.revisions![0].response).toContain(
    "Edited after the failed write",
  );
  expect(saved.problems[0].reviewAt).toBe("2026-10-12");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Your learning history" }),
  ).toContainText("Edited after the failed write");
});

test("linked source editing keeps one event and explicit archived profile history stays separate", async ({
  page,
}) => {
  let data = reflectedFixture();
  const personalId = data.problems[0].id;
  for (const [handle, id] of [
    ["memory_alpha", 91201],
    ["memory_beta", 91202],
  ] as const) {
    data = mergeActivity(
      connectProfile(data, { handle, rating: 1400, rank: "specialist" }, now),
      handle,
      [
        {
          handle,
          from: 1,
          count: 50,
          submissions: [
            {
              id,
              submittedAt: now.toISOString(),
              verdict: "OK",
              language: "GNU C++20",
              problem: {
                key: "contest:381:A",
                title,
                code: "381A",
                url: "https://codeforces.com/problemset/problem/381/A",
                rating: 800,
                tags: [],
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
      data.codeforces.practiceAttempts.find(
        (attempt) => attempt.handle === handle,
      )!.id,
      {
        outcome: "editorial",
        difficulty: null,
        takeaway:
          handle === "memory_alpha"
            ? "Archived alpha takeaway"
            : "Current beta takeaway",
        reviewAt: null,
        overrideSchedule: true,
        mistakes: [handle === "memory_alpha" ? "numeric" : "complexity"],
      },
      now,
    );
  }
  const alpha = data.codeforces.practiceAttempts.find(
    (attempt) => attempt.handle === "memory_alpha",
  )!;
  data = linkLearningAttempts(
    data,
    data.attempts[0].id,
    alpha.id,
    "timed",
    now,
  );
  await seed(page, data);
  await page.goto(`/problems/${encodeURIComponent(personalId)}`);
  await expect(
    page
      .getByRole("region", { name: "Your learning history" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "What your records show" }),
  ).toContainText("Current beta takeaway");
  await expect(
    page.getByText("Archived alpha takeaway", { exact: true }),
  ).toHaveCount(0);
  await page.goto(
    `/problems/${encodeURIComponent(alpha.problemId)}?from=${encodeURIComponent("javascript:alert(1)")}`,
  );
  await expect(
    page.getByText(
      "You are viewing the archived memory_alpha profile explicitly.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to problems", exact: true }),
  ).toHaveAttribute("href", "/problems");
  await expect(
    page
      .getByRole("region", { name: "Your learning history" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByText("Original source records", { exact: false }).click();
  await page
    .getByRole("button", { name: "Use imported reflection", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "What your records show" }),
  ).toContainText("Archived alpha takeaway");
  expect((await durable(page)).learningLinks![0].reflectionSource).toBe(
    "codeforces",
  );
  expect((await durable(page)).attempts).toHaveLength(1);
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Your learning history" })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "What your records show" }),
  ).toContainText("Overflow or numeric type was marked in 1 reflection.");
});

for (const theme of ["light", "dark"] as const)
  test(`Memory and recall remain readable in ${theme}, Large text and reduced motion`, async ({
    page,
  }, testInfo) => {
    const data = reflectedFixture();
    data.problems[0].title =
      title + " — " + "LongUnbrokenProblemName".repeat(5);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, data, theme);
    await page.goto(
      `/problems/${encodeURIComponent(data.problems[0].id)}?from=${encodeURIComponent(path)}`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-text-size",
      "large",
    );
    await expect(
      page.getByRole("heading", { name: data.problems[0].title, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/forma-memory-${testInfo.project.name}-${theme}-large.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", {
        name: "Explain the approach or invariant",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Explain what makes the approach work"),
    ).toBeFocused();
    const controls = await dialog
      .locator("input, textarea, button")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.getClientRects().length)
          .map((element) => parseFloat(getComputedStyle(element).fontSize)),
      );
    expect(Math.min(...controls)).toBeGreaterThanOrEqual(18);
    await dialog
      .getByRole("button", { name: "Save recall check", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/forma-recall-${testInfo.project.name}-${theme}-large.png`,
      fullPage: false,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
