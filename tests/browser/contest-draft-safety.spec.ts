import { expect, test, type Page } from "@playwright/test";
import { emptyData, type Data, type Problem } from "../../src/lib/model";
import { connectProfile, mergeActivity } from "../../src/lib/codeforces";
import {
  createContest,
  startContest,
  endContest,
  reconcileContests,
} from "../../src/lib/contest-lab";

const now = new Date("2026-10-08T06:30:00Z");
const after = (ms: number) => new Date(now.getTime() + ms);
function fixture(count = 2, ended = false, duration = 30): Data {
  const problems: Problem[] = Array.from({ length: count }, (_, i) => ({
    id: `draft-problem-${i}`,
    title: `Draft safety problem ${i + 1}`,
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/4/${String.fromCharCode(65 + i)}`,
    problemCode: `4${String.fromCharCode(65 + i)}`,
    rating: 1200,
    tags: [],
    createdAt: now.toISOString(),
    reviewAt: null,
    reviewCount: 0,
  }));
  let data = connectProfile(
    { ...emptyData(), problems },
    { handle: "fixture_user", rating: 1400, rank: "specialist" },
    now,
  );
  data = startContest(
    createContest(
      data,
      "draft-safety",
      "Draft safety contest",
      duration,
      problems,
      false,
      "manual",
      now,
    ),
    "draft-safety",
    now,
  );
  return ended ? endContest(data, "draft-safety", "early", now) : data;
}
async function freeze(page: Page, at = now) {
  await page.clock.install({ time: at });
  await page.clock.pauseAt(new Date(at.getTime() + 1000));
}
async function seed(page: Page, data: Data, at = now) {
  await freeze(page, at);
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.draft-safety-seed")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "light");
    localStorage.setItem("forma.draft-safety-seed", "yes");
  }, data);
  await page.goto("/contests/draft-safety");
  await expect(
    page.getByRole("heading", { name: "Draft safety contest", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", {
        name: data.contests![0].endedAt
          ? "Reflect on this problem"
          : "Finish early",
        exact: true,
      })
      .first(),
  ).toBeEnabled();
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
const notes = (page: Page) =>
  page.locator('textarea[aria-label="Scratch notes"]:visible');

test("rapid problem changes and early finish capture both note drafts before the debounce", async ({
  page,
}) => {
  await seed(page, fixture());
  await notes(page).fill("First problem’s last thought.");
  await page.getByLabel("Current problem").selectOption("draft-safety:1");
  await notes(page).fill("Second problem’s last thought.");
  await page.getByRole("button", { name: "Finish early", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish contest", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finished early", exact: true }),
  ).toBeVisible();
  const data = await saved(page);
  expect(data.contests![0].problems.map((p) => p.notes)).toEqual([
    "First problem’s last thought.",
    "Second problem’s last thought.",
  ]);
  expect(data.attempts).toHaveLength(0);
  await page.reload();
  const disclosures = page.getByText("Contest scratch notes", { exact: true });
  await disclosures.nth(0).click();
  await disclosures.nth(1).click();
  await expect(
    page.getByText("First problem’s last thought.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Second problem’s last thought.", { exact: true }),
  ).toBeVisible();
});

test("deadline expiry preserves scratch text typed less than 600 ms before the transition", async ({
  page,
}) => {
  await seed(page, fixture(1, false, 5));
  await page.clock.fastForward(298800);
  await notes(page).fill("Captured just before the deadline.");
  await page.clock.runFor(300);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Time ended", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await saved(page)).contests![0].problems[0].notes)
    .toBe("Captured just before the deadline.");
  const data = await saved(page);
  expect(data.contests![0].endedAt).toBe(after(300000).toISOString());
  expect(data.attempts).toHaveLength(0);
});

test("cross-tab scratch notes follow untouched saved values and block divergent drafts until an explicit choice", async ({
  page,
  context,
}) => {
  await seed(page, fixture(1));
  const other = await context.newPage();
  await freeze(other);
  await other.goto("/contests/draft-safety");
  await expect(notes(other)).toBeVisible();
  await notes(other).fill("Saved in another tab.");
  await other
    .getByRole("button", { name: "Save scratch notes", exact: true })
    .click();
  await expect(notes(page)).toHaveValue("Saved in another tab.");

  await notes(page).fill("My divergent scratch draft.");
  await notes(other).fill("Newer saved scratch notes.");
  await other
    .getByRole("button", { name: "Save scratch notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Keep my scratch notes", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(1000);
  expect((await saved(page)).contests![0].problems[0].notes).toBe(
    "Newer saved scratch notes.",
  );
  await expect(notes(page)).toHaveValue("My divergent scratch draft.");
  await page
    .getByRole("button", { name: "Keep my scratch notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save scratch notes", exact: true })
    .click();
  await expect(notes(other)).toHaveValue("My divergent scratch draft.");

  await notes(page).fill("A second local draft.");
  await notes(other).fill("Saved text chosen deliberately.");
  await other
    .getByRole("button", { name: "Save scratch notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use saved scratch notes", exact: true })
    .click();
  await expect(notes(page)).toHaveValue("Saved text chosen deliberately.");
  expect((await saved(page)).contests![0].problems[0].notes).toBe(
    "Saved text chosen deliberately.",
  );
});

test("overall fields merge independently and closing a divergent reflection retains an unconfirmed draft", async ({
  page,
  context,
}) => {
  await seed(page, fixture(1, true));
  const other = await context.newPage();
  await freeze(other);
  await other.goto("/contests/draft-safety");
  await expect(other.getByLabel("Where did time go?")).toBeVisible();
  await page
    .getByLabel("What went well?")
    .fill("My careful statement reading.");
  await other
    .getByLabel("Where did time go?")
    .fill("Another tab recorded debugging time.");
  await other
    .getByRole("button", { name: "Save overall review", exact: true })
    .click();
  await expect(page.getByLabel("Where did time go?")).toHaveValue(
    "Another tab recorded debugging time.",
  );
  await page
    .getByRole("button", { name: "Save overall review", exact: true })
    .click();
  await expect(other.getByLabel("What went well?")).toHaveValue(
    "My careful statement reading.",
  );
  expect((await saved(page)).contests![0].review).toMatchObject({
    wentWell: "My careful statement reading.",
    lostTime: "Another tab recorded debugging time.",
  });

  await page.getByLabel("What went well?").fill("A local replacement.");
  await other.getByLabel("What went well?").fill("A saved replacement.");
  await other
    .getByRole("button", { name: "Save overall review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use saved overall review", exact: true })
    .click();
  await expect(page.getByLabel("What went well?")).toHaveValue(
    "A saved replacement.",
  );

  await page
    .getByRole("button", { name: "Reflect on this problem", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Reflect on this problem", exact: true })
    .click();
  await page
    .getByLabel("Takeaway", { exact: true })
    .fill("My unconfirmed reflection.");
  await other
    .getByLabel("Takeaway", { exact: true })
    .fill("Another tab’s unconfirmed reflection.");
  await other
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Use saved reflection draft",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use saved reflection draft", exact: true })
    .click();
  await expect(page.getByLabel("Takeaway", { exact: true })).toHaveValue(
    "Another tab’s unconfirmed reflection.",
  );
  await page
    .getByLabel("Takeaway", { exact: true })
    .fill("A final draft captured on close.");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const data = await saved(page);
  expect(data.contests![0].problems[0].reflectionDraft?.takeaway).toBe(
    "A final draft captured on close.",
  );
  expect(data.contests![0].problems[0].reflection).toBeUndefined();
});

test("an imported wrong-answer submission counts as attempted without a manual status change", async ({
  page,
}) => {
  let data = endContest(fixture(1), "draft-safety", "early", after(600000));
  data = reconcileContests(
    mergeActivity(
      data,
      "fixture_user",
      [
        {
          handle: "fixture_user",
          from: 1,
          count: 50,
          submissions: [
            {
              id: 777,
              submittedAt: after(300000).toISOString(),
              verdict: "WRONG_ANSWER",
              language: "GNU C++20",
              problem: {
                key: "contest:4:A",
                title: "Draft safety problem 1",
                code: "4A",
                url: "https://codeforces.com/problemset/problem/4/A",
                rating: 1200,
                tags: [],
              },
            },
          ],
        },
      ],
      "refresh",
      after(700000),
    ),
    after(700000),
  );
  await seed(page, data, after(700000));
  await expect(
    page.getByText("Attempted · unfinished", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/1 attempted, unfinished/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Submission #777/ }),
  ).toBeVisible();
  expect((await saved(page)).contests![0].problems[0].status).toBe(
    "not-started",
  );
});
