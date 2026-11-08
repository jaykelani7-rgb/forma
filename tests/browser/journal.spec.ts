import { expect, test } from "@playwright/test";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { emptyData, type Attempt, type Problem } from "../../src/lib/model";

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
