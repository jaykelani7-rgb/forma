import { expect, test, type Page } from "@playwright/test";
import { siteBasePath, siteDownloadUrl, siteNotebookOrigin } from "./fixtures";

const companion = (page: Page) =>
  page.getByRole("region", { name: "Interactive Forma companion" });

async function openHome(page: Page) {
  await page.goto(`${siteBasePath}/`);
  await page.getByRole("button", { name: "See Forma in action" }).click();
  await companion(page)
    .getByRole("button", { name: "Try this problem" })
    .click();
  await companion(page).getByRole("button", { name: "Explore freely" }).click();
}

test("the homepage explains Forma and opens the relevant companion feature", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${siteBasePath}/`);
  await expect(
    page.getByRole("heading", {
      name: "Your thinking. Beside your code.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /A Mac workspace and floating companion that help you keep your/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download", exact: true }),
  ).toHaveAttribute("href", `${siteBasePath}/download/`);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    `${siteBasePath}/favicon.svg`,
  );
  expect((await page.request.get(`${siteBasePath}/favicon.svg`)).ok()).toBe(
    true,
  );
  const background = await page
    .locator('[class*="landscape"]')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  const artworkUrl = background.match(/url\("([^"]+)"\)/)?.[1];
  expect(artworkUrl).toBeTruthy();
  expect((await page.request.get(artworkUrl!)).ok()).toBe(true);
  await expect(page.locator('img[src*="silk-ribbon"]')).toHaveCount(0);
  const demo = companion(page);
  await expect(demo).toHaveCount(0);
  const invitation = page.getByRole("button", { name: "See Forma in action" });
  await expect(invitation).toBeInViewport();
  await invitation.click();
  await expect(demo).toBeVisible();
  await demo.getByRole("button", { name: "Use ink appearance" }).click();
  await demo.getByRole("button", { name: "Collapse companion" }).click();
  await demo
    .getByRole("button", { name: "Open companion", exact: true })
    .click();
  await demo.getByRole("button", { name: "Try this problem" }).click();
  await expect(demo).toHaveAttribute("data-compact", "false");
  await expect(demo.locator('[data-ink="true"]')).toBeVisible();
  await expect(
    demo.getByRole("heading", { name: "Start with a question in your code." }),
  ).toBeVisible();
  const workspace = page.getByRole("img", {
    name: /^Actual Forma desktop workspace/,
  });
  await expect(workspace).toBeVisible();
  expect(
    (await page.request.get((await workspace.getAttribute("src"))!)).ok(),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "Download", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${siteBasePath}/download/$`));
  await expect(
    page.getByRole("heading", { name: "Forma for Mac." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download for Mac", exact: true }),
  ).toHaveAttribute("href", siteDownloadUrl);
  await expect(
    page.getByRole("link", { name: "Export web data" }),
  ).toHaveAttribute("href", `${siteNotebookOrigin}/settings`);
  await expect(
    page.getByRole("link", { name: "Open web notebook" }),
  ).toHaveAttribute("href", `${siteNotebookOrigin}/today`);
});

test("the preview starts and folds the companion without losing the timer or persisting data", async ({
  page,
}) => {
  await page.goto(`${siteBasePath}/preview/`);
  await expect(
    page.getByRole("heading", { name: "A little room to try Forma." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const demo = companion(page);
  await demo.getByRole("button", { name: "Start sample session" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-site-scrolled",
    "true",
  );
  await expect(demo.locator("time").first()).not.toHaveText("00:00");
  await demo.getByRole("button", { name: "Collapse companion" }).click();
  await expect(
    demo.getByRole("button", { name: "Open companion", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await demo.getByRole("button", { name: "Pause sample timer" }).click();
  const paused = await demo.locator("time").textContent();
  await page.waitForTimeout(1100);
  await expect(demo.locator("time")).toHaveText(paused!);
  await demo
    .getByRole("button", { name: "Open companion", exact: true })
    .click();
  await expect(demo.locator("time").first()).toHaveText(paused!);
  await expect(
    demo.getByRole("button", { name: "Save a thought" }),
  ).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  await expect(
    demo.getByRole("button", { name: "Start sample session" }),
  ).toBeVisible();
  await expect(demo.locator("time").first()).toHaveText("00:00");
});

test("the real Problem Desk pins selected code and keeps editable threads and hypotheses", async ({
  page,
}) => {
  await openHome(page);
  const demo = companion(page);
  await demo.getByRole("button", { name: "Collapse companion" }).click();
  await demo.getByRole("button", { name: "Pin selection to desk" }).click();
  await expect(demo.getByRole("tab", { name: "Problem desk" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const notes = demo.getByRole("region", { name: "Working notes" });
  await expect(
    demo.getByRole("heading", { name: "Watermelon", exact: true }),
  ).toBeInViewport();
  await expect(notes).toContainText("1 item");
  await expect(notes).toContainText('cout << "YES";');
  await demo.getByRole("button", { name: "Open problem", exact: true }).click();
  await expect(
    demo.getByRole("button", { name: "Codeforces", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await demo.getByRole("button", { name: "VS Code", exact: true }).click();
  await demo.getByRole("button", { name: "Open pinned selection" }).click();
  await expect(notes).toContainText("1 item");
  await demo.getByRole("button", { name: "Hypothesis", exact: true }).click();
  await demo
    .getByLabel("Hypothesis", { exact: true })
    .fill("Both pieces must weigh at least two.");
  await demo.getByRole("button", { name: "Save to desk" }).click();
  await expect(notes).toContainText("2 items");
  await expect(notes).toContainText("Both pieces must weigh at least two.");
  await demo.getByRole("button", { name: "Leave a new thread" }).click();
  await demo.getByLabel("What would you try next?").fill(" ");
  await expect(
    demo.getByRole("button", { name: "Save thread" }),
  ).toBeDisabled();
  await demo
    .getByLabel("What would you try next?")
    .fill("Check 2 before trusting the even-number rule.");
  await demo.getByRole("button", { name: "Save thread" }).click();
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText("Check 2 before trusting the even-number rule.");
  await expect(demo.getByText("Earlier threads (1)")).toBeVisible();
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await demo.getByRole("button", { name: "Explore freely" }).click();
  await demo.getByRole("tab", { name: "Problem desk" }).click();
  await expect(notes).toContainText("0 items");
  await expect(
    demo.getByText("Check 2 before trusting the even-number rule."),
  ).toHaveCount(0);
});

test("idea review tests a sample assumption and keeps the next step as an editable draft", async ({
  page,
}) => {
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(request.url());
  });
  await page.goto(`${siteBasePath}/preview/`);
  const demo = companion(page);
  await demo.getByRole("tab", { name: "Explain an idea" }).click();
  await expect(demo.getByText(/Prepared Watermelon example/)).toBeVisible();
  await demo.getByLabel("Your explanation").fill("");
  await expect(
    demo.getByRole("button", { name: "Outline my idea" }),
  ).toBeDisabled();
  await demo
    .getByLabel("Your explanation")
    .fill("An even weight seems sufficient to me.");
  await demo.getByRole("button", { name: "Outline my idea" }).click();
  await expect(
    demo.getByRole("textbox", { name: "Approach", exact: true }),
  ).toHaveValue("An even weight seems sufficient to me.");
  await expect(
    demo.getByRole("button", { name: "Challenge this assumption" }),
  ).toBeDisabled();
  await demo.getByRole("radio", { name: "Challenge assumption 1" }).check();
  await demo.getByRole("checkbox", { name: "Include selected code" }).check();
  await demo.getByRole("button", { name: "Challenge this assumption" }).click();
  await expect(
    demo.getByRole("heading", { name: "One assumption to test" }),
  ).toBeVisible();
  await expect(demo.getByText("ILLUSTRATED CASE · NOT EXECUTED")).toBeVisible();
  await demo.getByRole("button", { name: "Keep as next step" }).click();
  const draft = demo.getByLabel("What would you try next?");
  await expect(draft).toHaveValue(
    "Test the smallest even weight: 2. Both parts must be positive and even.",
  );
  await draft.fill("My next step: test the boundary case 2.");
  await demo.getByRole("button", { name: "Save thread" }).click();
  await expect(
    demo.getByText("My next step: test the boundary case 2.", { exact: true }),
  ).toBeVisible();
  expect(posted).toEqual([]);
});

test("the hint card shows its sample context and carries a prepared hint into the desk", async ({
  page,
}) => {
  await page.goto(`${siteBasePath}/preview/`);
  const demo = companion(page);
  await demo.getByRole("tab", { name: "One small hint", exact: true }).click();
  await demo.getByText("Review problem statement", { exact: true }).click();
  await expect(
    demo.getByRole("heading", { name: "Constraints", exact: true }),
  ).toBeVisible();
  await demo
    .getByRole("checkbox", { name: "Include my latest hypothesis" })
    .check();
  await expect(
    demo.getByText(
      "Every even weight can be split into two positive even weights.",
      { exact: true },
    ),
  ).toBeVisible();
  await demo.getByRole("button", { name: "Send hint request" }).click();
  await expect(
    demo.getByText("smallest total weight", { exact: true }),
  ).toBeVisible();
  await demo.getByRole("button", { name: "Keep as next step" }).click();
  await expect(demo.getByLabel("What would you try next?")).toHaveValue(
    /smallest total weight/,
  );
  await demo.getByRole("button", { name: "Save thread" }).click();
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText("smallest total weight");
});

test("a reflection reaches the notebook and stays hidden until recall opens memory", async ({
  page,
}) => {
  await openHome(page);
  const demo = companion(page);
  await demo.getByRole("tab", { name: "Reflect", exact: true }).click();
  await expect(
    demo.getByRole("button", { name: "Save sample reflection" }),
  ).toBeDisabled();
  await demo.getByRole("button", { name: "With a hint" }).click();
  const takeaway =
    "Both parts must be positive. Always check the smallest case.";
  await demo.getByLabel("One thing to carry forward").fill(takeaway);
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await expect(
    demo.getByRole("heading", { name: "Reflection kept." }),
  ).toBeVisible();
  await expect(page.locator("#your-learning")).toContainText(takeaway);
  await expect(page.locator("#your-learning")).toContainText("With a hint");
  await demo.getByRole("button", { name: "Try a recall" }).click();
  await expect(demo.getByText(takeaway, { exact: true })).toHaveCount(0);
  await expect(
    demo.getByRole("button", { name: "Save sample recall" }),
  ).toBeDisabled();
  await demo
    .getByLabel("Your explanation")
    .fill("The weight needs to be even and greater than two.");
  await demo.getByRole("button", { name: "Open my memory" }).click();
  await expect(demo.getByText(takeaway, { exact: true })).toBeVisible();
  await demo.getByLabel("How did recall feel?").selectOption("Needed a cue");
  await demo.getByRole("button", { name: "Save sample recall" }).click();
  await expect(
    demo.getByRole("heading", { name: "Recall recorded." }),
  ).toBeVisible();
  await expect(demo.getByText("Needed a cue", { exact: true })).toBeVisible();
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await expect(
    page.locator("#your-learning").getByText(takeaway, { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("appearance controls update the companion and keyboard tabs remain usable", async ({
  page,
}) => {
  await page.goto(`${siteBasePath}/preview/`);
  const demo = companion(page);
  await demo.getByRole("tab", { name: "Focus", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(demo.getByRole("tab", { name: "Make it yours" })).toBeFocused();
  await expect(
    demo.getByRole("tab", { name: "Make it yours" }),
  ).toHaveAttribute("aria-selected", "true");
  await demo.getByRole("button", { name: "Small fold", exact: true }).click();
  await demo.getByRole("button", { name: "Right edge", exact: true }).click();
  await demo.getByRole("button", { name: "Still", exact: true }).click();
  await demo
    .getByRole("button", { name: "Preview focus", exact: true })
    .click();
  await expect(demo.getByLabel("Interactive ribbon preview")).toHaveAttribute(
    "data-edge",
    "right",
  );
  await demo.getByRole("button", { name: "Save appearance" }).click();
  await expect(
    demo.getByText("Appearance saved for this preview.", { exact: true }),
  ).toBeVisible();
  await expect(demo.locator('[data-folded="true"]')).toHaveAttribute(
    "data-edge",
    "right",
  );
  await demo.getByRole("button", { name: "Use ink appearance" }).click();
  await expect(demo.locator('[data-ink="true"]')).toBeVisible();
  await demo.getByRole("tab", { name: "Make it yours" }).focus();
  await page.keyboard.press("Home");
  await expect(
    demo.getByRole("tab", { name: "Focus", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(demo.getByRole("tab", { name: "Problem desk" })).toBeFocused();
  await expect(demo.getByRole("tab", { name: "Problem desk" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the narrow reduced-motion showcase fits long reflections and every feature", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await openHome(page);
  const demo = companion(page);
  for (const name of [
    "Focus",
    "Problem desk",
    "Explain an idea",
    "One small hint",
    "Reflect",
    "Recall",
    "Make it yours",
  ]) {
    await demo.getByRole("tab", { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await demo.getByRole("tab", { name: "Reflect", exact: true }).click();
  await demo.getByRole("button", { name: "Independent" }).click();
  const longThought = "CheckTheSmallestCaseBeforeTrustingThePattern"
    .repeat(7)
    .slice(0, 300);
  await demo.getByLabel("One thing to carry forward").fill(longThought);
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await expect(demo.getByText(longThought, { exact: true })).toBeVisible();
  await expect(
    page.locator("#your-learning").getByText(longThought, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const card = demo.locator('[class*="nativeCard"]');
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "none",
  );
  const lastControl = await demo
    .getByRole("button", { name: "Edit reflection" })
    .boundingBox();
  const bounds = await card.boundingBox();
  expect(lastControl!.y + lastControl!.height).toBeLessThan(
    bounds!.y + bounds!.height,
  );
});

test("one guided session carries the visitor's thought through challenge, reflection and recall", async ({
  page,
}) => {
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(request.url());
  });
  await page.goto(`${siteBasePath}/`);
  await page.getByRole("button", { name: "See Forma in action" }).click();
  const demo = companion(page);
  await demo.getByRole("button", { name: "Try this problem" }).click();
  const journey = demo.getByRole("navigation", {
    name: "Your practice journey",
  });
  await expect(
    demo.getByRole("button", { name: "Continue to keep a thought" }),
  ).toBeDisabled();
  await demo.getByRole("button", { name: "Pin selection to desk" }).click();
  await expect(demo).toHaveAttribute("data-step", "1");
  const thought = "I think an even weight is enough; test the smallest one.";
  await demo.getByLabel("What would you try next?").fill(thought);
  await demo.getByRole("button", { name: "Save thread" }).click();
  await demo.getByRole("button", { name: "Continue to question it" }).click();
  await expect(demo.getByLabel("Your explanation")).toHaveValue(thought);
  await demo.getByRole("button", { name: "Outline my idea" }).click();
  await demo.getByRole("radio", { name: "Challenge assumption 1" }).check();
  await demo.getByRole("button", { name: "Challenge this assumption" }).click();
  const illustration = demo.getByRole("region", {
    name: "Explore the boundary case",
  });
  await expect(illustration).toContainText("1 + 1 uses odd parts");
  await illustration.getByRole("button", { name: "8", exact: true }).click();
  await expect(illustration).toContainText("2 + 6 works");
  await demo.getByRole("button", { name: "Keep as next step" }).click();
  const takeaway = "Check 2: two positive even parts need at least four.";
  await demo.getByLabel("What would you try next?").fill(takeaway);
  await expect(
    demo.getByRole("button", { name: "Continue to reflect" }),
  ).toBeDisabled();
  await demo.getByRole("button", { name: "Save thread" }).click();
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText(takeaway);
  await demo
    .getByRole("button", { name: "Open solution", exact: true })
    .click();
  await expect(
    demo.getByRole("button", { name: "VS Code", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    demo.getByRole("button", { name: "Open pinned selection" }),
  ).toBeVisible();
  await demo.getByRole("button", { name: "Continue to reflect" }).click();
  await expect(demo.getByLabel("One thing to carry forward")).toHaveValue(
    takeaway,
  );
  await demo.getByRole("button", { name: /With a hint$/ }).click();
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await expect(page.locator("#your-learning")).toContainText(takeaway);
  await demo.getByRole("button", { name: "Continue to recall" }).click();
  await expect(demo.getByText(takeaway, { exact: true })).toHaveCount(0);
  await expect(
    demo.getByRole("complementary", { name: "Your practice thread" }),
  ).toContainText("stays closed");
  await demo.getByLabel("Your explanation").fill("Even and greater than two.");
  await demo.getByRole("button", { name: "Open my memory" }).click();
  await expect(demo.getByText(takeaway, { exact: true }).first()).toBeVisible();
  await demo.getByRole("button", { name: "Save sample recall" }).click();
  await expect(demo.getByText("You’ve kept the whole thread.")).toBeVisible();
  await expect(demo.locator("dl")).toContainText(thought);
  await expect(demo.locator("dl")).toContainText(takeaway);
  await expect(
    demo.getByRole("link", { name: "Download Forma for Mac" }),
  ).toHaveAttribute("href", siteDownloadUrl);
  await expect(journey.getByText("completed", { exact: true })).toHaveCount(5);
  await journey.getByRole("button", { name: /Keep a thought/ }).click();
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText(takeaway);
  expect(posted).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await expect(journey.getByText("completed", { exact: true })).toHaveCount(0);
  await expect(page.locator("#your-learning")).not.toContainText(takeaway);
});

test("the guided path supports keyboard navigation, narrow screens and zoom-equivalent reflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${siteBasePath}/#try-forma`);
  const demo = companion(page);
  await expect(demo).toHaveAttribute("data-compact", "false");
  await expect(
    demo.getByRole("button", { name: "Pin selection to desk" }),
  ).toBeVisible();
  await demo.getByRole("button", { name: "Pin selection to desk" }).click();
  await demo
    .getByLabel("What would you try next?")
    .fill("Keep the boundary in mind.");
  await demo.getByRole("button", { name: "Save thread" }).click();
  const next = demo.getByRole("button", { name: "Continue to question it" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(
    demo.getByRole("heading", { name: "Find the assumption worth testing." }),
  ).toBeFocused();
  const journey = demo.getByRole("navigation", {
    name: "Your practice journey",
  });
  for (const label of [
    "Select code",
    "Keep a thought",
    "Question it",
    "Reflect",
    "Recall",
  ]) {
    await journey.getByRole("button", { name: new RegExp(label) }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  // A 1280 × 900 window at 200% browser zoom has a 640 × 450 CSS viewport.
  await page.setViewportSize({ width: 640, height: 450 });
  await journey.getByRole("button", { name: /Reflect/ }).click();
  await demo.getByRole("button", { name: /Independent$/ }).click();
  await demo
    .getByLabel("One thing to carry forward")
    .fill("The same reflection works after viewport reflow.");
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await expect(
    demo.getByRole("heading", { name: "Reflection kept." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("the same companion keeps its timer and pauses counting outside the viewport", async ({
  page,
}) => {
  await page.goto(`${siteBasePath}/`);
  await page.getByRole("button", { name: "See Forma in action" }).click();
  const demo = companion(page);
  await demo.getByRole("button", { name: "Resume sample timer" }).click();
  await expect(demo.locator("time").first()).not.toHaveText("00:00");
  const before = await demo.locator("time").first().textContent();
  await demo.getByRole("button", { name: "Try this problem" }).click();
  expect(await demo.locator("time").first().textContent()).not.toBe("00:00");
  expect(before).not.toBe("00:00");
  await page.locator("#questions").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const paused = await demo.locator("time").first().textContent();
  await page.waitForTimeout(1400);
  await expect(demo.locator("time").first()).toHaveText(paused!);
});

test("workspace views share the companion reflection, reopen context, and clear on reset", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${siteBasePath}/`);
  await page
    .getByRole("button", { name: "Explore the sample workspace" })
    .click();
  const workspace = page.getByRole("region", {
    name: "Interactive sample workspace",
  });
  await expect(
    workspace.getByRole("heading", { name: "Today", exact: true }),
  ).toBeFocused();
  await workspace.getByRole("tab", { name: "Today", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    workspace.getByRole("tab", { name: "Practice", exact: true }),
  ).toBeFocused();
  await workspace
    .getByRole("searchbox", { name: "Find a problem" })
    .fill("missing");
  await expect(workspace.getByRole("status")).toContainText(
    "No sample problems match",
  );
  await workspace.getByRole("searchbox").fill("Diagonal");
  await workspace
    .getByRole("button", { name: "Diagonal Traverse Example record" })
    .click();
  await expect(
    workspace.getByRole("article", { name: "Selected problem" }),
  ).toContainText("single row");
  await workspace.getByRole("tab", { name: "Today", exact: true }).click();
  await workspace.getByRole("button", { name: "Open in companion" }).click();
  const demo = companion(page);
  await demo.getByRole("button", { name: "Pin selection to desk" }).click();
  await demo.getByRole("button", { name: "Leave a new thread" }).click();
  await demo
    .getByLabel("What would you try next?")
    .fill("Keep my boundary question with this problem.");
  await demo.getByRole("button", { name: "Save thread" }).click();
  await demo.getByRole("tab", { name: "Reflect", exact: true }).click();
  await demo.getByRole("button", { name: "Independent" }).click();
  const note = "My takeaway goes from Ribbon into the workspace.";
  await demo.getByLabel("One thing to carry forward").fill(note);
  await demo.getByRole("button", { name: "Save sample reflection" }).click();
  await demo.getByRole("link", { name: "See it in your notebook" }).click();
  await expect(
    workspace.getByRole("tab", { name: "Journal", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    workspace.getByRole("article", { name: "Your Watermelon reflection" }),
  ).toContainText(note);
  await workspace
    .getByRole("button", { name: "Reopen problem", exact: true })
    .click();
  await expect(
    demo.getByRole("region", { name: "Continue your thinking" }),
  ).toContainText("Keep my boundary question");
  await expect(
    demo.getByRole("region", { name: "Working notes" }),
  ).toContainText("VS Code selection");
  await demo.getByRole("button", { name: "Reset preview" }).click();
  await expect(
    workspace.getByRole("article", { name: "Your Watermelon reflection" }),
  ).toHaveCount(0);
  await expect(workspace).not.toContainText(note);
  await page.setViewportSize({ width: 320, height: 740 });
  await workspace.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await workspace
    .getByRole("button", { name: "Close workspace preview" })
    .click();
  await expect(
    page.getByRole("button", { name: "Explore the sample workspace" }),
  ).toBeFocused();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
