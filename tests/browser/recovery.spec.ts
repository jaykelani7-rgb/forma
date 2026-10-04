import { expect, test, type Page } from "@playwright/test";
import { decodeBackup } from "../../src/lib/concurrency";
import { emptyData, type Data } from "../../src/lib/model";

const originalNotes = "Original paused session notes must survive.";
const originalTakeaway = "Check the empty input before the loop.";

function legacyNotebook(): Data {
  const now = new Date().toISOString();
  return {
    ...emptyData(),
    problems: [
      {
        id: "recovery-problem",
        title: "A notebook worth preserving",
        platform: "Codeforces",
        url: "",
        problemCode: "",
        tags: [],
        rating: null,
        createdAt: now,
        reviewAt: null,
        reviewCount: 0,
      },
    ],
    attempts: [
      {
        id: "recovery-attempt",
        problemId: "recovery-problem",
        startedAt: now,
        completedAt: now,
        elapsedMs: 60_000,
        outcome: "hint",
        difficulty: "edges",
        takeaway: originalTakeaway,
        notes: "These are the original completed-session notes.",
      },
    ],
    session: {
      id: "recovery-session",
      problemId: "recovery-problem",
      startedAt: now,
      runningSince: null,
      elapsedMs: 30_000,
      targetMinutes: 30,
      notes: originalNotes,
      timerVisible: true,
      phase: "focus",
    },
  };
}

async function seed(page: Page, failInitialOpen = false) {
  const data = legacyNotebook();
  const legacy = JSON.stringify(data);
  await page.addInitScript(
    ({ legacy, failInitialOpen }) => {
      if (!localStorage.getItem("forma.recovery-fixture")) {
        localStorage.setItem("forma.personal.v1", legacy);
        localStorage.setItem("forma.recovery-fixture", "seeded");
      }
      if (!failInitialOpen) return;
      const originalOpen = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        if (
          name === "forma-workspaces" &&
          !localStorage.getItem("forma.recovery-open-failed")
        ) {
          localStorage.setItem("forma.recovery-open-failed", "once");
          throw new DOMException("One transient open failure", "UnknownError");
        }
        return originalOpen.call(this, name, version);
      };
    },
    { legacy, failInitialOpen },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        stale: false,
        problems: [],
      },
    }),
  );
  return { data, legacy };
}

async function openSettingsFromSession(page: Page) {
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await page.locator('a[href="/settings"]:visible').first().click();
  await expect(
    page.getByRole("heading", { name: "A practice that fits you." }),
  ).toBeVisible();
}

async function exportCurrentNotebook(page: Page) {
  await page
    .getByRole("button", { name: "Export my data", exact: true })
    .click();
  await page.getByText("View backup JSON", { exact: true }).click();
  const json = await page
    .getByLabel("Backup JSON", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  return json;
}

async function durableNotebook(page: Page): Promise<Data | null> {
  return page.evaluate(
    () =>
      new Promise<Data | null>((resolve, reject) => {
        const open = indexedDB.open("forma-workspaces", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("workspaces");
          const read = transaction.objectStore("workspaces").get("personal");
          read.onerror = () => reject(read.error);
          read.onsuccess = () => resolve(read.result?.data ?? null);
          transaction.oncomplete = () => db.close();
        };
      }),
  );
}

test("a transient initial storage failure preserves legacy history and restores through the UI", async ({
  page,
}) => {
  const { data, legacy } = await seed(page, true);
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    originalNotes,
  );
  await expect(
    page.getByText("Kept in this tab", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Saved records could not be migrated or read/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await page.locator('a[href="/problems"]:visible').first().click();
  await page
    .getByRole("button", { name: data.problems[0].title, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(originalTakeaway);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator('a[href="/settings"]:visible').first().click();
  const backup = await exportCurrentNotebook(page);
  const recovered = decodeBackup(backup);
  expect(recovered.session?.notes).toBe(originalNotes);
  expect(recovered.attempts).toEqual(data.attempts);
  expect(
    await page.evaluate(() => localStorage.getItem("forma.personal.v1")),
  ).toBe(legacy);
  await page.getByLabel("Import JSON backup").setInputFiles({
    name: "recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.getByRole("dialog")).toContainText("1 timed attempts");
  await page
    .getByRole("button", { name: "Replace and restore", exact: true })
    .click();
  await expect(
    page.getByText("Your data has been restored.", { exact: true }),
  ).toBeVisible();
  const saved = await durableNotebook(page);
  expect(saved?.session?.notes).toBe(originalNotes);
  expect(saved?.attempts).toEqual(data.attempts);
  // A new document must read the committed notebook, not rely on the in-memory
  // fallback left by the original failed initialization.
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    originalNotes,
  );
  await expect(
    page.getByText("Saved as you go", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Saved records could not be migrated or read/),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("forma.personal.v1")),
  ).toBe(legacy);
});

type WriteFailure = {
  commitCount: number;
  aborted: boolean;
  release: () => void;
};
declare global {
  interface Window {
    formaTestWriteFailure: WriteFailure;
  }
}

async function holdAndFailNextCommit(page: Page) {
  await page.evaluate(() => {
    const fixture: WriteFailure = {
      commitCount: 0,
      aborted: false,
      release: () => {},
    };
    window.formaTestWriteFailure = fixture;
    const originalTransaction = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const transaction = originalTransaction.call(this, names, mode, options);
      const stores = typeof names === "string" ? [names] : Array.from(names);
      if (
        this.name !== "forma-workspaces" ||
        mode !== "readwrite" ||
        !stores.includes("workspaces") ||
        !stores.includes("recoveries")
      )
        return transaction;
      fixture.commitCount++;
      if (!armed) return transaction;
      armed = false;
      let release = false;
      fixture.release = () => {
        release = true;
      };
      transaction.addEventListener("abort", () => {
        fixture.aborted = true;
      });
      // Keep this real write transaction open until the second user edit is
      // queued. Aborting then rolls back its writes without altering any other
      // read, migration, database, or following transaction.
      const hold = () => {
        const request = transaction
          .objectStore("workspaces")
          .get("__test_hold__");
        request.onsuccess = () => {
          if (release) transaction.abort();
          else hold();
        };
      };
      hold();
      return transaction;
    };
  });
}

test("two queued note edits survive the first failed write without changing the saved original", async ({
  page,
}) => {
  const { data, legacy } = await seed(page);
  await page.goto("/session");
  const notes = page.getByLabel("A place for your thoughts");
  await expect(notes).toHaveValue(originalNotes);
  await expect(
    page.getByText("Saved as you go", { exact: true }),
  ).toBeVisible();
  await holdAndFailNextCommit(page);
  await notes.fill("First queued draft");
  await expect
    .poll(() => page.evaluate(() => window.formaTestWriteFailure.commitCount))
    .toBe(1);
  const latestNotes =
    "The second queued draft must remain visible and exportable.";
  await notes.fill(latestNotes);
  await expect(notes).toHaveValue(latestNotes);
  await expect(page.getByText("Saving notes…", { exact: true })).toBeVisible();
  await page.evaluate(() => window.formaTestWriteFailure.release());
  await expect(
    page.getByText("Kept in this tab", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saving local changes…", { exact: true }),
  ).toHaveCount(0);
  await expect(notes).toHaveValue(latestNotes);
  expect(await page.evaluate(() => window.formaTestWriteFailure.aborted)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => window.formaTestWriteFailure.commitCount),
  ).toBe(1);
  const saved = await durableNotebook(page);
  expect(saved?.session?.notes).toBe(originalNotes);
  expect(saved?.attempts).toEqual(data.attempts);
  expect(
    await page.evaluate(() => localStorage.getItem("forma.personal.v1")),
  ).toBe(legacy);
  await openSettingsFromSession(page);
  const backup = decodeBackup(await exportCurrentNotebook(page));
  expect(backup.session?.notes).toBe(latestNotes);
  expect(backup.attempts).toEqual(data.attempts);
});
