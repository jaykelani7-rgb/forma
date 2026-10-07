import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { emptyData, localDate, type Data } from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";
import type { TrackImportDraft } from "../../src/lib/tracks-types";

const actualSheet =
  process.env.FORMA_PRACTICE_SHEET ??
  "tests/fixtures/docx/two-pointers-100.docx";
const title = "Two pointers browser practice";
const firstTitle = "A readable first problem with a long but useful name";
const secondTitle = "Split-index follow-up";
const mimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function sheet(unresolved = false) {
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
  const row = (
    name: string,
    link: string | null,
    code: string,
    pattern: string,
  ) =>
    `<w:tr><w:tc><w:p>${link ? `<w:hyperlink r:id="${link}">` : ""}<w:r><w:t>${name}</w:t></w:r>${link ? "</w:hyperlink>" : ""}</w:p></w:tc>${cell(code)}${cell("1200")}${cell(pattern)}</w:tr>`;
  const table = (rows: string) =>
    `<w:tbl><w:tr>${["Problem", "ID", "Rating", "Main pattern"].map(cell).join("")}</w:tr>${rows}</w:tbl>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${p(title)}${p("Stage 1: Foundation")}${p("Practise window invariants before reaching for hints.")}${p("Suggested practice: 20 minutes")}${table(row(firstTitle, "first", "3300C1", "secret source pattern") + row(unresolved ? "Needs an explicit identity" : secondTitle, unresolved ? null : "second", unresolved ? "" : "3300C2", "opposite ends") + (unresolved ? row("Duplicate first membership", "first", "3300C1", "duplicate hint") : ""))}${p("Stage 2: Core Patterns")}${p("Build a robust invariant.")}${table(row("A core problem", "third", "3301A", "counting windows"))}<w:sectPr /></w:body></w:document>`;
  return {
    name: unresolved ? "uncertain-practice.docx" : "browser-practice.docx",
    mimeType,
    buffer: Buffer.from(
      zipSync(
        {
          "[Content_Types].xml": strToU8(
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" /></Types>',
          ),
          "word/document.xml": strToU8(xml),
          "word/_rels/document.xml.rels": strToU8(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              ["3300/C1", "3300/C2", "3301/A"]
                .map(
                  (code, index) =>
                    `<Relationship Id="${["first", "second", "third"][index]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://codeforces.com/problemset/problem/${code}" TargetMode="External" />`,
                )
                .join("") +
              "</Relationships>",
          ),
        },
        { mtime: new Date("2026-10-01T00:00:00Z") },
      ),
    ),
  };
}

function draft(): TrackImportDraft {
  return {
    id: "browser-track",
    title,
    sourceName: "browser-practice.docx",
    sourceFingerprint: "browser-fingerprint",
    stages: [
      {
        id: "browser-foundation",
        title: "Foundation",
        description: "Practise window invariants.",
        suggestedTime: "20 minutes",
        entries: [
          {
            id: "browser-first",
            title: firstTitle,
            url: "https://codeforces.com/problemset/problem/3300/C1",
            code: "3300C1",
            rating: 1200,
            pattern: "secret source pattern",
          },
          {
            id: "browser-second",
            title: secondTitle,
            url: "https://codeforces.com/problemset/problem/3300/C2",
            code: "3300C2",
            rating: 1300,
            pattern: "opposite ends",
          },
        ],
      },
      {
        id: "browser-core",
        title: "Core Patterns",
        description: "Build a robust invariant.",
        suggestedTime: "30 minutes",
        entries: [
          {
            id: "browser-third",
            title: "A core problem",
            url: "https://codeforces.com/problemset/problem/3301/A",
            code: "3301A",
            rating: 1400,
            pattern: "counting windows",
          },
        ],
      },
    ],
  };
}

async function seed(page: Page, data: Data = emptyData(), theme = "light") {
  await page.addInitScript(
    ({ data, theme }) => {
      if (!localStorage.getItem("forma.tracks-fixture")) {
        localStorage.setItem("forma.personal.v1", JSON.stringify(data));
        localStorage.setItem("forma.theme", theme);
        localStorage.setItem("forma.tracks-fixture", "seeded");
      }
    },
    { data, theme },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
}
async function durable(page: Page): Promise<Data> {
  return page.evaluate(
    () =>
      new Promise<Data>((resolve, reject) => {
        const open = indexedDB.open("forma-workspaces", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
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
async function upload(page: Page, unresolved = false) {
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  await page
    .getByLabel("Practice sheet (.docx)")
    .setInputFiles(sheet(unresolved));
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Track title")).toHaveValue(title);
  return dialog;
}

test("the supplied DOCX previews 100 entries in five ordered stages without changing records before confirmation", async ({
  page,
}, testInfo) => {
  test.skip(
    !existsSync(actualSheet),
    "Set FORMA_PRACTICE_SHEET to the supplied DOCX to verify the real file.",
  );
  await seed(page);
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  await page.getByLabel("Practice sheet (.docx)").setInputFiles(actualSheet);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "100 detected problems",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText("5 stages");
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "0 unresolved entries",
  );
  const headings = await dialog.locator("details > summary").allTextContents();
  expect(headings.map((value) => value.replace(/\s+/g, " ").trim())).toEqual([
    "1. Foundation · 20 problems",
    "2. Core Patterns · 20 problems",
    "3. Intermediate · 20 problems",
    "4. Advanced · 20 problems",
    "5. Mastery · 20 problems",
  ]);
  expect((await durable(page)).tracks).toEqual([]);
  expect((await durable(page)).problems).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await durable(page)).tracks).toEqual([]);
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  await page.getByLabel("Practice sheet (.docx)").setInputFiles(actualSheet);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect
    .poll(async () => (await durable(page)).trackEntries?.length)
    .toBe(100);
  const saved = await durable(page);
  const firstStage = saved.trackStages!.find(
    (stage) => stage.id === saved.tracks![0].stageIds[0],
  )!;
  const firstEntry = saved.trackEntries!.find(
    (entry) => entry.id === firstStage.entryIds[0],
  )!;
  await page.goto(`/tracks/${saved.tracks![0].id}/stages/${firstStage.id}`);
  await page.screenshot({
    path: `docs/forma-real-sheet-${testInfo.project.name}-light.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", {
      name: `Start practice: ${firstEntry.title}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page.getByRole("button", { name: "No revisit", exact: true }).click();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect.poll(async () => (await durable(page)).attempts.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Next problem", exact: true }),
  ).toBeVisible();
  expect((await durable(page)).session).toBeNull();
  const firstAttempt = (await durable(page)).attempts[0];
  const secondEntry = saved.trackEntries!.find(
    (entry) => entry.id === firstStage.entryIds[1],
  )!;
  await page.getByRole("button", { name: "Next problem", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: secondEntry.title, exact: true }),
  ).toBeVisible();
  expect((await durable(page)).session?.trackContext?.entryId).toBe(
    secondEntry.id,
  );
  await expect(
    page.getByLabel("A place for your thoughts", { exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page.getByRole("button", { name: "No revisit", exact: true }).click();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect.poll(async () => (await durable(page)).attempts.length).toBe(2);
  expect(
    new Set((await durable(page)).attempts.map((attempt) => attempt.id)).size,
  ).toBe(2);
  expect(
    (await durable(page)).attempts.find(
      (attempt) => attempt.id === firstAttempt.id,
    ),
  ).toEqual(firstAttempt);
  await page
    .getByRole("link", { name: "Return to stage", exact: true })
    .click();
  await expect(page).toHaveURL(
    `/tracks/${saved.tracks![0].id}/stages/${firstStage.id}`,
  );
  await page.reload();
  await expect(
    page.getByLabel(`Progress for ${firstEntry.title}`),
  ).toContainText("Reflected independently");
  expect((await durable(page)).problems.length).toBe(100);
});

test("uncertain entries can be corrected and reordered in a preview before an atomic import", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  const dialog = await upload(page, true);
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "4 detected problems",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "1 unresolved entries",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "1 duplicate entries",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Codeforces ID", { exact: true })
    .nth(1)
    .fill("3300C2");
  await dialog.getByLabel("Problem 2 title", { exact: true }).fill(secondTitle);
  await dialog
    .getByRole("button", {
      name: "Remove problem 3 from Foundation",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", {
      name: "Move problem 2 up in Foundation",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Stage assignment", { exact: true })
    .first()
    .selectOption({ label: "Core Patterns" });
  await dialog.getByLabel("Stage 1 title", { exact: true }).fill("Basics");
  await dialog
    .getByRole("button", { name: "Move stage 1 down", exact: true })
    .click();
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "0 unresolved entries",
  );
  expect((await durable(page)).problems).toEqual([]);
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.problems.length).toBe(3);
  expect(saved.tracks?.length).toBe(1);
  const stages = saved.tracks![0].stageIds.map(
    (id) => saved.trackStages!.find((stage) => stage.id === id)!,
  );
  expect(stages.map((stage) => stage.title)).toEqual([
    "Core Patterns",
    "Basics",
  ]);
  expect(
    stages[0].entryIds.map(
      (id) => saved.trackEntries!.find((entry) => entry.id === id)!.code,
    ),
  ).toEqual(["3301A", "3300C2"]);
  expect(
    stages[1].entryIds.map(
      (id) => saved.trackEntries!.find((entry) => entry.id === id)!.code,
    ),
  ).toEqual(["3300C1"]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("2. Basics", { exact: true })).toBeVisible();
});

test("parsing cancellation and malformed or unsupported uploads leave workspace records untouched", async ({
  page,
}) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return original.call(this);
    };
  });
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  await page.getByLabel("Practice sheet (.docx)").setInputFiles(sheet());
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("status")).toContainText(
    "Reading practice sheet",
  );
  await dialog
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  await page.getByLabel("Practice sheet (.docx)").setInputFiles({
    name: "broken.docx",
    mimeType,
    buffer: Buffer.from("Not a DOCX"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "damaged",
  );
  await page.getByLabel("Practice sheet (.docx)").setInputFiles({
    name: "sheet.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("unsupported"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "PDF, images, and older .doc files are not supported",
  );
  expect((await durable(page)).tracks).toEqual([]);
  expect((await durable(page)).problems).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
});

test("deliberate re-import shares existing problem history across tracks", async ({
  page,
}) => {
  const data = emptyData();
  data.problems = [
    {
      id: "already-saved",
      title: "My original problem name",
      platform: "Codeforces",
      url: "https://codeforces.com/contest/3300/problem/C1",
      problemCode: "3300C1",
      tags: [],
      rating: 999,
      createdAt: new Date().toISOString(),
      reviewAt: null,
      reviewCount: 0,
    },
  ];
  data.attempts = [
    {
      id: "original-reflection",
      problemId: "already-saved",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      elapsedMs: 60000,
      outcome: "independent",
      difficulty: null,
      takeaway: "Preserve the source history.",
      notes: "",
    },
  ];
  await seed(page, data);
  await page.goto("/tracks");
  let dialog = await upload(page);
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  expect((await durable(page)).problems.length).toBe(3);
  await page.goto("/tracks");
  dialog = await upload(page);
  await expect(
    dialog.getByRole("link", { name: `Open existing: ${title}`, exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Import a separate copy of this track").check();
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true, level: 1 }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks?.length).toBe(2);
  expect(saved.problems.length).toBe(3);
  expect(saved.attempts).toEqual(data.attempts);
  expect(
    saved.trackEntries
      ?.filter((entry) => entry.code === "3300C1")
      .map((entry) => entry.problemId),
  ).toEqual(["already-saved", "already-saved"]);
});

test("a failed import retains its corrected preview and retries one stable operation", async ({
  page,
}) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.name === "workspaces" &&
        localStorage.getItem("forma.fail-track-save") === "armed"
      ) {
        localStorage.removeItem("forma.fail-track-save");
        throw new DOMException(
          "A deliberate isolated fixture write failure",
          "QuotaExceededError",
        );
      }
      return original.apply(this, args);
    };
  });
  await page.goto("/tracks");
  const dialog = await upload(page);
  await dialog.getByLabel("Track title").fill("Keep this corrected preview");
  await page.evaluate(() =>
    localStorage.setItem("forma.fail-track-save", "armed"),
  );
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Your preview is still here",
  );
  await expect(dialog.getByLabel("Track title")).toHaveValue(
    "Keep this corrected preview",
  );
  await expect(
    page.getByText(
      "Practice sheet imported. Choose a stage and make it your own.",
      { exact: true },
    ),
  ).toHaveCount(0);
  expect((await durable(page)).tracks).toEqual([]);
  await dialog.getByLabel("Track title").fill("Refined after the failed write");
  await dialog
    .getByRole("button", { name: "Retry saving track", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Refined after the failed write",
      exact: true,
    }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks?.length).toBe(1);
  expect(saved.trackEntries?.length).toBe(3);
  expect(saved.problems.length).toBe(3);
});

test("track sessions feed shared reflections, takeaways, and revisit progress across reload", async ({
  page,
}) => {
  await seed(page, importTrack(emptyData(), draft()));
  await page.goto("/tracks/browser-track/stages/browser-foundation");
  await expect(
    page.getByText("secret source pattern", { exact: true }),
  ).toBeHidden();
  await page
    .getByText("Reveal source pattern hint", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText("secret source pattern", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Start practice: ${firstTitle}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/session$/);
  await expect(
    page.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`${title} · Foundation`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Needed a hint", exact: true })
    .click();
  await page
    .getByLabel(/One thing to remember/)
    .fill("Write a window invariant before moving either pointer.");
  await page.getByLabel("Proposed revisit date").fill(localDate());
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect.poll(async () => (await durable(page)).attempts.length).toBe(1);
  await page.goto("/tracks/browser-track/stages/browser-foundation");
  await expect(page.getByLabel(`Progress for ${firstTitle}`)).toContainText(
    "Reflected with assistance",
  );
  await expect(page.getByLabel(`Progress for ${firstTitle}`)).toContainText(
    "Revisit due",
  );
  await expect(
    page.getByRole("region", { name: "Stage takeaways" }),
  ).toContainText("Write a window invariant before moving either pointer.");
  await page.getByLabel("Filter stage problems").selectOption("assisted");
  await expect(
    page.getByRole("heading", { name: secondTitle, exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel(`Progress for ${firstTitle}`)).toContainText(
    "Revisit due",
  );
  await page.goto("/revisit");
  await expect(
    page.getByRole("heading", { name: firstTitle, exact: true }),
  ).toBeVisible();
});

test("track edits and removal preserve underlying practice history", async ({
  page,
}) => {
  const data = importTrack(emptyData(), draft());
  data.attempts = [
    {
      id: "existing-track-attempt",
      problemId: data.problems[0].id,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      elapsedMs: 120000,
      outcome: "independent",
      difficulty: null,
      takeaway: "Keep my practice.",
      notes: "",
    },
  ];
  await seed(page, data);
  await page.goto("/tracks/browser-track");
  await page.getByRole("button", { name: "Edit track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Track title").fill("A renamed track");
  await dialog
    .getByRole("button", { name: "Save track changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A renamed track", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove track", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove track", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your tracks.", exact: true }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks).toEqual([]);
  expect(saved.problems).toEqual(data.problems);
  expect(saved.attempts).toEqual(data.attempts);
  expect(saved.activeTrackId).toBeNull();
});

test("Tracks is readable and keyboard accessible in both themes and large text", async ({
  page,
}, testInfo) => {
  await seed(page, importTrack(emptyData(), draft()), "light");
  await page.goto("/tracks/browser-track/stages/browser-foundation");
  await expect(
    page
      .getByRole("navigation", {
        name:
          (page.viewportSize()?.width ?? 1280) < 760
            ? "Mobile navigation"
            : "Primary navigation",
      })
      .getByRole("link", { name: "Tracks", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Filter stage problems").focus();
  await expect(page.getByLabel("Filter stage problems")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: `Start practice: ${firstTitle}`,
      exact: true,
    }),
  ).toBeFocused();
  await page.screenshot({
    path: `docs/forma-tracks-${testInfo.project.name}-light.png`,
    animations: "disabled",
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page.goto("/tracks/browser-track/stages/browser-foundation");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .getByRole("button", {
        name: `Start practice: ${firstTitle}`,
        exact: true,
      })
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(17);
  await page.screenshot({
    path: `docs/forma-tracks-${testInfo.project.name}-ink-large.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "Stage takeaways" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/forma-tracks-${testInfo.project.name}-ink-large-footer.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(
    page.getByRole("button", {
      name: `Start practice: ${firstTitle}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
