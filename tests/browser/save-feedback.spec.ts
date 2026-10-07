import { expect, test, type Page } from "@playwright/test";
import { emptyData, localDate, type Data } from "../../src/lib/model";

const title = "Preserve the practice notebook";
const notes =
  "The original session notes should survive a failed closing write.";

function notebook(phase?: "focus" | "reflection"): Data {
  const now = new Date().toISOString();
  const data: Data = {
    ...emptyData(),
    problems: [
      {
        id: "feedback-problem",
        title,
        platform: "Codeforces",
        url: "",
        problemCode: "",
        tags: [],
        rating: null,
        createdAt: now,
        reviewAt: localDate(),
        reviewCount: 0,
      },
    ],
  };
  if (phase)
    data.session = {
      id: "feedback-session",
      problemId: data.problems[0].id,
      startedAt: now,
      runningSince: null,
      elapsedMs: 90_000,
      targetMinutes: 30,
      notes,
      timerVisible: true,
      phase,
    };
  return data;
}

async function seed(page: Page, data: Data) {
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.feedback-fixture")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "dark");
    localStorage.setItem("forma.feedback-fixture", "seeded");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
}

async function durable(page: Page): Promise<Data> {
  return page.evaluate(
    () =>
      new Promise<Data>((resolve, reject) => {
        const opened = indexedDB.open("forma-workspaces", 1);
        opened.onsuccess = () => {
          const db = opened.result;
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
        opened.onerror = () => reject(opened.error);
      }),
  );
}

// This is a real IndexedDB write transaction. Success feedback must wait for
// its completion, and an abort must leave the original durable notebook intact.
async function holdWrite(page: Page, abort: boolean) {
  await page.evaluate((abort) => {
    const fixture = { count: 0, release: () => {} };
    Object.assign(window, { formaFeedbackWrite: fixture });
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
          .get("__feedback_hold__");
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
      (window as unknown as { formaFeedbackWrite: { count: number } })
        .formaFeedbackWrite.count,
  );
}
async function release(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { formaFeedbackWrite: { release: () => void } }
    ).formaFeedbackWrite.release(),
  );
}

test("adding a problem waits for commit before closing and rejects duplicate submits", async ({
  page,
}) => {
  await seed(page, notebook());
  await page.goto("/problems");
  await page.getByRole("button", { name: "Add problem", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Problem name", { exact: true })
    .fill("One committed problem");
  await holdWrite(page, false);
  await dialog
    .getByRole("button", { name: "Add problem", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("Problem added. A good place to begin.", { exact: true }),
  ).toHaveCount(0);
  await dialog.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(await writes(page)).toBe(1);
  await release(page);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Problem added. A good place to begin.", { exact: true }),
  ).toBeVisible();
  expect(
    (await durable(page)).problems.filter(
      (p) => p.title === "One committed problem",
    ),
  ).toHaveLength(1);
});

test("an aborted reschedule retains the chosen date and omits saved feedback", async ({
  page,
}) => {
  const data = notebook();
  await seed(page, data);
  await page.goto("/revisit");
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Revisit date", { exact: true }).fill("2030-10-14");
  await holdWrite(page, true);
  await dialog.getByRole("button", { name: "Save date", exact: true }).click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Revisit rescheduled. Your pace, your choice.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await release(page);
  await expect(dialog.getByRole("alert")).toContainText("was not committed");
  await expect(dialog.getByLabel("Revisit date", { exact: true })).toHaveValue(
    "2030-10-14",
  );
  await expect(
    dialog.getByRole("button", { name: "Save date", exact: true }),
  ).toBeEnabled();
  expect((await durable(page)).problems[0].reviewAt).toBe(
    data.problems[0].reviewAt,
  );
  await expect(
    page.getByText("Revisit rescheduled. Your pace, your choice.", {
      exact: true,
    }),
  ).toHaveCount(0);
});

test("an aborted timed reflection keeps its form and notes instead of showing an empty session", async ({
  page,
}) => {
  const data = notebook("reflection");
  await seed(page, data);
  await page.goto("/session");
  await page
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await page
    .getByLabel(/One thing to remember/)
    .fill("Keep this unsaved reflection for recovery.");
  await holdWrite(page, true);
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A little space to focus.",
      exact: true,
    }),
  ).toHaveCount(0);
  await release(page);
  await expect(
    page.locator(".reflection-form").getByRole("alert"),
  ).toContainText("Reflection was not committed");
  await expect(page.getByLabel(/One thing to remember/)).toHaveValue(
    "Keep this unsaved reflection for recovery.",
  );
  await page.getByText("Your session notes", { exact: true }).click();
  await expect(page.locator(".saved-notes")).toHaveText(notes);
  await expect(page.locator(".session-complete")).toHaveCount(0);
  await expect(
    page.getByText("Reflection saved. A little sharper than before.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await durable(page)).session).toEqual(data.session);
  expect((await durable(page)).attempts).toEqual([]);
  await page
    .getByRole("button", { name: "Back to the session", exact: true })
    .click();
  await expect(page.locator(".focus-content").getByRole("alert")).toContainText(
    "kept in this tab",
  );
  const editedNotes =
    "Edited notes after a failed reflection must stay exportable.";
  await page
    .getByLabel("A place for your thoughts", { exact: true })
    .fill(editedNotes);
  await expect(
    page.getByLabel("A place for your thoughts", { exact: true }),
  ).toHaveValue(editedNotes);
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await expect(page.getByLabel(/One thing to remember/)).toHaveValue(
    "Keep this unsaved reflection for recovery.",
  );
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect(
    page.locator(".reflection-form").getByRole("alert"),
  ).toContainText("was not committed");
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();
  await page.locator('a[href="/settings"]:visible').first().click();
  await page
    .getByRole("button", { name: "Export my data", exact: true })
    .click();
  await page.getByText("View backup JSON", { exact: true }).click();
  const backup = JSON.parse(
    await page.getByLabel("Backup JSON", { exact: true }).inputValue(),
  );
  expect(backup.attempts).toHaveLength(1);
  expect(backup.attempts[0].notes).toBe(editedNotes);
  expect(backup.attempts[0].takeaway).toBe(
    "Keep this unsaved reflection for recovery.",
  );
});

test("an aborted discard stays on the session and keeps original timer and notes", async ({
  page,
}) => {
  const data = notebook("focus");
  await seed(page, data);
  await page.goto("/session");
  await page
    .getByRole("button", { name: "End without saving", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await holdWrite(page, true);
  await dialog
    .getByRole("button", { name: "Discard session", exact: true })
    .click();
  await expect.poll(() => writes(page)).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Discarding…", exact: true }),
  ).toBeDisabled();
  expect(new URL(page.url()).pathname).toBe("/session");
  await release(page);
  await expect(dialog.getByRole("alert")).toContainText(
    "The session was not discarded",
  );
  await expect(
    page.getByText("Session ended without adding an attempt.", { exact: true }),
  ).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/session");
  expect((await durable(page)).session).toEqual(data.session);
  await dialog
    .getByRole("button", { name: "Keep practising", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".focus-content").getByRole("alert")).toContainText(
    "kept in this tab",
  );
  await expect(
    page.getByLabel("A place for your thoughts", { exact: true }),
  ).toHaveValue(notes);
  await expect(
    page.getByRole("button", { name: "Resume timer", exact: true }),
  ).toBeVisible();
});
