import { test, expect, Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
});
async function add(page: Page, title: string) {
  await page.goto("/problems");
  await page.getByRole("button", { name: "Add problem", exact: true }).click();
  await page.getByLabel("Problem name").fill(title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add problem", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
}
test("add, edit, paused session reload, reflection and backup restoration", async ({
  page,
}) => {
  await add(page, "Regression problem");
  await page
    .getByRole("button", { name: "Regression problem", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Problem name").fill("Edited problem");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .getByRole("button", { name: "Start session: Edited problem" })
    .click();
  await page
    .getByLabel("A place for your thoughts")
    .fill("Preserve these session notes.");
  await page.getByRole("button", { name: "Pause timer" }).click();
  await expect(
    page.getByRole("button", { name: "Resume timer" }),
  ).toBeEnabled();
  await expect(
    page.getByText("Saving local changes…", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "Preserve these session notes.",
  );
  await expect(
    page.getByRole("button", { name: "Resume timer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish session" }).click();
  await page
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await page.getByRole("button", { name: "Save reflection" }).click();
  await expect(
    page.getByRole("heading", { name: "A small step. Something to build on." }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Export my data" }).click();
  await page.getByText("View backup JSON").click();
  const backup = await page.getByLabel("Backup JSON").inputValue();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await expect(page.getByRole("dialog")).toContainText("1 timed attempts");
  await page.getByRole("button", { name: "Replace and restore" }).click();
  await expect(
    page.getByText("Your data has been restored.", { exact: true }),
  ).toBeVisible();
  await page.goto("/problems");
  await expect(
    page.getByRole("button", { name: "Edited problem", exact: true }),
  ).toBeVisible();
});
test("two tabs combine new problem and preferences without stale overwrite", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const b = await context.newPage();
  await b.goto("/settings");
  await add(page, "Tab A problem");
  await b.getByLabel("Weekly session goal").fill("7");
  await b.getByRole("button", { name: "Save preferences" }).click();
  await expect(
    b.getByText("Your preferences are saved. Make this practice your own."),
  ).toBeVisible();
  await b.reload();
  await expect(b.getByLabel("Weekly session goal")).toHaveValue("7");
  await b.goto("/problems");
  await expect(
    b.getByRole("button", { name: "Tab A problem", exact: true }),
  ).toBeVisible();
});
test("Ink appearance persists and no mobile horizontal overflow", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
