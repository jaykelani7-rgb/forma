import { expect, test, type Page } from "@playwright/test";
import { connectProfile } from "../../src/lib/codeforces";
import { addDays, emptyData, type Data } from "../../src/lib/model";
import { decodeBackup } from "../../src/lib/concurrency";

const importedTitle = "Imported problem awaiting a reflection";
const handle = "import_fixture";
const importedMessage =
  "Recent activity imported. Acceptance and understanding stay separate.";
const originalNotes = "Preserve this existing practice history.";

function notebook(): Data {
  const now = new Date();
  const data = connectProfile(
    emptyData(),
    { handle, rating: 1400, rank: "specialist" },
    now,
  );
  data.codeforces.profiles[0].lastSyncAt = addDays(now, -2).toISOString();
  data.problems.push({
    id: "import-original",
    title: "An existing notebook entry",
    platform: "Other",
    url: "",
    problemCode: "",
    tags: [],
    rating: null,
    createdAt: addDays(now, -3).toISOString(),
    reviewAt: null,
    reviewCount: 0,
  });
  data.attempts.push({
    id: "import-original-attempt",
    problemId: "import-original",
    startedAt: addDays(now, -3).toISOString(),
    completedAt: addDays(now, -3).toISOString(),
    elapsedMs: 120_000,
    outcome: "independent",
    difficulty: null,
    takeaway: "Existing learning must survive a failed import.",
    notes: originalNotes,
  });
  return data;
}

async function seed(page: Page) {
  await page.addInitScript((data) => {
    if (!localStorage.getItem("forma.import-fixture")) {
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.import-fixture", "seeded");
    }
  }, notebook());
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        stale: false,
        problems: [],
      },
    }),
  );
  await page.route("**/api/codeforces?**", (route) => {
    const url = new URL(route.request().url());
    const requestedHandle = url.searchParams.get("handle") ?? handle;
    return route.fulfill({
      json:
        url.searchParams.get("action") === "profile"
          ? { handle: requestedHandle, rating: 1400, rank: "specialist" }
          : {
              handle: requestedHandle,
              from: Number(url.searchParams.get("from") ?? 1),
              count: 50,
              submissions:
                requestedHandle === handle
                  ? [
                      {
                        id: 321,
                        submittedAt: new Date().toISOString(),
                        verdict: "OK",
                        language: "GNU C++20",
                        problem: {
                          key: "contest:7777:A",
                          title: importedTitle,
                          code: "7777A",
                          url: "https://codeforces.com/problemset/problem/7777/A",
                          rating: 1300,
                          tags: ["graphs"],
                        },
                      },
                    ]
                  : [],
            },
    });
  });
}

async function durable(page: Page, key = "personal"): Promise<Data> {
  return page.evaluate(
    (key) =>
      new Promise<Data>((resolve, reject) => {
        const open = indexedDB.open("forma-workspaces", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("workspaces");
          const read = transaction.objectStore("workspaces").get(key);
          read.onsuccess = () => resolve(read.result.data);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => db.close();
        };
      }),
    key,
  );
}

async function ready(page: Page) {
  await page.goto("/settings");
  await expect(
    page.getByRole("button", { name: "Refresh activity", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Saving local changes…", { exact: true }),
  ).toHaveCount(0);
}
async function holdCommit(page: Page, abort: boolean) {
  await page.evaluate((abort) => {
    const fixture = { count: 0, release: () => {} };
    Object.assign(window, { formaImportWrite: fixture });
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
          .get("__import_hold__");
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
      (window as unknown as { formaImportWrite: { count: number } })
        .formaImportWrite.count,
  );
}
async function release(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { formaImportWrite: { release: () => void } }
    ).formaImportWrite.release(),
  );
}

test("Refresh stays busy and reports import success only after the IndexedDB transaction commits", async ({
  page,
}) => {
  await seed(page);
  await ready(page);
  await holdCommit(page, false);
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click({ clickCount: 2 });
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    page.getByRole("button", { name: "Refresh activity", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Importing recent activity…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(importedMessage, { exact: true })).toHaveCount(0);
  await release(page);
  await expect(page.getByText(importedMessage, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh activity", exact: true }),
  ).toBeEnabled();
  const stored = await durable(page);
  expect(
    stored.codeforces.submissions.some((submission) => submission.id === 321),
  ).toBe(true);
  expect(stored.attempts[0].notes).toBe(originalNotes);
  expect(await writes(page)).toBe(1);
});

test("an aborted import keeps imported input exportable while preserving saved history and omitting success", async ({
  page,
}) => {
  await seed(page);
  await ready(page);
  const before = await durable(page);
  await holdCommit(page, true);
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await release(page);
  await expect(
    page.locator("#codeforces .sync-error[role=alert]"),
  ).toContainText(
    /could not be saved|could not be committed|saving needs attention/i,
  );
  await expect(page.getByText(importedMessage, { exact: true })).toHaveCount(0);
  const stored = await durable(page);
  expect(stored.codeforces.submissions).toEqual(before.codeforces.submissions);
  expect(stored.attempts).toEqual(before.attempts);
  await page
    .getByRole("button", { name: "Export my data", exact: true })
    .click();
  await page.getByText("View backup JSON", { exact: true }).click();
  const recovery = decodeBackup(
    await page.getByLabel("Backup JSON").inputValue(),
  );
  expect(
    recovery.codeforces.submissions.some((submission) => submission.id === 321),
  ).toBe(true);
  expect(
    recovery.problems.some((problem) => problem.title === importedTitle),
  ).toBe(true);
  expect(recovery.attempts[0].notes).toBe(originalNotes);
});

test("a conflicting import exposes a recovery copy and cannot report a successful import", async ({
  page,
  context,
}) => {
  await seed(page);
  await ready(page);
  const stale = await context.newPage();
  await seed(stale);
  await stale.addInitScript(`
    Object.defineProperty(window, 'BroadcastChannel', {value: class { postMessage() {} close() {} }});
    const original = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => { if (type !== 'focus') original(type, ...args); };
  `);
  await ready(stale);
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect(page.getByText(importedMessage, { exact: true })).toBeVisible();
  const newer = await durable(page);
  await stale
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect(
    stale.getByText(/Another tab changed the same records/),
  ).toBeVisible();
  await expect(
    stale.locator("#codeforces .sync-error[role=alert]"),
  ).toContainText(
    /could not be saved|could not be committed|saving needs attention/i,
  );
  await expect(stale.getByText(importedMessage, { exact: true })).toHaveCount(
    0,
  );
  expect((await durable(stale)).codeforces.profiles[0].lastSyncAt).toBe(
    newer.codeforces.profiles[0].lastSyncAt,
  );
  await stale
    .getByRole("button", { name: "Review recovery copies", exact: true })
    .click();
  await stale
    .getByRole("button", { name: "Export recovery copy", exact: true })
    .first()
    .click();
  await stale.getByText("View backup JSON", { exact: true }).click();
  const recovery = decodeBackup(
    await stale.getByLabel("Backup JSON").inputValue(),
  );
  expect(
    recovery.codeforces.submissions.some((submission) => submission.id === 321),
  ).toBe(true);
});

test("switching workspace during a held import suppresses completion and keeps imported records separate", async ({
  page,
}) => {
  await seed(page);
  await ready(page);
  await holdCommit(page, false);
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await page
    .getByRole("button", { name: "Explore the demo", exact: true })
    .click();
  await expect(page.getByText(importedMessage, { exact: true })).toHaveCount(0);
  await release(page);
  await expect(page.locator(".demo-banner")).toBeVisible();
  await expect(page.getByText(importedMessage, { exact: true })).toHaveCount(0);
  const demo = await durable(page, "demo");
  expect(
    demo.codeforces.submissions.some((submission) => submission.id === 321),
  ).toBe(false);
  expect(demo.problems.some((problem) => problem.title === importedTitle)).toBe(
    false,
  );
  const personal = await durable(page);
  expect(personal.attempts[0].notes).toBe(originalNotes);
});

test("changing the connected handle in another tab cancels an old import without leaving Refresh busy", async ({
  page,
  context,
}) => {
  await seed(page);
  await ready(page);
  let releaseResponse: () => void = () => {};
  let markStarted: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route("**/api/codeforces?**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.searchParams.get("action") === "activity" &&
      url.searchParams.get("handle") === handle
    ) {
      markStarted();
      await responseGate;
    }
    await route.fallback();
  });
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await started;
  await expect(
    page.getByRole("button", { name: "Refresh activity", exact: true }),
  ).toBeDisabled();
  const other = await context.newPage();
  await seed(other);
  await ready(other);
  await other
    .getByRole("button", { name: "Change handle", exact: true })
    .click();
  await other
    .getByLabel("Codeforces handle", { exact: true })
    .fill("other_fixture");
  await other
    .getByRole("button", { name: "Preview profile", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Connect and import", exact: true })
    .click();
  await expect
    .poll(async () => (await durable(other)).codeforces.connectedHandle)
    .toBe("other_fixture");
  await expect(page.locator("#codeforces .cf-profile strong")).toHaveText(
    "other_fixture",
  );
  releaseResponse();
  await expect(
    page.getByText("Importing recent activity…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh activity", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(importedMessage, { exact: true })).toHaveCount(0);
  expect(
    (await durable(page)).codeforces.submissions.some(
      (submission) => submission.id === 321,
    ),
  ).toBe(false);
});
