import { expect, test, type Page } from "@playwright/test";
import { siteBasePath } from "./fixtures";

const companion = (page: Page) =>
  page.getByRole("region", { name: "Interactive Forma companion" });
const story = (page: Page) =>
  page.getByRole("region", { name: "Keep the thread story" });

test("the quiet opening reveals the story on request and preserves a closed session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${siteBasePath}/`);
  const hero = page.getByRole("region", {
    name: "Your thinking. Beside your code.",
  });
  const invite = hero.getByRole("button", { name: "See Forma in action" });
  await expect(hero.getByRole("button")).toHaveCount(1);
  await expect(invite).toBeInViewport();
  await expect(invite).toHaveAttribute("aria-expanded", "false");
  await expect(companion(page)).toHaveCount(0);
  await page.locator("#try-forma-intro").scrollIntoViewIfNeeded();
  await expect(companion(page)).toHaveCount(0);
  await invite.click();
  const demo = companion(page);
  const scene = story(page);
  await expect(
    page.getByRole("heading", { name: "Step away. Keep your place." }),
  ).toBeFocused();
  await scene.getByRole("button", { name: "Select these lines" }).click();
  const note = "Keep this thought while I look around the website.";
  await scene.getByLabel("A thought to come back to").fill(note);
  await scene.getByRole("button", { name: "Keep this thought" }).click();
  await page.clock.install();
  await scene.getByRole("button", { name: "Play the story" }).click();
  await page.getByRole("button", { name: "Close story" }).click();
  await expect(invite).toBeFocused();
  await expect(invite).toHaveAttribute("aria-expanded", "false");
  await expect(demo).toHaveCount(0);
  await page.clock.fastForward(15000);
  const resume = page.getByRole("button", {
    name: "Continue exploring",
    exact: true,
  });
  await resume.click();
  await expect(demo).toHaveAttribute("data-story-phase", "2");
  await expect(demo).toHaveAttribute("data-story-playing", "false");
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText(note);
  await page.getByRole("button", { name: "Close story" }).click();
  await expect(resume).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a personal thought survives folding, replay and the handoff to practice at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(request.url());
  });
  await page.goto(`${siteBasePath}/`);
  await page.getByRole("button", { name: "See Forma in action" }).click();
  const demo = companion(page);
  const scene = story(page);
  await expect(
    scene.getByRole("button", { name: "Play the story" }),
  ).toHaveCount(0);
  await scene.getByRole("button", { name: "Select these lines" }).click();
  await scene.getByLabel("A thought to come back to").fill("   ");
  await expect(
    scene.getByRole("button", { name: "Keep this thought" }),
  ).toBeDisabled();
  const note = "Try the smallest even weight. " + "boundary".repeat(22);
  await scene.getByLabel("A thought to come back to").fill(note);
  await scene.getByRole("button", { name: "Keep this thought" }).click();
  const kept = demo.getByRole("region", { name: "Continue your thinking" });
  await expect(kept.getByText(note, { exact: true })).toBeVisible();
  await scene.getByRole("button", { name: "Fold the Ribbon" }).click();
  await expect(kept).toHaveCount(0);
  await demo
    .getByRole("button", { name: "Open companion", exact: true })
    .click();
  await expect(demo).toHaveAttribute("data-story-phase", "4");
  await expect(kept.getByText(note, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await scene.getByRole("button", { name: "Replay the story" }).click();
  await scene.getByRole("button", { name: "Select these lines" }).click();
  await expect(scene.getByLabel("A thought to come back to")).toHaveValue(note);
  await scene.getByRole("button", { name: "Keep this thought" }).click();
  await scene.getByRole("button", { name: "Fold the Ribbon" }).click();
  await scene.getByRole("button", { name: "Return to the problem" }).click();
  await scene
    .getByRole("button", { name: "Continue with this problem" })
    .click();
  await expect(demo).toHaveAttribute("data-compact", "false");
  await expect(demo).toHaveAttribute("data-step", "2");
  await expect(demo.getByLabel("Your explanation")).toHaveValue(note);
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  const workspace = page.getByRole("region", {
    name: "Interactive sample workspace",
  });
  await workspace.getByRole("tab", { name: "Practice", exact: true }).click();
  await expect(
    workspace.getByRole("article", { name: "Selected problem" }),
  ).toContainText(note);
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await expect(
    workspace.getByRole("article", { name: "Selected problem" }),
  ).not.toContainText(note);
  expect(posted).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("story playback pauses for editing and leaving the scene, then completes on request", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${siteBasePath}/`);
  await page.getByRole("button", { name: "See Forma in action" }).click();
  const demo = companion(page);
  const scene = story(page);
  await expect(
    scene.getByRole("button", { name: "Play the story" }),
  ).toBeVisible();
  await page.clock.install();
  await scene.getByRole("button", { name: "Play the story" }).click();
  await page.clock.fastForward(2500);
  await expect(demo).toHaveAttribute("data-story-phase", "1");
  const note = "Check whether two positive parts can fit.";
  await scene.getByLabel("A thought to come back to").fill(note);
  await expect(demo).toHaveAttribute("data-story-playing", "false");
  await page.clock.fastForward(10000);
  await expect(demo).toHaveAttribute("data-story-phase", "1");
  await scene.getByRole("button", { name: "Play the story" }).click();
  await page
    .getByRole("heading", { name: "Bring your curiosity. Keep the thread." })
    .scrollIntoViewIfNeeded();
  await expect(demo).toHaveAttribute("data-story-playing", "false");
  await scene.scrollIntoViewIfNeeded();
  await scene.getByRole("button", { name: "Play the story" }).click();
  await page.clock.fastForward(6000);
  await expect(demo).toHaveAttribute("data-story-phase", "2");
  await page.clock.fastForward(5200);
  await expect(demo).toHaveAttribute("data-story-phase", "3");
  await page.clock.fastForward(5200);
  await expect(demo).toHaveAttribute("data-story-phase", "4");
  await expect(demo).toHaveAttribute("data-story-playing", "false");
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText(note);
});

test("practice entry points open the matching workspace view and return focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${siteBasePath}/`);
  const paths = page.getByRole("group", { name: "Explore practice paths" });
  const workspace = page.getByRole("region", {
    name: "Interactive sample workspace",
  });
  for (const [label, view] of [
    ["Find your next practice", "Tracks"],
    ["The round ends. Keep learning", "Contests"],
  ]) {
    const trigger = paths.getByRole("button", { name: new RegExp(label) });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(
      workspace.getByRole("tab", { name: view, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      workspace.getByRole("heading", { name: view, exact: true }),
    ).toBeFocused();
    await workspace
      .getByRole("button", { name: "Close workspace preview" })
      .click();
    await expect(trigger).toBeFocused();
  }
});
