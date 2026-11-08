import { expect, test } from "@playwright/test";

test("the compact ribbon controls the saved session and its reflection opens from the journal", async ({
  page,
}) => {
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
  await page.goto("/problems");
  await page.getByRole("button", { name: "Add problem", exact: true }).click();
  await page.getByLabel("Problem name").fill("Ribbon notebook check");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add problem", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start session: Ribbon notebook check" })
    .click();
  await page.getByRole("link", { name: "Back to Today", exact: true }).click();

  const dock = page.getByRole("complementary", { name: "Current session" });
  await dock.getByRole("button", { name: "Pause current timer" }).click();
  await expect(
    dock.getByRole("button", { name: "Resume current timer" }),
  ).toBeEnabled();
  await page.reload();
  await dock.getByRole("button", { name: "Resume current timer" }).click();
  await expect(
    dock.getByRole("button", { name: "Pause current timer" }),
  ).toBeEnabled();
  await dock.getByRole("link", { name: "Open current session" }).click();
  await page.getByRole("button", { name: "Finish session" }).click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page
    .getByLabel("One thing to remember")
    .fill("Check the single-element interval.");
  await page.getByRole("button", { name: "Save reflection" }).click();
  await page.getByRole("link", { name: "Open journal" }).click();
  await page.getByLabel("Search journal").fill("single-element");
  const entry = page.getByRole("button", { name: /^View entry:/ });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Ribbon notebook check");
  await entry.click();
  await page.getByRole("link", { name: "Open original record" }).click();
  await expect(page).toHaveURL(/\/problems\/.+#record-practice-/);
  await expect(
    page.getByRole("link", { name: "Back to journal" }).first(),
  ).toBeVisible();
});

test("Ribbon personalization persists and a replayable rehearsal cannot change the personal notebook", async ({
  page,
}) => {
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
  await page.goto("/settings");
  const studio = page.getByRole("region", { name: "Ribbon personalization" });
  await studio.getByRole("button", { name: "Small fold", exact: true }).click();
  await studio.getByRole("button", { name: "Right edge", exact: true }).click();
  await studio.getByRole("button", { name: "Still", exact: true }).click();
  await studio
    .getByRole("button", { name: "Preview focus", exact: true })
    .click();
  await expect(studio.locator(".rs-stage")).toHaveAttribute(
    "data-edge",
    "right",
  );
  await studio.getByRole("button", { name: "Unfold preview ribbon" }).click();
  await expect(
    studio.getByRole("button", { name: "Fold preview ribbon" }),
  ).toBeVisible();
  await studio
    .getByRole("button", { name: "Save appearance", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("saved");
  await page.reload();
  await expect(
    studio.getByRole("button", { name: "Small fold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const snapshot = () =>
    page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open("forma-workspaces", 1);
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction("workspaces");
            const read = tx.objectStore("workspaces").getAll();
            read.onsuccess = () => {
              resolve(JSON.stringify(read.result));
              db.close();
            };
            read.onerror = () => reject(read.error);
          };
          open.onerror = () => reject(open.error);
        }),
    );
  const before = await snapshot();
  await studio.getByRole("button", { name: "Rehearse a session" }).click();
  await page.getByRole("button", { name: "Open sample ribbon" }).click();
  await page.getByRole("button", { name: "Start sample timer" }).click();
  await page.getByRole("button", { name: "Pause sample timer" }).click();
  await page.getByLabel("Sample outcome").selectOption("unsolved");
  await page
    .getByLabel("One thought for next time")
    .fill("Test the shortest ribbon.");
  await page.getByRole("button", { name: "Bookmark sample thought" }).click();
  await expect(page.locator(".rs-bookmark")).toContainText(
    "Test the shortest ribbon.",
  );
  expect(await snapshot()).toEqual(before);
  await page.getByRole("button", { name: "Finish rehearsal" }).click();
  await studio.getByRole("button", { name: "Rehearse a session" }).click();
  await expect(
    page.getByRole("button", { name: "Open sample ribbon" }),
  ).toBeVisible();
  expect(await snapshot()).toEqual(before);
});
