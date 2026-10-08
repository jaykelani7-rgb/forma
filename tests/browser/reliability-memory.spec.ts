import { expect, test, type Page, type Locator } from "@playwright/test";
import { emptyData, type Data } from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { linkLearningAttempts } from "../../src/lib/learning";
import { saveRevision } from "../../src/lib/memory";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-07T04:30:00Z");
const firstTitle = "Sereja and Dima";
const nextTitle = "An untouched follow-up";
const trackId = "reliability-track";
const stageId = "reliability-stage";
const stagePath = `/tracks/${trackId}/stages/${stageId}`;
const firstUrl = "https://codeforces.com/problemset/problem/381/A";

function addTrack(data: Data): Data {
  return importTrack(
    data,
    {
      id: trackId,
      title: "Review reliability notebook",
      sourceName: "reliability.docx",
      sourceFingerprint: "reliability-sheet",
      stages: [
        {
          id: stageId,
          title: "Foundation",
          description: "Practise boundaries deliberately.",
          suggestedTime: "20 minutes",
          entries: [
            {
              id: "entry-381A",
              title: firstTitle,
              code: "381A",
              url: firstUrl,
              rating: 800,
              pattern: "Keep the ends hidden until requested.",
            },
            {
              id: "entry-1511C",
              title: nextTitle,
              code: "1511C",
              url: "https://codeforces.com/problemset/problem/1511/C",
              rating: 1100,
              pattern: "A second source hint.",
            },
          ],
        },
      ],
    },
    { duplicates: "reject" },
    now,
  );
}
function addActivity(data: Data): Data {
  const connected = connectProfile(
    data,
    { handle: "jay", rating: null, rank: null },
    now,
  );
  return mergeActivity(
    connected,
    "jay",
    [
      {
        handle: "jay",
        from: 1,
        count: 50,
        submissions: [
          {
            id: 1,
            submittedAt: "2026-10-06T04:00:00Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A",
              title: firstTitle,
              code: "381A",
              url: firstUrl,
              rating: 800,
              tags: ["two pointers"],
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
}
function scheduled(before: boolean): Data {
  let data = before
    ? addActivity(addTrack(emptyData()))
    : addTrack(addActivity(emptyData()));
  data = saveQuickReflection(
    data,
    data.codeforces.practiceAttempts[0].id,
    {
      outcome: "hint",
      difficulty: "edges",
      takeaway: "Pay attention to the last remaining element.",
      reviewAt: "2026-10-12",
      overrideSchedule: true,
    },
    now,
  );
  return data;
}
async function seed(page: Page, data: Data) {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.reliability-memory")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.theme", "light");
    localStorage.setItem("forma.reliability-memory", "seeded");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
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
async function editFirst(page: Page) {
  await page.goto("/problems");
  await page.getByRole("button", { name: firstTitle, exact: true }).click();
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  return page.getByRole("dialog");
}
async function metric(summary: Locator, label: string, value: string) {
  await expect(
    summary.getByText(label, { exact: true }).locator("..").locator("dd"),
  ).toHaveText(value);
}

test("a rejected track problem identity edit keeps the draft, exports valid original references, and permits safe metadata changes", async ({
  page,
}) => {
  const data = addTrack(emptyData());
  const first = data.problems.find(
    (problem) => problem.problemCode === "381A",
  )!;
  await seed(page, data);
  let dialog = await editFirst(page);
  await dialog
    .getByLabel("Problem name", { exact: true })
    .fill("A retained editing draft");
  await dialog.getByLabel(/^Problem ID/).fill("189A");
  await dialog
    .getByLabel(/^Problem link/)
    .fill("https://codeforces.com/problemset/problem/189/A");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "To replace a track problem, use Edit track",
  );
  await expect(dialog.getByLabel("Problem name", { exact: true })).toHaveValue(
    "A retained editing draft",
  );
  await expect(dialog.getByLabel(/^Problem ID/)).toHaveValue("189A");
  expect(
    (await durable(page)).problems.find((problem) => problem.id === first.id),
  ).toMatchObject({ title: firstTitle, problemCode: "381A", url: firstUrl });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/settings");
  await expect(
    page.getByText("Storage needs attention.", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Export my data", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("View backup JSON", { exact: true }).click();
  const backup = JSON.parse(
    await dialog.getByLabel("Backup JSON", { exact: true }).inputValue(),
  ) as Data;
  expect(
    backup.problems.find((problem) => problem.id === first.id)?.problemCode,
  ).toBe("381A");
  expect(
    backup.trackEntries!.find((entry) => entry.id === "entry-381A"),
  ).toMatchObject({ problemId: first.id, code: "381A", url: firstUrl });
  await page.keyboard.press("Escape");
  dialog = await editFirst(page);
  await dialog
    .getByLabel("Problem name", { exact: true })
    .fill("A clearer saved title");
  await dialog.getByLabel(/^Rating/).fill("900");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await durable(page);
  expect(
    saved.problems.find((problem) => problem.id === first.id),
  ).toMatchObject({
    title: "A clearer saved title",
    rating: 900,
    problemCode: "381A",
    url: firstUrl,
  });
  expect(
    saved.trackEntries!.find((entry) => entry.id === "entry-381A")?.problemId,
  ).toBe(first.id);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "A clearer saved title", exact: true }),
  ).toBeVisible();
});

for (const before of [true, false]) {
  test(`a sheet imported ${before ? "before" : "after"} Codeforces sync respects a future matching revisit across Today, stage, and reload`, async ({
    page,
  }) => {
    const data = scheduled(before);
    await seed(page, data);
    await page.goto(stagePath);
    const next = page.getByRole("region", {
      name: "Suggested next track problem",
      exact: true,
    });
    await expect(
      next.getByRole("heading", { name: nextTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Progress for ${firstTitle}`, { exact: true }),
    ).toContainText("Revisit 2026-10-12");
    await expect(
      page.getByRole("button", {
        name: `Start practice: ${firstTitle}`,
        exact: true,
      }),
    ).toBeEnabled();
    await page.goto("/");
    await expect(page.locator("#session-card-title")).toContainText(nextTitle);
    await page.reload();
    await expect(page.locator("#session-card-title")).toContainText(nextTitle);
    expect(
      (await durable(page)).problems.find(
        (problem) => problem.cfHandle === "jay",
      )?.reviewAt,
    ).toBe("2026-10-12");
    await page.clock.setFixedTime(new Date("2026-10-12T04:30:00Z"));
    await page.reload();
    await expect(page.locator("#session-card-title")).toContainText(firstTitle);
    await page.goto(stagePath);
    await expect(
      next.getByRole("heading", { name: firstTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Progress for ${firstTitle}`, { exact: true }),
    ).toContainText("Revisit due");
    const saved = await durable(page);
    expect(saved.session).toBeNull();
    expect(saved.codeforces.practiceAttempts).toHaveLength(1);
    expect(saved.codeforces.reflections).toHaveLength(1);
  });
}

test("selected-period learning evidence separates linked source counts and recall from coding time while recall defaults persist", async ({
  page,
}) => {
  let data = addActivity(addTrack(emptyData()));
  const personal = data.problems.find(
    (problem) => !problem.cfHandle && problem.problemCode === "381A",
  )!;
  data.attempts = [
    {
      id: "prior-assisted",
      problemId: personal.id,
      startedAt: "2026-10-02T03:50:00Z",
      completedAt: "2026-10-02T04:00:00Z",
      elapsedMs: 600000,
      outcome: "hint",
      difficulty: null,
      takeaway: "Inspect the endpoints.",
      notes: "",
    },
    {
      id: "linked-practice",
      problemId: personal.id,
      startedAt: "2026-10-06T03:55:00Z",
      completedAt: "2026-10-06T04:00:00Z",
      elapsedMs: 300000,
      outcome: "independent",
      difficulty: null,
      takeaway: "One move shrinks the remaining interval.",
      notes: "",
      mistakes: ["indexing"],
    },
  ];
  const activity = data.codeforces.practiceAttempts[0];
  data = linkLearningAttempts(
    data,
    "linked-practice",
    activity.id,
    "timed",
    now,
  );
  data = saveRevision(data, {
    id: "recall-explain",
    problemId: personal.id,
    handle: "jay",
    activity: "explain",
    outcome: "cue",
    response: "One endpoint is removed per move.",
    cue: "Which values remain?",
    completedAt: "2026-10-06T04:30:00Z",
    nextReviewAt: "2026-10-10",
  });
  data = saveRevision(data, {
    id: "recall-complexity",
    problemId: personal.id,
    handle: "jay",
    activity: "complexity",
    outcome: "independent",
    response: "O(n) time and constant space.",
    cue: "Single remaining item.",
    completedAt: now.toISOString(),
    nextReviewAt: "2026-10-14",
  });
  await seed(page, data);
  await page.goto("/progress");
  const summary = page.getByRole("region", { name: /What your records show/ });
  await summary
    .getByLabel("Learning period", { exact: true })
    .selectOption("custom");
  await summary.getByLabel("From", { exact: true }).fill("2026-10-05");
  await summary.getByLabel("Through", { exact: true }).fill("2026-10-07");
  await metric(summary, "Practice events", "1");
  await metric(summary, "Timed only", "0");
  await metric(summary, "Imported only", "0");
  await metric(summary, "Linked timed + imported", "1");
  await metric(summary, "Measured practice", "5 min");
  await metric(summary, "Written recall checks", "2");
  await expect(summary).toContainText(
    "1 independently · 1 with a cue · 0 not recalled yet",
  );
  await expect(
    summary
      .getByRole("heading", {
        name: "Independent after assistance",
        exact: true,
      })
      .locator(".."),
  ).toContainText(firstTitle);
  await expect(summary).toContainText("Off-by-one or indexing · 1 reflection");
  await summary.getByLabel("From", { exact: true }).fill("2026-10-07");
  await metric(summary, "Practice events", "0");
  await metric(summary, "Timed only", "0");
  await metric(summary, "Imported only", "0");
  await metric(summary, "Linked timed + imported", "0");
  await metric(summary, "Measured practice", "0 min");
  await metric(summary, "Written recall checks", "1");
  await expect(summary).toContainText(
    "No independent reflection after an earlier hint or editorial is recorded in this period",
  );
  await page.goto("/settings");
  const defaults = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Written recall", exact: true }),
  });
  await defaults.getByLabel(/^Recalled independently/).fill("8");
  await defaults.getByLabel(/^Needed a cue/).fill("4");
  await defaults.getByLabel(/^Could not recall yet/).fill("2");
  await defaults
    .getByRole("button", { name: "Save recall defaults", exact: true })
    .click();
  await expect
    .poll(async () => (await durable(page)).settings.recallDays)
    .toEqual({ independent: 8, cue: 4, unrecalled: 2 });
  await page.reload();
  await expect(defaults.getByLabel(/^Needed a cue/)).toHaveValue("4");
  await page.goto(
    `/problems/${encodeURIComponent(personal.id)}?revision=explain`,
  );
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Needed a cue", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Next recall date", { exact: true }),
  ).toHaveValue("2026-10-11");
  const saved = await durable(page);
  expect(saved.attempts).toHaveLength(2);
  expect(saved.revisions).toHaveLength(2);
  expect(saved.revisions!.at(-1)!.nextReviewAt).toBe("2026-10-14");
});
