import { expect, test, type Page } from "@playwright/test";
import { emptyData, type Data, type Problem } from "../../src/lib/model";
import { connectProfile } from "../../src/lib/codeforces";
import {
  createContest,
  startContest,
  endContest,
  editContest,
} from "../../src/lib/contest-lab";
const now = new Date("2026-10-08T06:30:00Z");
const title = "A careful boundary in a very long sequence of equal values";
const problem: Problem = {
  id: "contest-problem",
  title,
  platform: "Codeforces",
  url: "https://codeforces.com/problemset/problem/4/A",
  problemCode: "4A",
  rating: 1200,
  tags: ["SECRET_TWO_POINTERS"],
  createdAt: now.toISOString(),
  reviewAt: null,
  reviewCount: 0,
};
function fixture() {
  return connectProfile(
    { ...emptyData(), problems: [problem] },
    { handle: "fixture_user", rating: 1400, rank: "specialist" },
    now,
  );
}
async function seed(
  page: Page,
  data = fixture(),
  theme: "light" | "dark" = "light",
) {
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.contest-seed")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.contest-seed", "yes");
    },
    { data, theme },
  );
  await page.route("**/api/catalogue", (r) =>
    r.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (r) =>
    r.fulfill({
      json: { handle: "fixture_user", rating: 1400, rank: "specialist" },
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
async function create(page: Page) {
  await page.goto("/contests");
  await page
    .getByRole("button", { name: "Create a contest", exact: true })
    .click();
  await page.getByLabel("Contest name").fill("Boundary practice");
  await page.getByLabel("Duration in minutes").fill("30");
  await page.getByLabel("Problem count", { exact: true }).fill("1");
  await page.getByRole("checkbox", { name: new RegExp(title) }).check();
  await page.getByRole("button", { name: "Save contest setup" }).click();
  await expect(
    page.getByRole("button", { name: "Start contest", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit setup", exact: true }).click();
  await expect(page.getByLabel("Duration in minutes")).toHaveValue("30");
  await page.getByRole("button", { name: "Save contest setup" }).click();
  await expect(
    page.getByRole("button", { name: "Start contest", exact: true }),
  ).toBeVisible();
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: "Start contest", exact: true })
    .click();
  await expect(page.getByRole("timer")).toBeVisible();
}
async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish early", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish contest", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finished early", exact: true }),
  ).toBeVisible();
}
async function abortNextSave(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = original.call(this, names, mode, options),
        stores = typeof names === "string" ? [names] : Array.from(names);
      if (
        armed &&
        this.name === "forma-workspaces" &&
        mode === "readwrite" &&
        stores.includes("recoveries")
      ) {
        armed = false;
        tx.objectStore("workspaces").get("__contest_abort__").onsuccess = () =>
          tx.abort();
      }
      return tx;
    };
  });
}

test("create → notes → reload → frozen finish → sync → reflect → upsolve → separate Memory record", async ({
  page,
}) => {
  await seed(page);
  await create(page);
  await expect(
    page.getByText("SECRET_TWO_POINTERS", { exact: false }),
  ).toHaveCount(0);
  await start(page);
  await page.getByLabel("Your status", { exact: true }).selectOption("working");
  await page
    .getByLabel("Scratch notes", { exact: true })
    .fill("Keep the interval half-open.");
  await page.getByRole("button", { name: "Save scratch notes" }).click();
  await expect
    .poll(async () => (await saved(page)).contests![0].problems[0].notes)
    .toBe("Keep the interval half-open.");
  await page.clock.fastForward(600000);
  await page.reload();
  await expect(page.getByLabel("Scratch notes")).toHaveValue(
    "Keep the interval half-open.",
  );
  await finish(page);
  const ended = (await saved(page)).contests![0].endedAt;
  await page.route("**/api/codeforces?**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json:
        url.searchParams.get("action") === "profile"
          ? { handle: "fixture_user", rating: 1400, rank: "specialist" }
          : {
              handle: "fixture_user",
              from: Number(url.searchParams.get("from")),
              count: 50,
              submissions: [
                {
                  id: 200,
                  submittedAt: new Date(now.getTime() + 300000).toISOString(),
                  verdict: "OK",
                  language: "GNU C++20",
                  problem: {
                    key: "contest:4:A",
                    title,
                    code: "4A",
                    url: problem.url,
                    rating: 1200,
                    tags: ["SECRET_TWO_POINTERS"],
                  },
                },
              ],
            },
    });
  });
  await page.getByRole("button", { name: "Sync contest evidence" }).click();
  await expect(
    page.getByText("Platform accepted in contest window", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reflect on this problem" }).click();
  await page.getByLabel("Learning outcome").selectOption("hint");
  await page
    .getByLabel("Takeaway", { exact: true })
    .fill("Contest pressure hid the invariant.");
  await page.getByRole("button", { name: "Save contest reflection" }).click();
  await page.getByText("Add to upsolve queue", { exact: true }).click();
  await page.getByLabel("Suggested coding date (optional)").fill("2026-10-08");
  await page
    .getByRole("button", { name: "Queue upsolve", exact: true })
    .click();
  await expect
    .poll(
      async () => (await saved(page)).contests![0].problems[0].upsolve?.state,
    )
    .toBe("queued");
  await page.goto("/contests");
  await page.getByRole("button", { name: "Start upsolve" }).click();
  await expect(page.getByLabel("A place for your thoughts")).toBeVisible();
  await page
    .getByLabel("A place for your thoughts")
    .fill("Later, a fresh derivation.");
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        !!(await saved(page)).contests![0].problems[0].upsolve?.completionId,
    )
    .toBe(true);
  const d = await saved(page);
  expect(d.attempts).toHaveLength(1);
  expect(d.contests![0].endedAt).toBe(ended);
  expect(d.contests![0].problems[0].reflection?.outcome).toBe("hint");
  await page.goto(`/problems/${problem.id}`);
  await expect(
    page.getByRole("heading", {
      name: "Contest reflection · Boundary practice",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Contest pressure hid the invariant.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Your learning history" })
      .getByText("Later, a fresh derivation.", { exact: true })
      .first(),
  ).toBeVisible();
});
test("expiry while closed or away persists exact deadline without fabricating attempts", async ({
  page,
}) => {
  await seed(page);
  await create(page);
  await start(page);
  const deadline = (await saved(page)).contests![0].deadline;
  await page.clock.fastForward(1900000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Time ended", exact: true }),
  ).toBeVisible();
  const d = await saved(page);
  expect(d.contests![0].endedAt).toBe(deadline);
  expect(d.attempts).toHaveLength(0);
  expect(d.session).toBeNull();
});
test("failed finish retains active durable state and retries the original end time", async ({
  page,
}) => {
  await seed(page);
  await create(page);
  await start(page);
  await abortNextSave(page);
  await page.getByRole("button", { name: "Finish early", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish contest", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry saving Contest Lab" }),
  ).toBeVisible();
  expect((await saved(page)).contests![0].state).toBe("active");
  await page.clock.fastForward(60000);
  await page.getByRole("button", { name: "Retry saving Contest Lab" }).click();
  await expect(
    page.getByRole("heading", { name: "Finished early", exact: true }),
  ).toBeVisible();
  const d = await saved(page);
  expect(Date.parse(d.contests![0].endedAt!) - now.getTime()).toBeLessThan(
    60000,
  );
});
test("generator reports insufficient candidates and never exposes hidden hints", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/contests");
  await page
    .getByRole("button", { name: "Create a contest", exact: true })
    .click();
  await page.getByLabel("Choose a set").selectOption("catalogue");
  await page.getByRole("button", { name: "Generate set" }).click();
  await expect(page.getByText(/Only 0 matching problems/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save contest setup" }),
  ).toBeDisabled();
});
test("open regular session blocks contest start with an explicit resume path", async ({
  page,
}) => {
  let d = createContest(
    fixture(),
    "fixture-contest",
    "Blocked contest",
    30,
    [problem],
    false,
    "manual",
    now,
  );
  d = {
    ...d,
    session: {
      id: "existing-session",
      problemId: problem.id,
      startedAt: now.toISOString(),
      runningSince: now.getTime(),
      elapsedMs: 0,
      targetMinutes: 30,
      notes: "Regular notes",
      timerVisible: true,
      phase: "focus",
    },
  };
  await seed(page, d);
  await page.goto("/contests/fixture-contest");
  await expect(
    page.getByRole("button", { name: "Start contest", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Finish or abandon your open timed practice session first/),
  ).toBeVisible();
});
test("abandonment is distinct, retained on reload, and does not create completions", async ({
  page,
}) => {
  await seed(page);
  await create(page);
  await start(page);
  await page
    .getByRole("button", { name: "Abandon contest", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Abandon contest", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Abandoned", exact: true }),
  ).toBeVisible();
  await page.reload();
  expect((await saved(page)).contests![0].endReason).toBe("abandoned");
  expect((await saved(page)).attempts).toHaveLength(0);
});
for (const theme of ["light", "dark"] as const)
  test(`Contest Lab ${theme} Large screenshots, keyboard and narrow reflow`, async ({
    page,
  }, info) => {
    let d = fixture();
    d.settings.textSize = "large";
    d = createContest(
      d,
      "visual-contest",
      "A calm contest with a very long title that must wrap rather than disappear",
      30,
      [problem],
      false,
      "manual",
      now,
    );
    d = editContest(
      endContest(
        startContest(d, "visual-contest", now),
        "visual-contest",
        "early",
        now,
      ),
      "visual-contest",
      (c) => ({
        ...c,
        problems: c.problems.map((p) => ({
          ...p,
          notes: "Original notes.",
          status: "working",
        })),
      }),
    );
    await seed(page, d, theme);
    if (info.project.name === "mobile")
      await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/contests/visual-contest");
    await expect(
      page.getByRole("heading", { name: "Finished early", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `docs/forma-contest-review-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Reflect on this problem" }).click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `docs/forma-contest-reflection-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/contests");
    await page
      .getByRole("button", { name: "Create a contest", exact: true })
      .click();
    await page.screenshot({
      path: `docs/forma-contest-setup-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByLabel("Problem count", { exact: true }).fill("1");
    await page.getByRole("checkbox", { name: new RegExp(title) }).check();
    await page.getByRole("button", { name: "Save contest setup" }).click();
    await start(page);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `docs/forma-contest-active-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
  });

test("optional review draft and overall reflection persist before confirmation, including offline reload", async ({
  page,
}) => {
  let d = createContest(
    fixture(),
    "draft-contest",
    "Review drafts",
    30,
    [problem],
    false,
    "manual",
    now,
  );
  d = endContest(
    startContest(d, "draft-contest", now),
    "draft-contest",
    "early",
    now,
  );
  await seed(page, d);
  await page.goto("/contests/draft-contest");
  await page.getByRole("button", { name: "Reflect on this problem" }).click();
  await page
    .getByLabel("Takeaway", { exact: true })
    .fill("An unfinished review draft.");
  await expect
    .poll(
      async () =>
        (await saved(page)).contests![0].problems[0].reflectionDraft?.takeaway,
    )
    .toBe("An unfinished review draft.");
  expect(
    (await saved(page)).contests![0].problems[0].reflection,
  ).toBeUndefined();
  await page.keyboard.press("Escape");
  await page.getByLabel("What went well?").fill("I read every statement.");
  await expect
    .poll(async () => (await saved(page)).contests![0].review.wentWell)
    .toBe("I read every statement.");
  await page.reload();
  await page.getByRole("button", { name: "Reflect on this problem" }).click();
  await expect(page.getByLabel("Takeaway", { exact: true })).toHaveValue(
    "An unfinished review draft.",
  );
  await page.keyboard.press("Escape");
  await page.context().setOffline(true);
  await page.getByLabel("Where did time go?").fill("I revisited a dead end.");
  await expect
    .poll(async () => (await saved(page)).contests![0].review.lostTime)
    .toBe("I revisited a dead end.");
  await page.route("**/api/codeforces?**", (r) => r.abort());
  await page.getByRole("button", { name: "Sync contest evidence" }).click();
  await expect(
    page.getByText(/sync service could not be reached/),
  ).toBeVisible();
  expect(
    (await saved(page)).contests![0].problems[0].reflectionDraft?.takeaway,
  ).toBe("An unfinished review draft.");
});
