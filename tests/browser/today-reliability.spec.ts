import { expect, test, type Page } from "@playwright/test";
import { defaultDiscovery } from "../../src/lib/discovery";
import { emptyData, localDate, type Data } from "../../src/lib/model";

const freshTitle = "A fresh problem for deliberate practice";
const savedTitle = "A familiar problem worth revisiting";
const freshKey = "contest:6001:A";

function notebook(saved = true): Data {
  const data = emptyData();
  data.discovery = {
    ...defaultDiscovery(),
    selectedKey: freshKey,
    selectedOn: localDate(),
  };
  if (saved)
    data.problems.push({
      id: "today-saved",
      title: savedTitle,
      platform: "Codeforces",
      url: "https://codeforces.com/problemset/problem/6000/A",
      problemCode: "6000A",
      tags: ["hidden saved approach"],
      rating: 1200,
      createdAt: new Date().toISOString(),
      reviewAt: localDate(),
      reviewCount: 1,
    });
  return data;
}
async function seed(page: Page, data = notebook()) {
  await page.addInitScript((data) => {
    if (!localStorage.getItem("forma.today-fixture")) {
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", "dark");
      localStorage.setItem("forma.today-fixture", "seeded");
    }
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        stale: false,
        problems: [
          {
            key: freshKey,
            title: freshTitle,
            code: "6001A",
            url: "https://codeforces.com/problemset/problem/6001/A",
            rating: 1200,
            tags: ["hidden fresh approach"],
          },
          {
            key: "contest:6002:A",
            title: "Another fresh choice",
            code: "6002A",
            url: "https://codeforces.com/problemset/problem/6002/A",
            rating: 1300,
            tags: ["dp"],
          },
        ],
      },
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
          const transaction = db.transaction("workspaces");
          const read = transaction.objectStore("workspaces").get("personal");
          read.onsuccess = () => resolve(read.result.data);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => db.close();
        };
      }),
  );
}
async function openDiscovery(page: Page) {
  await page
    .getByText("Fresh practice & discovery filters", { exact: true })
    .click();
  const discovery = page.getByRole("region", {
    name: "Choose your next problem",
  });
  await expect(
    discovery.getByRole("heading", { name: freshTitle, exact: true }),
  ).toBeVisible();
  await expect(
    discovery.getByRole("button", {
      name: "Start fresh practice",
      exact: true,
    }),
  ).toBeEnabled();
  return discovery;
}

// Hold a real IndexedDB transaction open, then either abort it or let it
// commit. UI feedback must follow transaction completion, not optimistic state.
async function holdCommit(page: Page, abort: boolean) {
  await page.evaluate((abort) => {
    const fixture = { count: 0, release: () => {} };
    Object.assign(window, { formaTodayWrite: fixture });
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const transaction = original.call(this, names, mode, options);
      const stores = typeof names === "string" ? [names] : Array.from(names);
      if (
        this.name !== "forma-workspaces" ||
        mode !== "readwrite" ||
        !stores.includes("workspaces") ||
        !stores.includes("recoveries")
      )
        return transaction;
      fixture.count++;
      if (!armed) return transaction;
      armed = false;
      let released = false;
      fixture.release = () => {
        released = true;
      };
      const keepOpen = () => {
        const read = transaction
          .objectStore("workspaces")
          .get("__today_hold__");
        read.onsuccess = () => {
          if (!released) keepOpen();
          else if (abort) transaction.abort();
        };
      };
      keepOpen();
      return transaction;
    };
  }, abort);
}
async function writes(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { formaTodayWrite: { count: number } })
        .formaTodayWrite.count,
  );
}
async function release(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { formaTodayWrite: { release: () => void } }
    ).formaTodayWrite.release(),
  );
}

test("discovery preferences wait for persistence and retain the draft after a failed write", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const discovery = await openDiscovery(page);
  await discovery
    .getByText("Difficulty & optional topic focus", { exact: true })
    .click();
  await discovery.getByLabel("Minimum rating").fill("900");
  await discovery.getByLabel("Maximum rating").fill("1600");
  await holdCommit(page, true);
  await discovery
    .getByRole("button", { name: "Apply preferences", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    discovery.getByRole("button", { name: "Saving preferences…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Discovery preferences saved.", { exact: true }),
  ).toHaveCount(0);
  await release(page);
  await expect(discovery.getByRole("alert")).toContainText(
    "This change could not be saved",
  );
  await expect(discovery.getByLabel("Minimum rating")).toHaveValue("900");
  await expect(discovery.getByLabel("Maximum rating")).toHaveValue("1600");
  await expect(
    discovery.getByRole("link", { name: "Review saving & recovery" }),
  ).toBeVisible();
  await expect(
    page.getByText("Discovery preferences saved.", { exact: true }),
  ).toHaveCount(0);
  expect((await durable(page)).discovery?.minRating).toBe(800);
  expect(await writes(page)).toBe(1);
});

test("a failed dismissal has no saved feedback or durable dismissal", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  const discovery = await openDiscovery(page);
  await holdCommit(page, true);
  await discovery
    .getByRole("button", { name: "Not today", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    discovery.getByRole("button", { name: "Not today", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Skipped for today. It can return on another day.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await release(page);
  await expect(discovery.getByRole("alert")).toContainText(
    "This change could not be saved",
  );
  expect((await durable(page)).discovery?.dismissals).toEqual([]);
  await expect(
    page.getByText("Skipped for today. It can return on another day.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("fresh problem creation and session start wait for one atomic transaction", async ({
  page,
}) => {
  await seed(page, notebook(false));
  await page.goto("/");
  await openDiscovery(page);
  const start = page.getByRole("button", {
    name: "Start fresh practice",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await holdCommit(page, false);
  await start.click({ clickCount: 2 });
  await expect.poll(() => writes(page)).toBe(1);
  await expect(page).toHaveURL("/");
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Continue session", exact: true }),
  ).toHaveCount(0);
  await release(page);
  await expect(page).toHaveURL("/session");
  const stored = await durable(page);
  expect(stored.problems).toHaveLength(1);
  expect(stored.problems[0].title).toBe(freshTitle);
  expect(stored.session?.problemId).toBe(stored.problems[0].id);
  expect(await writes(page)).toBe(1);
});

test("a failed fresh transaction cannot create a durable dangling session", async ({
  page,
}) => {
  await seed(page, notebook(false));
  await page.goto("/");
  await openDiscovery(page);
  const start = page.getByRole("button", {
    name: "Start fresh practice",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await holdCommit(page, true);
  await start.click({ clickCount: 2 });
  await expect.poll(() => writes(page)).toBe(1);
  await release(page);
  await expect(
    page
      .getByRole("region", { name: "Choose your next problem" })
      .getByRole("alert"),
  ).toContainText("This change could not be saved");
  await expect(page).toHaveURL("/");
  const stored = await durable(page);
  expect(stored.problems).toEqual([]);
  expect(stored.session).toBeNull();
  expect(await writes(page)).toBe(1);
});

test("conflicting discovery preferences keep the user's draft and expose recovery", async ({
  page,
  context,
}) => {
  await seed(page);
  await page.goto("/");
  const a = await openDiscovery(page);
  const stale = await context.newPage();
  await seed(stale);
  await stale.addInitScript(`
    Object.defineProperty(window, 'BroadcastChannel', {value: class { postMessage() {} close() {} }});
    const original = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => { if (type !== 'focus') original(type, ...args); };
  `);
  await stale.goto("/");
  const b = await openDiscovery(stale);
  await a
    .getByText("Difficulty & optional topic focus", { exact: true })
    .click();
  await b
    .getByText("Difficulty & optional topic focus", { exact: true })
    .click();
  await a.getByLabel("Minimum rating").fill("900");
  await a
    .getByRole("button", { name: "Apply preferences", exact: true })
    .click();
  await expect(
    page.getByText("Discovery preferences saved.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await durable(page)).discovery?.minRating)
    .toBe(900);
  await b.getByLabel("Minimum rating").fill("1000");
  await b
    .getByRole("button", { name: "Apply preferences", exact: true })
    .click();
  await expect(b.getByRole("alert")).toContainText(
    "This change could not be saved",
  );
  await expect(b.getByLabel("Minimum rating")).toHaveValue("1000");
  await expect(
    stale.getByText("Discovery preferences saved.", { exact: true }),
  ).toHaveCount(0);
  expect((await durable(stale)).discovery?.minRating).toBe(900);
  await stale.goto("/settings");
  await stale
    .getByRole("button", { name: "Review recovery copies", exact: true })
    .click();
  await expect(
    stale
      .getByRole("button", { name: "Export recovery copy", exact: true })
      .first(),
  ).toBeVisible();
});

test("Today has one primary action, hidden approach tags and keyboard-accessible alternatives", async ({
  page,
}, testInfo) => {
  await seed(page);
  await page.goto("/");
  const main = page.locator(".today-primary");
  await expect(main.locator(".button.primary:visible")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("hidden saved approach", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: freshTitle, exact: true }),
  ).toHaveCount(0);
  const summary = page.getByText("Fresh practice & discovery filters", {
    exact: true,
  });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: freshTitle, exact: true }),
  ).toBeVisible();
  await expect(main.locator(".button.primary:visible")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: freshTitle, exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `docs/forma-today-focus-${testInfo.project.name}-ink.png`,
    animations: "disabled",
    fullPage: true,
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Warm paper", exact: true }).click();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: `docs/forma-today-focus-${testInfo.project.name}-light.png`,
    animations: "disabled",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page).toHaveURL("/session");
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Continue session", exact: true }),
  ).toBeVisible();
  await expect(main.locator(".button.primary:visible")).toHaveCount(1);
});

test("future saved work stays out of the primary recommendation on a narrow screen with enlarged text", async ({
  page,
}) => {
  const data = notebook();
  data.problems[0].reviewAt = "2099-01-01";
  await seed(page, data);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await openDiscovery(page);
  await expect(
    page.getByRole("button", { name: "Start fresh practice", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const fonts = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    ).map((element) => ({
      element,
      size: parseFloat(getComputedStyle(element).fontSize),
    }));
    for (const { element, size } of fonts)
      element.style.fontSize = `${size * 1.5}px`;
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Start fresh practice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose my own problem", exact: true }),
  ).toBeVisible();
});
