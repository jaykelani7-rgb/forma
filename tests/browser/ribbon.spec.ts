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
  const entry = page.locator(".ribbon-entries a");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Ribbon notebook check");
  await entry.click();
  await expect(page).toHaveURL(/\/problems\/.+#record-practice-/);
  await expect(
    page.getByRole("link", { name: "Back to journal" }).first(),
  ).toBeVisible();
});
