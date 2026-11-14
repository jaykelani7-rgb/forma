import { expect, test, type Page } from "@playwright/test";
import { siteBasePath } from "./fixtures";
const workspace = (page: Page) =>
  page.getByRole("region", { name: "Interactive sample workspace" });
const companion = (page: Page) =>
  page.getByRole("region", { name: "Interactive Forma companion" });
async function enter(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${siteBasePath}/`);
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
}
async function saveReflection(page: Page, outcome: string, text: string) {
  const demo = companion(page);
  await demo.getByRole("tab", { name: "Reflect", exact: true }).click();
  const edit = demo.getByRole("button", { name: "Edit reflection" });
  if (await edit.count()) await edit.click();
  await demo.getByRole("button", { name: outcome }).click();
  await demo.getByLabel("One thing to carry forward").fill(text);
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await demo.getByRole("link", { name: "See it in your notebook" }).click();
}

test("track stages, active plan and independent progress stay connected across views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await enter(page);
  const space = workspace(page);
  const today = space.getByRole("tab", { name: "Today", exact: true });
  await today.focus();
  for (const name of ["Practice", "Tracks", "Contests", "Journal"]) {
    await page.keyboard.press("ArrowRight");
    await expect(space.getByRole("tab", { name, exact: true })).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Home");
  await expect(today).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    space.getByRole("tab", { name: "Journal", exact: true }),
  ).toBeFocused();
  await space.getByRole("tab", { name: "Tracks", exact: true }).click();
  await expect(space.getByRole("progressbar")).toHaveAttribute("value", "1");
  await space
    .getByRole("button", { name: "Make this my active track" })
    .click();
  await space
    .getByRole("button", { name: /Build from smaller answers/ })
    .click();
  await expect(
    space.getByRole("article", { name: "Selected track stage" }),
  ).toContainText("Cut Ribbon");
  await space.getByRole("button", { name: "View example problem" }).click();
  await expect(
    space.getByRole("article", { name: "Selected problem" }),
  ).toContainText("Cut Ribbon");
  await space.getByRole("button", { name: "Close workspace preview" }).click();
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  await expect(
    space.getByRole("region", { name: "Your sample practice plan" }),
  ).toContainText("Active track · Small steps");
  await space.getByRole("button", { name: "Return to track" }).click();
  await expect(
    space.getByRole("button", { name: /Build from smaller answers/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await space.getByRole("button", { name: /Start with a boundary/ }).click();
  await space.getByRole("button", { name: "Open Watermelon sample" }).click();
  await saveReflection(page, "With a hint", "Try the smallest even input.");
  await space.getByRole("tab", { name: "Tracks", exact: true }).click();
  await expect(space.getByRole("progressbar")).toHaveAttribute("value", "1");
  await expect(
    space.getByRole("article", { name: "Selected track stage" }),
  ).toContainText("With a hint");
  await space.getByRole("button", { name: "Open Watermelon sample" }).click();
  await saveReflection(page, "Independent", "Both pieces need at least two.");
  await space.getByRole("tab", { name: "Tracks", exact: true }).click();
  await expect(space.getByRole("progressbar")).toHaveAttribute("value", "2");
  await companion(page).getByRole("button", { name: "Reset preview" }).click();
  await expect(
    space.getByRole("button", { name: "Make this my active track" }),
  ).toBeVisible();
  await expect(space.getByRole("progressbar")).toHaveAttribute("value", "1");
});

test("contest debrief and upsolve require later practice and preserve the original result", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await enter(page);
  const space = workspace(page);
  const demo = companion(page);
  await space.getByRole("button", { name: "Open in companion" }).click();
  await saveReflection(
    page,
    "Independent",
    "An earlier reflection must not complete a new upsolve.",
  );
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(
    space.getByRole("button", { name: "Save contest takeaway" }),
  ).toBeDisabled();
  const takeaway = "Spend a moment checking boundaries before submitting.";
  await space.getByLabel("What would you change next time?").fill(takeaway);
  await space.getByRole("tab", { name: "Today", exact: true }).click();
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(
    space.getByLabel("What would you change next time?"),
  ).toHaveValue(takeaway);
  await space.getByRole("button", { name: "Save contest takeaway" }).click();
  await space.getByLabel("Upsolve priority").selectOption("high");
  await space.getByRole("button", { name: "Queue sample upsolve" }).click();
  const later = space.getByRole("article", { name: "Later upsolve learning" });
  await expect(later).toContainText("No linked upsolve reflection yet");
  await space.getByRole("button", { name: "See Today" }).click();
  await expect(
    space.getByRole("region", { name: "Your sample practice plan" }),
  ).toContainText("High priority");
  await space.getByRole("button", { name: "Start sample upsolve" }).click();
  await expect(
    demo.getByRole("button", { name: "Pause sample timer" }),
  ).toBeVisible();
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(later).toContainText("No linked upsolve reflection yet");
  await space.getByRole("button", { name: "Continue sample upsolve" }).click();
  await saveReflection(
    page,
    "Not solved yet",
    "I still need to explain why the zero part is invalid.",
  );
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(
    space.getByRole("region", { name: "Sample upsolve queue" }),
  ).toContainText("still in your upsolve queue");
  await space.getByRole("button", { name: "Continue sample upsolve" }).click();
  await saveReflection(
    page,
    "Independent",
    "Two positive even parts require at least four.",
  );
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(
    space.getByRole("region", { name: "Sample upsolve queue" }),
  ).toContainText("Upsolve complete");
  await expect(later).toContainText("Independent");
  await expect(
    space.getByRole("article", { name: "Original contest result" }),
  ).toContainText("Not solved yet");
  await expect(
    space.getByRole("article", { name: "Original contest result" }),
  ).toContainText("No acceptance recorded");
  await space.getByRole("button", { name: "Read it in Journal" }).click();
  await space
    .getByRole("button", { name: "Reopen problem", exact: true })
    .click();
  await saveReflection(
    page,
    "Not solved yet",
    "Correcting my outcome reopens the queue.",
  );
  await space.getByRole("tab", { name: "Contests", exact: true }).click();
  await expect(
    space.getByRole("region", { name: "Sample upsolve queue" }),
  ).toContainText("still in your upsolve queue");
  await space.getByRole("button", { name: "Remove from queue" }).click();
  await expect(
    space.getByRole("button", { name: "Queue sample upsolve" }),
  ).toBeVisible();
  await expect(
    space.getByLabel("What would you change next time?"),
  ).toHaveValue(takeaway);
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await expect(
    space.getByLabel("What would you change next time?"),
  ).toHaveValue("");
  await expect(space.getByLabel("Upsolve priority")).toHaveValue("normal");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
