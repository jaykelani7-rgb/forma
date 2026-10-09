import { expect, test, type Locator, type Page } from "@playwright/test";
import { connectProfile } from "../../src/lib/codeforces";
import {
  createContest,
  editContest,
  endContest,
  startContest,
} from "../../src/lib/contest-lab";
import { learningHistory } from "../../src/lib/learning";
import {
  learningEvidenceHref,
  memoryRecordAnchor,
} from "../../src/lib/learning-insights";
import {
  emptyData,
  validateData,
  type Data,
  type Problem,
} from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-08T06:30:00.000Z");
const contestId = "contest-evidence";
const contestName = "Confirmed boundary practice";
const archive = "learning_archive";
const current = "learning_current";
const titles = ["A careful boundary", "Two equal endpoints"];
const trackId = "contest-evidence-track";
const stageId = "contest-evidence-stage";

function problem(index: number): Problem {
  return {
    id: `contest-evidence-${index}`,
    title: titles[index],
    platform: "Codeforces",
    url: `https://codeforces.com/problemset/problem/4/${index ? "B" : "A"}`,
    problemCode: index ? "4B" : "4A",
    rating: 800,
    tags: ["implementation"],
    createdAt: "2026-09-01T06:00:00.000Z",
    reviewAt: null,
    reviewCount: 0,
  };
}

function fixture(archived = false): Data {
  const started = new Date(
    archived ? "2026-09-28T06:00:00.000Z" : "2026-10-08T06:00:00.000Z",
  );
  let data: Data = { ...emptyData(), problems: [problem(0), problem(1)] };
  if (archived)
    data = connectProfile(
      data,
      { handle: archive, rating: null, rank: null },
      started,
    );
  data = startContest(
    createContest(
      data,
      contestId,
      contestName,
      30,
      data.problems,
      false,
      "manual",
      started,
    ),
    contestId,
    started,
  );
  data = endContest(
    data,
    contestId,
    "early",
    new Date(started.getTime() + 600000),
  );
  data = editContest(data, contestId, (contest) => ({
    ...contest,
    problems: contest.problems.map((row) => ({
      ...row,
      reflection: {
        outcome: "independent",
        difficulty: "edges",
        mistakes: ["edges"],
        takeaway: "Keep both endpoints explicit.",
        // The archived fixture deliberately edits an old reflection today.
        savedAt: new Date(now.getTime() - 600000).toISOString(),
      },
    })),
  }));
  data = importTrack(
    data,
    {
      id: trackId,
      title: "Contest evidence track",
      sourceName: "manual",
      sourceFingerprint: "contest-evidence-browser",
      stages: [
        {
          id: stageId,
          title: "Boundaries",
          description: "",
          suggestedTime: "",
          entries: data.problems.map((row, index) => ({
            id: `contest-evidence-entry-${index}`,
            title: row.title,
            code: row.problemCode,
            url: row.url,
            rating: row.rating,
            pattern: "",
          })),
        },
      ],
    },
    undefined,
    now,
  );
  data = {
    ...data,
    activeTrackId: null,
    settings: {
      ...data.settings,
      practicePreferences: {
        dailyMinutes: 15,
        preferredDays: [0, 1, 2, 3, 4, 5, 6],
        mode: "mixed",
        targetDate: null,
      },
    },
  };
  if (archived) {
    data = connectProfile(
      data,
      { handle: current, rating: null, rank: null },
      now,
    );
    const oldProblem: Problem = {
      ...problem(0),
      id: "old-regular-practice",
      title: "An older regular session",
      problemCode: "381A",
      url: "https://codeforces.com/problemset/problem/381/A",
    };
    data = {
      ...data,
      problems: [...data.problems, oldProblem],
      attempts: [
        {
          id: "old-regular-session",
          problemId: oldProblem.id,
          startedAt: started.toISOString(),
          completedAt: new Date(started.getTime() + 300000).toISOString(),
          elapsedMs: 300000,
          outcome: "unsolved",
          difficulty: null,
          takeaway: "Original regular attempt.",
          notes: "",
        },
      ],
    };
  }
  return validateData(data);
}

async function seed(page: Page, data: Data) {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.contest-learning-fixture")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "light");
    localStorage.setItem("forma.contest-learning-fixture", "seeded");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (route) =>
    route.fulfill({
      json: {
        handle: data.codeforces.connectedHandle,
        rating: null,
        rank: null,
      },
    }),
  );
}

async function durable(page: Page): Promise<Data> {
  return page.evaluate(
    () =>
      new Promise<Data>((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
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
      }),
  );
}

async function dates(page: Page, day: string) {
  await page
    .getByRole("combobox", { name: "Learning period", exact: true })
    .selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill(day);
  await page.getByLabel("Through", { exact: true }).fill(day);
}

async function metric(summary: Locator, label: string, value: string) {
  await expect(
    summary.getByText(label, { exact: true }).locator("..").locator("dd"),
  ).toHaveText(value);
}

test("confirmed contest-only learning agrees across Today, Memory, Progress and track evidence without invented time", async ({
  page,
}) => {
  const data = fixture();
  const record = learningHistory(data).find(
    (record) => record.problemId === problem(0).id,
  )!;
  const anchor = memoryRecordAnchor("practice", record.id);
  await seed(page, data);
  await page.goto("/");
  const primary = page.locator(".session-card");
  await expect(primary).toContainText(titles[0]);
  await expect(primary).toContainText(
    "A familiar eligible problem from your saved collection.",
  );
  await expect(primary).not.toContainText("untouched");
  await expect(
    page.getByRole("region", { name: "A gentle return", exact: true }),
  ).toHaveCount(0);
  await primary
    .locator("summary")
    .filter({ hasText: "Why this activity?" })
    .click();
  const evidence = primary.getByRole("link", { name: /Confirmed in contest/ });
  await expect(evidence).toHaveAttribute(
    "href",
    `/problems/${problem(0).id}?from=%2F#${encodeURIComponent(anchor)}`,
  );
  await evidence.click();
  const memorySummary = page.getByRole("region", {
    name: "What your records show",
    exact: true,
  });
  await expect(
    memorySummary
      .getByText("Most recent reflected outcome", { exact: true })
      .locator(".."),
  ).toContainText("Solved independently");
  await expect(
    memorySummary.getByRole("link", {
      name: `Confirmed contest reflection · ${contestName}`,
      exact: true,
    }),
  ).toHaveAttribute("href", `/contests/${contestId}`);
  await expect(memorySummary).toContainText(
    "No platform acceptance recorded in this history",
  );
  await expect(memorySummary).toContainText(
    "Missed edge case was marked in 1 reflection.",
  );
  const event = page.locator(`[id="${anchor}"]`);
  await expect(event).toBeInViewport();
  await expect(event).toContainText(`Contest participation · ${contestName}`);
  await expect(event).toContainText("Time not measured");
  await expect(
    event.getByRole("link", { name: "Review contest reflection", exact: true }),
  ).toHaveAttribute("href", `/contests/${contestId}`);
  await expect(
    event.getByRole("button", { name: /^Edit reflection:/ }),
  ).toHaveCount(0);
  await page.goto("/progress");
  await dates(page, "2026-10-08");
  const summary = page.getByRole("region", {
    name: "What your records show.",
    exact: true,
  });
  await metric(summary, "Practice events", "2");
  await metric(summary, "Contest problem events", "2");
  await metric(summary, "Timed only", "0");
  await metric(summary, "Imported only", "0");
  await metric(summary, "Measured practice", "0 min");
  await expect(
    page.getByRole("img", {
      name: "2 independent solves, 0 assisted attempts, 0 not solved yet.",
    }),
  ).toBeVisible();
  const repeated = page
    .getByRole("heading", {
      name: "Labels you recorded more than once",
      exact: true,
    })
    .locator("..");
  await expect(repeated).toContainText("2 reflected coding records considered");
  await repeated
    .locator("summary")
    .filter({ hasText: "Missed edge case" })
    .click();
  await expect(repeated).toContainText("2 reflections");
  for (const title of titles)
    await expect(
      repeated.getByRole("link", { name: title, exact: true }),
    ).toHaveCount(1);
  const sourceLink = repeated.getByRole("link", {
    name: titles[0],
    exact: true,
  });
  await expect(sourceLink).toHaveAttribute(
    "href",
    learningEvidenceHref(
      record.problemId,
      "practice",
      record.id,
      record.handle,
    ),
  );
  await page.goto(`/tracks/${trackId}`);
  await expect(
    page.getByRole("progressbar", {
      name: "2 of 2 reflected independently",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/tracks/${trackId}/stages/${stageId}`);
  for (const title of titles) {
    const status = page.locator(`[aria-label="Progress for ${title}"]`);
    await expect(status).toContainText("Attempted");
    await expect(status).toContainText("Reflected independently");
    await expect(status).not.toContainText("Accepted on Codeforces");
    await expect(status).not.toContainText("Not started");
  }
  const saved = await durable(page);
  expect(saved.attempts).toEqual([]);
  expect(saved.codeforces.submissions).toEqual([]);
  expect(saved.contests).toEqual(data.contests);
});

test("editing an archived old contest does not reset the coding break or add evidence to today's range or current profile", async ({
  page,
}) => {
  const data = fixture(true);
  const record = learningHistory(data, { handle: archive }).find(
    (record) => record.problemId === problem(0).id,
  )!;
  await seed(page, data);
  await page.goto("/");
  const welcome = page.getByRole("region", {
    name: "A gentle return",
    exact: true,
  });
  await expect(welcome).toContainText("Your last saved practice was Sep 28.");
  await page.goto(`/tracks/${trackId}/stages/${stageId}`);
  await expect(
    page.getByText("Reflected independently", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Not started", { exact: true })).toHaveCount(2);
  await page.goto("/progress");
  await dates(page, "2026-10-08");
  const summary = page.getByRole("region", {
    name: "What your records show.",
    exact: true,
  });
  await metric(summary, "Practice events", "0");
  await metric(summary, "Contest problem events", "0");
  const profiles = page.getByRole("combobox", {
    name: "Learning profile",
    exact: true,
  });
  await expect(profiles).toHaveValue(current);
  await profiles.selectOption(archive);
  await metric(summary, "Practice events", "0");
  await expect(
    page.getByRole("heading", {
      name: "Labels you recorded more than once",
      exact: true,
    }),
  ).toHaveCount(0);
  await dates(page, "2026-09-28");
  await metric(summary, "Contest problem events", "2");
  const repeated = page
    .getByRole("heading", {
      name: "Labels you recorded more than once",
      exact: true,
    })
    .locator("..");
  await repeated
    .locator("summary")
    .filter({ hasText: "Missed edge case" })
    .click();
  const link = repeated.getByRole("link", { name: titles[0], exact: true });
  await expect(link).toHaveAttribute(
    "href",
    learningEvidenceHref(record.problemId, "practice", record.id, archive),
  );
  await link.click();
  await expect(
    page.getByText(
      `Read-only evidence for ${archive}. The connected profile is unchanged.`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.locator(`[id="${memoryRecordAnchor("practice", record.id)}"]`),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Re-solve the problem", exact: true }),
  ).toBeDisabled();
  const saved = await durable(page);
  expect(saved.codeforces.connectedHandle).toBe(current);
  expect(saved.attempts).toEqual(data.attempts);
  expect(saved.contests).toEqual(data.contests);
});
