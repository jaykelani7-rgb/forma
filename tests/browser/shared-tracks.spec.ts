import {
  devices,
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyData, type Data } from "../../src/lib/model";
import { connectProfile, mergeActivity } from "../../src/lib/codeforces";
import { parsePracticeSheet } from "../../src/lib/docx-import";
import { importTrack } from "../../src/lib/tracks";
import type { TrackImportDraft } from "../../src/lib/tracks-types";

test.use({ timezoneId: "Asia/Kolkata" });
const now = new Date("2026-10-09T04:30:00Z");
const title = "A shared course in careful boundaries";
const privateText = "PRIVATE-NOTE-9f29";
const description = "Choose an invariant before moving either endpoint.";
const hint = "Optional pattern hint: compare the outer endpoints.";
const codes = ["381A", "381A", "381A1", "381A2", "381B", "381A"];

function draft(): TrackImportDraft {
  const entries = codes.map((code, index) => ({
    id: `sender-entry-${index}`,
    title: index === 0 ? "Sereja and Dima" : `Boundary exercise ${index + 1}`,
    code,
    url:
      index === 5
        ? "https://codeforces.com/gym/381/problem/A"
        : `https://codeforces.com/problemset/problem/381/${code.slice(3)}`,
    rating: index === 0 ? 800 : null,
    pattern: hint,
    source: { kind: "docx" as const, text: privateText, location: privateText },
  }));
  return {
    id: "sender-track-id",
    title,
    sourceName: `${privateText}.docx`,
    sourceFingerprint: `${privateText}-fingerprint`,
    sourceNotes: privateText,
    stages: [
      {
        id: "sender-stage-1",
        title: "Foundation",
        description,
        suggestedTime: "20 minutes",
        sourceNotes: privateText,
        entries: entries.slice(0, 3),
      },
      {
        id: "sender-stage-2",
        title: "Variants and intentional repeats",
        description: "Keep A, A1, A2 and Gym identities separate.",
        suggestedTime: "30 minutes",
        entries: entries.slice(3),
      },
    ],
  };
}
function sender(): Data {
  const data = connectProfile(
    importTrack(emptyData(), draft(), { duplicates: "reject" }, now),
    { handle: "private_sender", rating: 1200, rank: "pupil" },
    now,
  );
  data.settings.displayName = "private@example.test";
  data.tracks![0].shareDescription = `${privateText}-stored-description`;
  data.problems[0].reviewAt = "2026-10-15";
  data.problems[0].revisionCue = privateText;
  data.attempts = [
    {
      id: "sender-private-attempt",
      problemId: data.problems[0].id,
      startedAt: "2026-10-08T04:00:00Z",
      completedAt: "2026-10-08T04:05:00Z",
      elapsedMs: 300000,
      outcome: "independent",
      difficulty: null,
      takeaway: privateText,
      notes: privateText,
      mistakes: ["indexing"],
      mistakeNote: privateText,
    },
  ];
  data.revisions = [
    {
      id: "sender-private-recall",
      problemId: data.problems[0].id,
      handle: null,
      activity: "explain",
      completedAt: "2026-10-08T04:06:00Z",
      outcome: "cue",
      response: privateText,
      cue: privateText,
      nextReviewAt: "2026-10-12",
    },
  ];
  return data;
}
function recipient(): Data {
  let data = emptyData();
  data.problems = [
    {
      id: "recipient-personal-381A",
      title: "My private Sereja title",
      platform: "Codeforces",
      url: "https://codeforces.com/contest/381/problem/A",
      problemCode: "381A",
      rating: 900,
      tags: ["my-personal-tag"],
      createdAt: "2026-10-01T04:00:00Z",
      reviewAt: "2026-10-15",
      reviewManual: true,
      reviewCount: 1,
      revisionCue: "Recipient keeps this cue.",
    },
  ];
  data.attempts = [
    {
      id: "recipient-prior-attempt",
      problemId: data.problems[0].id,
      startedAt: "2026-10-08T04:00:00Z",
      completedAt: "2026-10-08T04:05:00Z",
      elapsedMs: 300000,
      outcome: "hint",
      difficulty: "edges",
      takeaway: "Recipient's own learning stays here.",
      notes: "Recipient private notes.",
    },
  ];
  data = connectProfile(
    data,
    { handle: "archived_shared", rating: 1200, rank: "pupil" },
    now,
  );
  data = mergeActivity(
    data,
    "archived_shared",
    [
      {
        handle: "archived_shared",
        from: 1,
        count: 1,
        submissions: [
          {
            id: 718381,
            submittedAt: "2026-10-08T04:00:00Z",
            verdict: "OK",
            language: "GNU C++20",
            problem: {
              key: "contest:381:A1",
              code: "381A1",
              title: "Archived acceptance must stay separate",
              url: "https://codeforces.com/problemset/problem/381/A1",
              tags: [],
              rating: null,
            },
          },
        ],
      },
    ],
    "refresh",
    now,
  );
  return connectProfile(
    data,
    { handle: "current_shared", rating: null, rank: null },
    now,
  );
}
async function seed(page: Page, data = emptyData(), theme = "light") {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.shared-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.shared-fixture", "seeded");
    },
    { data, theme },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: now.toISOString(), stale: false, problems: [] },
    }),
  );
  await page.route("**/api/codeforces?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const handle =
      query.get("handle") ??
      data.codeforces.connectedHandle ??
      "shared_fixture";
    return route.fulfill({
      json:
        query.get("action") === "profile"
          ? { handle, rating: null, rank: null }
          : { handle, from: 1, count: 50, submissions: [] },
    });
  });
}
async function durable(page: Page, workspace = "personal"): Promise<Data> {
  return page.evaluate(
    (workspace) =>
      new Promise<Data>((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("workspaces")
            .objectStore("workspaces")
            .get(workspace);
          read.onsuccess = () => {
            resolve(read.result.data);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
    workspace,
  );
}
async function readyNotebook(page: Page, workspace = "personal") {
  // The initial workspace migration precedes normal visit/day maintenance.
  // Capture export/import immutability only after those actual writes commit.
  await expect
    .poll(async () => {
      const data = await durable(page, workspace);
      return {
        dayReady:
          data.practicePlans?.some((plan) => plan.day === "2026-10-09") ??
          false,
        visitReady: data.codeforces.profiles.every(
          (profile) =>
            profile.lastVisitAt === now.toISOString() &&
            profile.sinceAt === now.toISOString(),
        ),
      };
    })
    .toEqual({ dayReady: true, visitReady: true });
  return durable(page, workspace);
}
async function openDetails(details: Locator) {
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The track download has no readable content.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
async function exportTrack(page: Page) {
  await page.getByRole("button", { name: "Share track", exact: true }).click();
  return page.getByRole("dialog");
}
async function downloadTrack(page: Page, dialog: Locator) {
  const downloading = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download track file", exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.forma-track\.json$/);
  return downloadText(download);
}
async function sharedPreview(page: Page, text: string) {
  await page
    .getByRole("button", { name: "Import shared track", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await loadShared(dialog, text);
  await expect(dialog.getByLabel("Track title", { exact: true })).toBeVisible();
  return dialog;
}
async function loadShared(dialog: Locator, text: string) {
  await dialog
    .getByLabel("Shared track file (.forma-track.json)", { exact: true })
    .setInputFiles({
      name: "a-course.forma-track.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
}
function sharedFile() {
  return {
    format: "forma-track",
    version: 1,
    track: {
      title,
      stages: draft().stages.map((stage) => ({
        title: stage.title,
        suggestedTime: stage.suggestedTime,
        problems: stage.entries.map((entry) => ({
          code: entry.code,
          url: entry.url,
          title: entry.title,
          rating: entry.rating,
        })),
      })),
    },
  };
}
async function abortNextSave(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let armed = true;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = original.call(this, names, mode, options);
      const stores = typeof names === "string" ? [names] : Array.from(names);
      if (
        armed &&
        this.name === "forma-workspaces" &&
        mode === "readwrite" &&
        stores.includes("recoveries")
      ) {
        armed = false;
        tx.objectStore("workspaces").get("__shared_abort__").onsuccess = () =>
          tx.abort();
      }
      return tx;
    };
  });
}

test("the actual track download contains only reviewed curriculum and export leaves the sender notebook unchanged", async ({
  page,
}) => {
  await seed(page, sender());
  await page.goto("/tracks/sender-track-id");
  const before = await readyNotebook(page);
  const dialog = await exportTrack(page);
  await expect(dialog.getByLabel("Include descriptions")).not.toBeChecked();
  await expect(dialog.getByLabel("Include pattern hints")).not.toBeChecked();
  const content = dialog.getByRole("region", { name: "Track file content" });
  await expect(content).toContainText("Foundation");
  await expect(content).not.toContainText(description);
  await expect(content).not.toContainText(hint);
  const minimal = JSON.parse(await downloadTrack(page, dialog));
  expect(minimal).toEqual(sharedFile());
  await dialog.getByLabel("Include descriptions").check();
  await dialog.getByLabel("Include pattern hints").check();
  await dialog
    .getByLabel("Share description", { exact: true })
    .fill("A course I chose to share.");
  await expect(content).toContainText(description);
  await expect(content).toContainText(hint);
  await expect(content).toContainText("A course I chose to share.");
  const text = await downloadTrack(page, dialog);
  const file = JSON.parse(text);
  expect(file.track.shareDescription).toBe("A course I chose to share.");
  expect(file.track.stages[0].description).toBe(description);
  expect(file.track.stages[0].problems[0].hint).toBe(hint);
  for (const secret of [
    privateText,
    "private_sender",
    "private@example.test",
    "sender-track-id",
    "sender-stage-1",
    "sender-entry-0",
    "sender-private-attempt",
    "sender-private-recall",
  ])
    expect(text).not.toContain(secret);
  expect(await durable(page)).toEqual(before);
});

test("a downloaded curriculum imports into a separate workspace, preserves recipient history and distinct identities, and continues through practice Memory and Progress", async ({
  page,
  browser,
}, testInfo) => {
  await seed(page, sender());
  await page.goto("/tracks/sender-track-id");
  const file = await downloadTrack(page, await exportTrack(page));
  const secondContext = await browser.newContext({
    ...(testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"]),
    baseURL: "http://127.0.0.1:3002",
    timezoneId: "Asia/Kolkata",
  });
  try {
    const second = await secondContext.newPage();
    await seed(second, recipient());
    await second.goto("/tracks");
    const before = await readyNotebook(second);
    const dialog = await sharedPreview(second, file);
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "6 detected problems",
    );
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "1 duplicate entries",
    );
    await expect(dialog).toContainText("already in your workspace");
    expect(await durable(second)).toEqual(before);
    await dialog
      .getByLabel("Track title", { exact: true })
      .fill("My edited boundary course");
    await dialog
      .getByLabel("Share description", { exact: true })
      .fill("My local curriculum description.");
    await dialog
      .getByText("Edit stage details", { exact: true })
      .first()
      .click();
    await dialog
      .getByLabel("Stage 1 title", { exact: true })
      .fill("My edited foundation");
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      second.getByRole("heading", {
        name: "My edited boundary course",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    const saved = await durable(second);
    expect(saved.activeTrackId).toBeNull();
    expect(saved.session).toBeNull();
    expect(saved.tracks).toHaveLength(1);
    expect(saved.trackEntries).toHaveLength(6);
    expect(saved.problems).toHaveLength(6);
    expect(saved.attempts).toEqual(before.attempts);
    expect(saved.codeforces).toEqual(before.codeforces);
    for (const original of before.problems)
      expect(
        saved.problems.find((problem) => problem.id === original.id),
      ).toEqual(original);
    expect(saved.trackEntries![0].problemId).toBe("recipient-personal-381A");
    expect(saved.trackEntries![1].problemId).toBe("recipient-personal-381A");
    expect(saved.trackEntries![2].problemId).not.toBe(before.problems[1].id);
    expect(
      new Set(saved.trackEntries!.map((entry) => entry.problemId)).size,
    ).toBe(5);
    const localIds = new Set(
      [...saved.tracks!, ...saved.trackStages!, ...saved.trackEntries!].map(
        (item) => item.id,
      ),
    );
    for (const id of [
      "sender-track-id",
      "sender-stage-1",
      "sender-stage-2",
      ...draft().stages.flatMap((stage) =>
        stage.entries.map((entry) => entry.id),
      ),
    ])
      expect(localIds.has(id)).toBe(false);
    await second
      .getByRole("button", { name: "Make this my active track", exact: true })
      .click();
    await expect
      .poll(async () => (await durable(second)).activeTrackId)
      .toBe(saved.tracks![0].id);
    await second
      .getByRole("link", { name: "Open stage", exact: true })
      .first()
      .click();
    await expect(
      second.getByLabel("Progress for Sereja and Dima"),
    ).toContainText("Reflected with assistance");
    await expect(
      second.getByLabel("Progress for Boundary exercise 3"),
    ).toContainText("Not started");
    await second
      .getByRole("button", {
        name: "Start practice: Sereja and Dima",
        exact: true,
      })
      .click();
    await second
      .getByLabel("A place for your thoughts")
      .fill("My own notes after importing a course.");
    await second
      .getByRole("button", { name: "Finish session", exact: true })
      .click();
    await second
      .getByRole("button", { name: "Solved independently", exact: true })
      .click();
    await second
      .getByLabel("One thing to remember")
      .fill("Only one endpoint moves after each choice.");
    await second
      .getByRole("button", { name: "No revisit", exact: true })
      .click();
    await second
      .getByRole("button", { name: "Save reflection", exact: true })
      .click();
    await second
      .getByRole("link", { name: "View Learning Memory", exact: true })
      .click();
    await expect(
      second.getByRole("heading", {
        name: "My private Sereja title",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      second.getByRole("region", { name: "What your records show" }),
    ).toContainText("Only one endpoint moves after each choice.");
    await second.goto(
      `/tracks/${saved.tracks![0].id}/stages/${saved.trackStages![0].id}`,
    );
    await expect(
      second.getByLabel("Progress for Sereja and Dima"),
    ).toContainText("Reflected independently");
    await second.goto("/progress");
    await expect(
      second.getByRole("region", {
        name: "What your records show.",
        exact: true,
      }),
    ).toContainText("timed");
    const final = await durable(second);
    expect(final.attempts).toHaveLength(2);
    expect(final.attempts[1].trackContext?.trackId).toBe(saved.tracks![0].id);
    expect(final.codeforces).toEqual(before.codeforces);
    expect((await durable(page)).attempts).toHaveLength(1);
  } finally {
    await secondContext.close();
  }
});

test("equivalent files open the existing track or create an explicit separate copy while changed curriculum remains a new preview", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  let dialog = await sharedPreview(page, JSON.stringify(sharedFile()));
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  const first = (await durable(page)).tracks![0];
  await page.goto("/tracks");
  const equivalent = { ...sharedFile(), exportedAt: "2026-10-08T04:00:00Z" };
  equivalent.track.stages[0].problems[0].url =
    "http://www.codeforces.com/contest/381/problem/a/?locale=en";
  dialog = await sharedPreview(page, JSON.stringify(equivalent, null, 4));
  await expect(
    dialog.getByRole("link", { name: "Open existing track", exact: true }),
  ).toHaveAttribute("href", `/tracks/${first.id}`);
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("link", { name: "Open existing track", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(page).toHaveURL(`/tracks/${first.id}`);
  expect((await durable(page)).tracks).toHaveLength(1);
  await page.goto("/tracks");
  dialog = await sharedPreview(page, JSON.stringify(equivalent));
  await dialog.getByLabel("Import a separate copy", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  const copies = await durable(page);
  expect(copies.tracks).toHaveLength(2);
  expect(copies.problems).toHaveLength(5);
  expect(copies.trackEntries).toHaveLength(12);
  expect(new Set(copies.trackEntries!.map((entry) => entry.id)).size).toBe(12);
  expect(copies.activeTrackId).toBeNull();
  await page.goto("/tracks");
  const changed = sharedFile();
  changed.track.stages[0].problems[0].title =
    "A deliberate new curriculum title";
  dialog = await sharedPreview(page, JSON.stringify(changed));
  await expect(
    dialog.getByRole("link", { name: "Open existing track", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeEnabled();
  expect((await durable(page)).tracks).toEqual(copies.tracks);
});

test("untrusted and private backup files leave the durable notebook intact, and valid text cannot execute or fetch", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Import shared track", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const before = await readyNotebook(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.test")) requests.push(request.url());
  });
  const unsafe = sharedFile();
  unsafe.track.stages[0].problems[0].url = "https://example.test/private-fetch";
  const cases = [
    {
      text: JSON.stringify({ ...sharedFile(), version: 99 }),
      error: /version|newer|unsupported/i,
    },
    { text: JSON.stringify(emptyData()), error: /backup|restore|Settings/i },
    { text: JSON.stringify(unsafe), error: /Codeforces|URL|supported/i },
    { text: "{ damaged JSON", error: /JSON|read|valid/i },
    {
      text: JSON.stringify({
        ...sharedFile(),
        track: { ...sharedFile().track, title: 17 },
      }),
      error: /title|invalid|text/i,
    },
    {
      text: JSON.stringify({
        ...sharedFile(),
        track: { ...sharedFile().track, title: "x".repeat(241) },
      }),
      error: /240|title/i,
    },
    {
      text: JSON.stringify({
        ...sharedFile(),
        track: {
          ...sharedFile().track,
          stages: Array.from(
            { length: 101 },
            () => sharedFile().track.stages[0],
          ),
        },
      }),
      error: /100|stages/i,
    },
    {
      text: JSON.stringify({
        ...sharedFile(),
        track: {
          ...sharedFile().track,
          stages: [
            {
              ...sharedFile().track.stages[0],
              problems: Array.from(
                { length: 1001 },
                () => sharedFile().track.stages[0].problems[0],
              ),
            },
          ],
        },
      }),
      error: /1,000|memberships/i,
    },
    { text: " ".repeat(5 * 1024 * 1024 + 1), error: /5 MB|larger/i },
  ];
  for (const item of cases) {
    await loadShared(dialog, item.text);
    await expect(dialog.getByRole("alert")).toContainText(item.error);
    await expect(
      dialog.getByLabel("Shared track file (.forma-track.json)", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await durable(page)).toEqual(before);
  }
  const literal = sharedFile();
  const payload =
    '<img src="https://example.test/x" onerror="window.sharedExecuted=true">';
  literal.track.title = payload;
  await loadShared(dialog, JSON.stringify(literal));
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    payload,
  );
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: payload, exact: true, level: 1 }),
  ).toBeVisible();
  expect(await page.evaluate(() => "sharedExecuted" in window)).toBe(false);
  expect(requests).toEqual([]);
  await expect(page.locator('main img[src*="example.test"]')).toHaveCount(0);
});

test("a conflicting shared identity remains in the editable preview until explicitly corrected", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  const conflicting = sharedFile();
  conflicting.track.stages[0].problems[0].code = "381X";
  const dialog = await sharedPreview(page, JSON.stringify(conflicting));
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Keep this reviewed correction");
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "1 unresolved entries",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  expect((await durable(page)).tracks).toHaveLength(0);
  const stage = dialog.locator("[data-studio-stage]").first();
  await openDetails(stage);
  const row = stage.locator("[data-studio-entry]").first();
  await openDetails(row);
  await row.getByLabel("Codeforces ID", { exact: true }).fill("381A");
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    "Keep this reviewed correction",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "0 unresolved entries",
  );
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Keep this reviewed correction",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.trackEntries![0].code).toBe("381A");
  expect(saved.trackEntries![0].problemId).toBe(
    saved.trackEntries![1].problemId,
  );
});

test("an aborted import retains edits, retry and a double click commit one atomic track with stable memberships", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  const dialog = await sharedPreview(page, JSON.stringify(sharedFile()));
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Retry this exact course");
  const previewStages = await dialog
    .locator("[data-studio-stage]")
    .evaluateAll((stages) =>
      stages.map((stage) => stage.getAttribute("data-studio-stage")),
    );
  for (const stage of await dialog.locator("[data-studio-stage]").all())
    await openDetails(stage);
  const previewEntries = await dialog
    .locator("[data-studio-entry]")
    .evaluateAll((entries) =>
      entries.map((entry) => entry.getAttribute("data-studio-entry")),
    );
  const before = await readyNotebook(page);
  await abortNextSave(page);
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    /save|commit|attention/i,
  );
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    "Retry this exact course",
  );
  expect(
    await dialog
      .locator("[data-studio-stage]")
      .evaluateAll((stages) =>
        stages.map((stage) => stage.getAttribute("data-studio-stage")),
      ),
  ).toEqual(previewStages);
  expect(
    await dialog
      .locator("[data-studio-entry]")
      .evaluateAll((entries) =>
        entries.map((entry) => entry.getAttribute("data-studio-entry")),
      ),
  ).toEqual(previewEntries);
  expect(await durable(page)).toEqual(before);
  await dialog
    .getByRole("button", { name: "Retry saving track", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("heading", {
      name: "Retry this exact course",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks).toHaveLength(1);
  expect(saved.trackStages).toHaveLength(2);
  expect(saved.trackEntries).toHaveLength(6);
  expect(saved.trackStages!.map((stage) => stage.id)).toEqual(previewStages);
  expect(saved.trackEntries!.map((entry) => entry.id)).toEqual(previewEntries);
  expect(saved.problems).toHaveLength(5);
  expect(new Set(saved.trackEntries!.map((entry) => entry.id)).size).toBe(6);
  expect(saved.activeTrackId).toBeNull();
  await page.reload();
  expect((await durable(page)).tracks).toEqual(saved.tracks);
  expect((await durable(page)).trackEntries).toEqual(saved.trackEntries);
});

test("a captured import preview closes after another tab changes its profile and a discarded preview never crosses into Demo", async ({
  page,
  context,
}) => {
  await seed(
    page,
    connectProfile(
      emptyData(),
      { handle: "shared_owner", rating: null, rank: null },
      now,
    ),
  );
  await page.goto("/tracks");
  let dialog = await sharedPreview(page, JSON.stringify(sharedFile()));
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Captured profile preview");
  const other = await context.newPage();
  await seed(other);
  await other.goto("/settings");
  await other.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect
    .poll(async () => (await durable(other)).codeforces.connectedHandle)
    .toBeNull();
  await expect(dialog).toHaveCount(0);
  expect((await durable(page)).tracks).toHaveLength(0);
  dialog = await sharedPreview(page, JSON.stringify(sharedFile()));
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Captured workspace preview");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Explore the demo", exact: true })
    .click();
  await expect(page.locator(".demo-banner")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect((await durable(page)).tracks).toHaveLength(0);
  await page.goto("/tracks");
  const demoBefore = await readyNotebook(page, "demo");
  expect(
    demoBefore.tracks!.some(
      (track) => track.title === "Captured workspace preview",
    ),
  ).toBe(false);
  dialog = await sharedPreview(page, JSON.stringify(sharedFile()));
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    title,
  );
  expect(await durable(page, "demo")).toEqual(demoBefore);
});

test("the actual 100-problem five-stage sheet round trips through a downloaded shared file with its order intact", async ({
  page,
  browser,
}, testInfo) => {
  const source = await parsePracticeSheet(
    await readFile("tests/fixtures/docx/two-pointers-100.docx"),
    "two-pointers-100.docx",
  );
  const data = importTrack(emptyData(), source, { duplicates: "reject" }, now);
  await seed(page, data);
  await page.goto(`/tracks/${data.tracks![0].id}`);
  const text = await downloadTrack(page, await exportTrack(page));
  const shared = JSON.parse(text);
  expect(shared.track.stages).toHaveLength(5);
  expect(
    shared.track.stages.flatMap(
      (stage: { problems: unknown[] }) => stage.problems,
    ),
  ).toHaveLength(100);
  const secondContext = await browser.newContext({
    ...(testInfo.project.name === "mobile"
      ? devices["Pixel 7"]
      : devices["Desktop Chrome"]),
    baseURL: "http://127.0.0.1:3002",
    timezoneId: "Asia/Kolkata",
  });
  try {
    const second = await secondContext.newPage();
    await seed(second);
    await second.goto("/tracks");
    const dialog = await sharedPreview(second, text);
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "100 detected problems",
    );
    await expect(dialog.getByLabel("Preview counts")).toContainText("5 stages");
    expect((await durable(second)).problems).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect
      .poll(async () => (await durable(second)).trackEntries!.length)
      .toBe(100);
    const imported = await durable(second);
    expect(imported.trackStages!.map((stage) => stage.title)).toEqual(
      data.trackStages!.map((stage) => stage.title),
    );
    expect(
      imported.trackEntries!.map((entry) => ({
        code: entry.code,
        url: entry.url,
        title: entry.title,
        rating: entry.rating,
      })),
    ).toEqual(
      data.trackEntries!.map((entry) => ({
        code: entry.code,
        url: entry.url,
        title: entry.title,
        rating: entry.rating,
      })),
    );
    expect(imported.activeTrackId).toBeNull();
    expect(imported.attempts).toHaveLength(0);
  } finally {
    await secondContext.close();
  }
});

for (const theme of ["light", "dark"] as const)
  test(`shared-track export and import stay readable with Large text, keyboard navigation and ${theme === "dark" ? "Ink" : "Light"} theme`, async ({
    page,
  }, testInfo) => {
    const data = sender();
    data.settings.textSize = "large";
    data.tracks![0].title =
      "A deliberately long shared curriculum title for careful boundaries, split variants and intentional repeated practice";
    await seed(page, data, theme);
    await page.goto("/tracks/sender-track-id");
    const trigger = page.getByRole("button", {
      name: "Share track",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Include descriptions").check();
    await dialog.getByLabel("Include pattern hints").check();
    await dialog
      .getByRole("region", { name: "Track file content" })
      .locator(testInfo.project.name === "mobile" ? "h4" : "h3")
      .first()
      .scrollIntoViewIfNeeded();
    await dialog.screenshot({
      path: `docs/forma-shared-export-${testInfo.project.name}-${theme === "dark" ? "ink" : "light"}-large.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.goto("/tracks");
    const preview = sharedFile();
    const richPreview = {
      ...preview,
      track: {
        ...preview.track,
        stages: preview.track.stages.map((stage) => ({
          ...stage,
          description,
          problems: stage.problems.map((problem) => ({ ...problem, hint })),
        })),
      },
    };
    dialog = await sharedPreview(page, JSON.stringify(richPreview));
    await openDetails(dialog.locator("[data-studio-stage]").first());
    await dialog
      .locator("[data-studio-entry]")
      .first()
      .scrollIntoViewIfNeeded();
    await dialog.screenshot({
      path: `docs/forma-shared-import-${testInfo.project.name}-${theme === "dark" ? "ink" : "light"}-large.png`,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(360);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await dialog
      .getByRole("button", { name: "Discard draft", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
  });
