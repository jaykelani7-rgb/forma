import { expect, test, type Page } from "@playwright/test";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { emptyData, type Attempt, type Problem } from "../../src/lib/model";
import type { CatalogueProblem } from "../../src/lib/discovery";

test.use({ timezoneId: "Asia/Kolkata" });

const now = new Date("2026-11-08T12:00:00Z");
const handle = "journal_fixture";
const problem: Problem = {
  id: "personal-tree",
  title: "Tree paths",
  platform: "Codeforces",
  url: "https://codeforces.com/problemset/problem/1234/A",
  problemCode: "1234A",
  tags: ["trees"],
  rating: 1400,
  createdAt: "2026-09-01T00:00:00Z",
  reviewAt: null,
  reviewCount: 0,
};

function attempt(
  id: string,
  completedAt: string,
  outcome: Attempt["outcome"],
  takeaway: string,
  problemId = problem.id,
): Attempt {
  const elapsedMs = 10 * 60_000;
  return {
    id,
    problemId,
    completedAt,
    outcome,
    takeaway,
    elapsedMs,
    startedAt: new Date(Date.parse(completedAt) - elapsedMs).toISOString(),
    difficulty: null,
    notes: "",
  };
}

function fixture() {
  const data = connectProfile(
    emptyData(),
    { handle, rating: 1400, rank: "specialist" },
    now,
  );
  data.problems = [
    problem,
    {
      ...problem,
      id: "another-tree",
      title: "A different graph",
      problemCode: "1235A",
      url: "https://codeforces.com/problemset/problem/1235/A",
    },
  ];
  data.attempts = [
    attempt("early", "2026-09-23T10:00:00Z", "unsolved", "First attempt."),
    attempt(
      "independent",
      "2026-10-18T10:00:00Z",
      "independent",
      "Walk the tree.",
    ),
    attempt(
      "selected",
      "2026-10-19T10:00:00Z",
      "hint",
      "Check paths that end at the root.",
    ),
    attempt(
      "local-november",
      "2026-10-31T20:00:00Z",
      "hint",
      "This is November in the local timezone.",
    ),
    attempt(
      "unrelated",
      "2026-10-17T10:00:00Z",
      "hint",
      "Check the bridge.",
      "another-tree",
    ),
  ];
  const imported = mergeActivity(
    data,
    handle,
    [
      {
        handle,
        from: 1,
        count: 50,
        submissions: [
          {
            id: 901,
            submittedAt: "2026-10-21T11:00:00Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:1234:A",
              title: problem.title,
              code: problem.problemCode,
              url: problem.url,
              rating: problem.rating,
              tags: problem.tags,
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  return saveQuickReflection(
    imported,
    imported.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: null,
      takeaway: "Retried on Codeforces.",
      reviewAt: null,
      overrideSchedule: true,
    },
    now,
  );
}

test("journal filters combine and the selected reflection includes earlier and later attempts", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(now);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("forma.personal.v1")) {
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    }
  }, fixture());
  await page.goto("/journal");
  const entries = page.getByRole("button", { name: /^View entry:/ });
  await expect(entries).toHaveCount(6);
  await page.getByLabel("Search journal").fill("Tree paths");
  await expect(entries).toHaveCount(5);
  await page.getByLabel("Outcome", { exact: true }).selectOption("hint");
  await expect(entries).toHaveCount(3);
  await page.getByLabel("Source", { exact: true }).selectOption("timed");
  await expect(entries).toHaveCount(2);
  await page.getByLabel("Date", { exact: true }).selectOption("lastMonth");
  await expect(entries).toHaveCount(1);

  await entries.click();
  const detail = page.getByRole("region", { name: "Journal entry detail" });
  await expect(detail).toContainText("Check paths that end at the root.");
  const related = detail.getByRole("region", {
    name: "Other attempts on this problem",
  });
  await expect(related.getByRole("link")).toHaveCount(4);
  await expect(
    related.getByRole("link", { name: /Earlier attempt · Not solved yet/ }),
  ).toHaveCount(1);
  const importedRetry = related.getByRole("link", {
    name: /Later attempt .*Codeforces import/,
  });
  await expect(importedRetry).toHaveAttribute(
    "href",
    /#record-practice-codeforces%3A/,
  );
  await expect(
    detail.getByRole("link", { name: "Open original record" }),
  ).toHaveAttribute("href", /#record-practice-timed%3Aselected$/);

  if (testInfo.project.name === "mobile") {
    await expect(
      detail.getByRole("heading", { name: "Tree paths", exact: true }),
    ).toBeFocused();
    await detail.getByRole("button", { name: "Back to entries" }).click();
    await expect(entries).toBeFocused();
  } else {
    const entryBox = await entries.boundingBox();
    const detailBox = await detail.boundingBox();
    expect(detailBox!.x).toBeGreaterThan(entryBox!.x + entryBox!.width);
  }

  await page.getByLabel("Date", { exact: true }).selectOption("custom");
  await page.getByLabel("From date").fill("2026-11-01");
  await page.getByLabel("To date").fill("2026-11-01");
  await expect(entries).toHaveCount(1);
  await expect(entries).toContainText(
    "This is November in the local timezone.",
  );
  await page.getByLabel("To date").fill("2026-10-31");
  await expect(
    page.getByRole("group", { name: "Journal filters" }).getByRole("alert"),
  ).toHaveText("Choose an end date on or after the start date.");
  await expect(entries).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(entries).toHaveCount(6);
});

test("Then / Now compares saved attempts across Journal filters and keeps the selected entry", async ({
  page,
}, testInfo) => {
  const data = fixture();
  data.attempts = data.attempts.map((record) => record.id === "early" ? {
    ...record,
    outcome: "hint",
    approach: "Follow parent edges after a hint.",
    takeaway: "Track the path endpoint.",
  } : record);
  await page.clock.setFixedTime(now);
  await page.addInitScript((notebook) => {
    localStorage.setItem("forma.personal.v1", JSON.stringify(notebook));
  }, data);
  await page.goto("/journal");
  const entries = page.getByRole("button", { name: /^View entry:/ });
  const search = page.getByLabel("Search journal");
  const outcome = page.getByLabel("Outcome", { exact: true });
  await expect(entries).toHaveCount(6);
  await search.fill("Tree paths");
  await outcome.selectOption("independent");
  await expect(entries).toHaveCount(1);
  await entries.click();

  const compare = page.getByRole("button", { name: "Compare attempts" });
  await compare.press("Enter");
  const comparison = page.getByRole("dialog", { name: "Then / Now" });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "Then", exact: true })).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "Now", exact: true })).toBeVisible();
  await expect(comparison.getByText("Follow parent edges after a hint.", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Walk the tree.", { exact: true })).toBeVisible();
  await expect(comparison.getByText(/earlier attempt.*hint.*later attempt.*independent/i)).toBeVisible();
  const links = comparison.getByRole("link", { name: "Open original attempt" });
  await expect(links.nth(0)).toHaveAttribute("href", /#record-practice-timed%3Aearly$/);
  await expect(links.nth(1)).toHaveAttribute("href", /#record-practice-timed%3Aindependent$/);
  await page.screenshot({ path: testInfo.outputPath("journal-then-now.png") });

  await comparison.getByLabel("Compare with").selectOption("timed:selected");
  await expect(comparison.getByText("Follow parent edges after a hint.", { exact: true })).toHaveCount(0);
  await expect(comparison.getByText("Check paths that end at the root.", { exact: true })).toBeVisible();
  await expect(links.nth(0)).toHaveAttribute("href", /#record-practice-timed%3Aindependent$/);
  await expect(links.nth(1)).toHaveAttribute("href", /#record-practice-timed%3Aselected$/);
  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
  await expect(compare).toBeFocused();
  await expect(search).toHaveValue("Tree paths");
  await expect(outcome).toHaveValue("independent");
  await expect(entries).toHaveCount(1);
  await expect(entries).toHaveAttribute("aria-pressed", "true");
});

function catalogueEntry(
  contest: number,
  title: string,
  rating: number | null,
  tags: string[],
): CatalogueProblem {
  return {
    key: `contest:${contest}:A`,
    code: `${contest}A`,
    url: `https://codeforces.com/problemset/problem/${contest}/A`,
    title,
    rating,
    tags,
  };
}

const originalTakeaway = "Walk the tree.";
const freshProblem = catalogueEntry(1240, "Changing the root", 1500, [
  "trees",
  "greedy",
]);
const ineligibleProblems = [
  catalogueEntry(1234, problem.title, 1400, ["trees"]),
  catalogueEntry(1235, "A different graph", 1400, ["trees"]),
  catalogueEntry(1236, "Unrelated challenge", 1400, ["strings"]),
  catalogueEntry(1237, "Advanced challenge", 1800, ["trees"]),
  catalogueEntry(1238, "Unrated challenge", null, ["trees"]),
];

async function openTakeaway(page: Page, problems: CatalogueProblem[]) {
  await page.clock.setFixedTime(now);
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.takeaway-test-seeded")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.takeaway-test-seeded", "1");
  }, fixture());
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems },
    }),
  );
  await page.goto("/journal");
  await page
    .getByRole("button", {
      name: /^View entry: Tree paths, .*Solved independently$/,
    })
    .click();
  const detail = page.getByRole("region", { name: "Journal entry detail" });
  await expect(detail.getByText(originalTakeaway, { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Try it on a new problem" }).click();
  return detail;
}

test("a fresh Journal problem keeps its connection folded until reflection is saved", async ({
  page,
}) => {
  const detail = await openTakeaway(page, [...ineligibleProblems, freshProblem]);
  await expect(detail.getByText(freshProblem.title, { exact: true })).toBeVisible();
  await expect(detail.getByText("trees", { exact: true })).toHaveCount(0);
  const start = detail.getByRole("button", { name: "Start practice", exact: true });
  await expect(start).toHaveCount(1);
  await start.click();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByRole("heading", { name: freshProblem.title })).toBeVisible();

  const folded = page.getByText("The shared topic is folded until you save your reflection.");
  const connection = page.getByRole("region", { name: "The connection", exact: true });
  await expect(folded).toBeVisible();
  await page.reload();
  await expect(folded).toBeVisible();
  await expect(page.getByText(originalTakeaway, { exact: true })).toHaveCount(0);
  await expect(page.getByText("trees", { exact: true })).toHaveCount(0);
  await expect(page.getByText("greedy", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reveal pattern hint", { exact: true })).toHaveCount(0);
  await expect(connection).toHaveCount(0);

  await page.getByRole("button", { name: "Finish session", exact: true }).click();
  await expect(folded).toBeVisible();
  await expect(connection).toHaveCount(0);
  await page.getByRole("button", { name: "Solved independently", exact: true }).click();
  await page.getByLabel(/One thing to remember/).fill("Check every possible root.");
  await page.getByRole("button", { name: "Save reflection", exact: true }).click();
  await expect(connection).toBeVisible();
  await expect(connection).toContainText(problem.title);
  await expect(connection).toContainText(originalTakeaway);
  await expect(connection).toContainText("trees");

  await page.goto("/journal");
  await page.getByRole("button", { name: /^View entry: Changing the root,/ }).click();
  await expect(connection).toContainText(originalTakeaway);
  await expect(connection).toContainText("trees");
  const source = connection.getByRole("link", { name: "View earlier reflection" });
  await expect(source).toHaveAttribute(
    "href",
    "/problems/personal-tree?from=%2Fjournal#record-practice-timed%3Aindependent",
  );
  await source.click();
  const sourceRecord = page.locator('[id="record-practice-timed:independent"]');
  await expect(sourceRecord).toBeVisible();
  await expect(sourceRecord).toContainText(originalTakeaway);
});

test("Journal offers no practice start when every candidate is ineligible", async ({
  page,
}) => {
  const detail = await openTakeaway(page, ineligibleProblems);
  await expect(
    detail.getByText("No untried problem of a similar rating was found for this takeaway."),
  ).toBeVisible();
  await expect(detail.getByRole("button", { name: "Start practice", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/journal$/);
});
