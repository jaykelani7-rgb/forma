import { expect, test, type Page, type Locator } from "@playwright/test";
import { emptyData, type Data } from "../../src/lib/model";
import { importTrack, trackContextForEntry } from "../../src/lib/tracks";
import { parsePastedProblems } from "../../src/lib/track-studio";
import { saveRevision } from "../../src/lib/memory";

async function seed(page: Page, data = emptyData(), theme = "light") {
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.studio-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.studio-fixture", "seeded");
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
async function openDetails(details: Locator) {
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}
async function pastePreview(page: Page, text: string) {
  await page
    .getByRole("button", { name: "Paste Codeforces links or IDs", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Codeforces links or IDs", { exact: true })
    .fill(text);
  await dialog
    .getByRole("button", { name: "Preview pasted problems", exact: true })
    .click();
  return dialog;
}

async function documentPreview(page: Page, name: string, forceOCR = false) {
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  if (forceOCR)
    await dialog
      .getByLabel("Use OCR for all PDF pages", { exact: true })
      .check();
  await dialog
    .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
    .setInputFiles(`tests/fixtures/documents/${name}`);
  await expect(dialog.getByLabel("Track title", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  return dialog;
}
async function reviewRows(dialog: Locator) {
  for (const stage of await dialog.locator("[data-studio-stage]").all()) {
    await openDetails(stage);
    for (const row of await stage.locator("[data-studio-entry]").all()) {
      await openDetails(row);
      const review = row.getByLabel("I reviewed this extracted entry", {
        exact: true,
      });
      if (await review.count()) await review.check();
    }
  }
}

for (const forceOCR of [false, true])
  test(`real text PDF hyperlinks ${forceOCR ? "with requested OCR" : "with selectable text"} produce reviewable candidates and start practice`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await seed(page);
    await page.goto("/tracks");
    const dialog = await documentPreview(page, "text-links.pdf", forceOCR);
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "7 detected problems",
    );
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "2 unresolved entries",
    );
    await expect(dialog.getByLabel("Preview counts")).toContainText(
      "1 duplicate entries",
    );
    const variants = dialog.locator("[data-studio-stage]").last();
    await openDetails(variants);
    const missing = variants.locator("[data-studio-entry]").nth(3);
    await openDetails(missing);
    await expect(
      missing.getByLabel("Source evidence for problem 4"),
    ).toContainText("page 2");
    await missing.getByRole("button", { name: /^Exclude problem/ }).click();
    const conflicting = variants.locator("[data-studio-entry]").last();
    await openDetails(conflicting);
    await expect(conflicting).toContainText(
      "More than one Codeforces identity",
    );
    await conflicting.getByLabel("Codeforces ID", { exact: true }).fill("381A");
    await conflicting
      .getByLabel("I reviewed this extracted entry", { exact: true })
      .check();
    await dialog
      .getByLabel("Track title", { exact: true })
      .fill("Reviewed PDF plan");
    if (forceOCR) await reviewRows(dialog);
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Reviewed PDF plan",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    const saved = await durable(page);
    expect(saved.trackEntries!.map((entry) => entry.code)).toEqual([
      "381A",
      "279B",
      "1739C1",
      "1739C2",
      "381A",
      "381A",
    ]);
    expect(saved.problems).toHaveLength(4);
    expect(saved.trackEntries![0].source?.kind).toBe(
      forceOCR ? "ocr" : "pdf-text",
    );
    expect(saved.trackEntries![0].title).toBe("Sereja and Dima");
    await page.reload();
    await page
      .getByRole("link", { name: "Open stage", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", {
        name: "Start practice: Sereja and Dima",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/session$/);
    expect((await durable(page)).session?.trackContext?.entryId).toBe(
      saved.trackEntries![0].id,
    );
  });

for (const name of [
  "scanned.pdf",
  "mixed.pdf",
  "scan-with-heading.pdf",
  "screenshot.png",
  "screenshot.jpg",
])
  test(`real local OCR imports ${name} without duplicated page sources or invented IDs`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await seed(page);
    await page.goto("/tracks");
    const uploadedRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") uploadedRequests.push(request.url());
    });
    const dialog = await documentPreview(page, name);
    await expect(
      dialog.getByRole("button", { name: "Confirm import", exact: true }),
    ).toBeDisabled();
    if (name.startsWith("screenshot")) {
      const stage = dialog.locator("[data-studio-stage]").last();
      await openDetails(stage);
      const uncertain = stage.locator("[data-studio-entry]").nth(2);
      await openDetails(uncertain);
      await expect(
        uncertain.getByLabel("Codeforces ID", { exact: true }),
      ).toHaveValue("");
      await expect(
        uncertain.getByLabel("Source evidence for problem 3"),
      ).toContainText("38IA");
      await uncertain.getByRole("button", { name: /^Exclude problem/ }).click();
      const missing = stage.locator("[data-studio-entry]").last();
      await openDetails(missing);
      await expect(missing).toContainText(
        "Titles alone cannot identify a problem",
      );
      await missing.getByRole("button", { name: /^Exclude problem/ }).click();
    }
    await reviewRows(dialog);
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: name.replace(/\.[^.]+$/, ""),
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    const saved = await durable(page);
    const codes =
      name === "scan-with-heading.pdf"
        ? ["1739C1", "1739C2"]
        : ["381A", "279B", "1739C1", "1739C2"];
    expect(saved.trackEntries!.map((entry) => entry.code)).toEqual(codes);
    expect(saved.trackEntries).toHaveLength(codes.length);
    expect(saved.problems).toHaveLength(codes.length);
    if (name === "mixed.pdf")
      expect(saved.trackEntries!.map((entry) => entry.source?.kind)).toEqual([
        "pdf-text",
        "pdf-text",
        "ocr",
        "ocr",
      ]);
    else
      expect(
        saved.trackEntries!.every((entry) => entry.source?.kind === "ocr"),
      ).toBe(true);
    expect(uploadedRequests).toEqual([]);
    await page.reload();
    expect((await durable(page)).trackEntries).toEqual(saved.trackEntries);
  });

test("encrypted, corrupt and oversized document errors retain upload controls and never create workspace records", async ({
  page,
}) => {
  test.setTimeout(90000);
  await seed(page);
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const [name, message] of [
    ["encrypted.pdf", "password protected"],
    ["corrupt.pdf", "damaged or unreadable"],
    ["too-many-pages.pdf", "limit is 40"],
    ["oversized-scan.pdf", "20 megapixel import limit"],
    ["corrupt.png", "damaged or unreadable"],
  ]) {
    await dialog
      .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
      .setInputFiles(`tests/fixtures/documents/${name}`);
    await expect(dialog.getByRole("alert")).toContainText(message, {
      timeout: 60000,
    });
    await expect(
      dialog.getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)"),
    ).toBeEnabled();
    expect((await durable(page)).tracks).toEqual([]);
    expect((await durable(page)).problems).toEqual([]);
  }
});

test("an OCR asset download failure retains the upload and an actual retry succeeds", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await seed(page);
  let fail = true;
  await context.route(
    "**/import-assets/tesseract-*/tesseract.min.js",
    async (route) => {
      if (fail) {
        fail = false;
        await route.abort();
      } else await route.continue();
    },
  );
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
    .setInputFiles("tests/fixtures/documents/scanned.pdf");
  await expect(dialog.getByRole("alert")).toContainText(
    "assets could not be loaded",
    { timeout: 60000 },
  );
  expect((await durable(page)).tracks).toEqual([]);
  await dialog
    .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
    .setInputFiles("tests/fixtures/documents/scanned.pdf");
  await expect(dialog.getByLabel("Track title", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await reviewRows(dialog);
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect
    .poll(async () => (await durable(page)).trackEntries?.length)
    .toBe(4);
});

test("cancelling OCR asset loading releases the workers and a fresh upload succeeds", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await seed(page);
  let held = true;
  let requested = false;
  await context.route(
    "**/import-assets/tesseract-*/tesseract.min.js",
    async (route) => {
      requested = true;
      if (!held) {
        await route.continue();
        return;
      }
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!held) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
      await route.abort().catch(() => {});
    },
  );
  await page.goto("/tracks");
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  async function importWorkers() {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return targetInfos.filter(
      (target) =>
        target.type === "worker" &&
        target.browserContextId === targetInfo.browserContextId,
    );
  }
  await page
    .getByRole("button", { name: "Import practice sheet", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
    .setInputFiles("tests/fixtures/documents/screenshot.png");
  await expect.poll(() => requested).toBe(true);
  await expect(dialog.getByRole("status")).toContainText("Loading OCR assets");
  await expect
    .poll(async () => (await importWorkers()).length)
    .toBeGreaterThan(0);
  await dialog
    .getByRole("button", { name: "Cancel processing", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  held = false;
  await expect.poll(async () => (await importWorkers()).length).toBe(0);
  expect((await durable(page)).tracks).toEqual([]);
  await dialog
    .getByLabel("Practice sheet (DOCX, PDF, PNG or JPEG)")
    .setInputFiles("tests/fixtures/documents/scanned.pdf");
  await expect(dialog.getByLabel("Track title", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await reviewRows(dialog);
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect
    .poll(async () => (await durable(page)).trackEntries?.length)
    .toBe(4);
  await expect.poll(async () => (await importWorkers()).length).toBe(0);
});

test("manual empty tracks grow through shared preview, stages, batch edits and explicit exclusion without mixing Gym identities", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/tracks");
  await page
    .getByRole("button", { name: "Create manually", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Placement practice");
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Placement practice",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const empty = await durable(page);
  expect(empty.trackEntries).toEqual([]);
  expect(empty.tracks![0].stageIds).toEqual([]);
  await page.getByRole("button", { name: "Edit track", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add stage", exact: true }).click();
  const foundation = dialog.locator("[data-studio-stage]").first();
  await openDetails(foundation);
  await foundation.getByText("Edit stage details", { exact: true }).click();
  await foundation
    .getByLabel("Stage 1 title", { exact: true })
    .fill("Foundation");
  await foundation
    .getByLabel("Stage description", { exact: true })
    .fill("Write the invariant first.");
  await foundation
    .getByLabel("Suggested practice time", { exact: true })
    .fill("20 minutes");
  await foundation
    .getByLabel("Stage source notes", { exact: true })
    .fill("A deliberate personal plan.");
  await foundation
    .getByRole("button", { name: "Add pasted batch", exact: true })
    .click();
  await foundation
    .getByLabel("Batch for Foundation", { exact: true })
    .fill("381A — Sereja and Dima\n1358C1\n1358C2\nGym 100A\n100A\n381A");
  await foundation
    .getByRole("button", { name: "Add batch to stage", exact: true })
    .click();
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "6 detected problems",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "1 duplicate entries",
  );
  const duplicated = foundation.locator("[data-studio-entry]").last();
  await openDetails(duplicated);
  await duplicated.getByRole("button", { name: /^Exclude problem/ }).click();
  await expect(duplicated).toContainText("Excluded from save");
  await expect(dialog.getByLabel("Preview counts")).toContainText("1 excluded");
  const stageId = await foundation.getAttribute("data-studio-stage");
  await dialog.getByRole("button", { name: "Add stage", exact: true }).click();
  const core = dialog.locator("[data-studio-stage]").last();
  await openDetails(core);
  await core.getByText("Edit stage details", { exact: true }).click();
  await core.getByLabel("Stage 2 title", { exact: true }).fill("Core");
  const firstEntry = foundation.locator("[data-studio-entry]").first();
  const entryId = await firstEntry.getAttribute("data-studio-entry");
  await openDetails(firstEntry);
  await firstEntry
    .getByLabel("Stage assignment", { exact: true })
    .selectOption({ label: "Core" });
  await core
    .getByRole("button", { name: "Move stage 2 up", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save track changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Placement practice",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks![0].id).toBe(empty.tracks![0].id);
  expect(saved.trackEntries).toHaveLength(5);
  expect(saved.problems).toHaveLength(5);
  expect(
    saved.trackStages!.find((stage) => stage.id === stageId)?.sourceNotes,
  ).toBe("A deliberate personal plan.");
  expect(
    saved.trackEntries!.find((entry) => entry.id === entryId)?.stageId,
  ).toBe(saved.tracks![0].stageIds[0]);
  expect(
    saved
      .trackEntries!.filter((entry) => entry.code === "100A")
      .map((entry) => entry.url),
  ).toEqual(
    expect.arrayContaining([
      "https://codeforces.com/gym/100/problem/A",
      "https://codeforces.com/problemset/problem/100/A",
    ]),
  );
  await page.reload();
  await page
    .getByRole("link", { name: "Open stage", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "Start practice: Sereja and Dima",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/session$/);
  expect((await durable(page)).session?.trackContext?.entryId).toBe(entryId);
});

test("paste candidates remain reviewable, draft discard is deliberate, and failed saves retry one stable track", async ({
  page,
}) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (
        this.name === "workspaces" &&
        localStorage.getItem("forma.fail-studio") === "armed"
      ) {
        localStorage.removeItem("forma.fail-studio");
        throw new DOMException(
          "Controlled storage failure",
          "QuotaExceededError",
        );
      }
      return original.apply(this, args);
    };
  });
  await page.goto("/tracks");
  const dialog = await pastePreview(
    page,
    "Stage 1: Foundation\n38IA — Check the ambiguous ID\nA title without a link\n381A\n381A",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "4 detected problems",
  );
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "2 unresolved entries",
  );
  const rows = dialog.locator("[data-studio-entry]");
  await openDetails(rows.nth(0));
  await expect(
    rows.nth(0).getByLabel("Source evidence for problem 1"),
  ).toContainText("38IA");
  await rows.nth(0).getByLabel("Codeforces ID", { exact: true }).fill("1358C1");
  await openDetails(rows.nth(1));
  await rows
    .nth(1)
    .getByRole("button", { name: /^Exclude problem/ })
    .click();
  await expect(dialog.getByLabel("Preview counts")).toContainText(
    "0 unresolved entries",
  );
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Retain my corrected draft");
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("alert")).toContainText("Discard this draft?");
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    "Retain my corrected draft",
  );
  await page.evaluate(() => localStorage.setItem("forma.fail-studio", "armed"));
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Your preview is still here",
  );
  expect((await durable(page)).tracks).toEqual([]);
  await dialog
    .getByRole("button", { name: "Retry saving track", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Retain my corrected draft",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await page.reload();
  const saved = await durable(page);
  expect(saved.tracks).toHaveLength(1);
  expect(saved.trackEntries).toHaveLength(3);
  expect(saved.problems).toHaveLength(2);
  expect(
    saved
      .trackEntries!.filter((entry) => entry.code === "381A")
      .map((entry) => entry.problemId),
  ).toEqual([
    saved.trackEntries![1].problemId,
    saved.trackEntries![1].problemId,
  ]);
});

test("replacing and removing membership leaves measured attempts, recall and historical context intact", async ({
  page,
}) => {
  let data = importTrack(
    emptyData(),
    parsePastedProblems("Stage 1: Foundation\n381A — Original problem\n1358C1"),
  );
  const originalEntry = data.trackEntries![0];
  const context = trackContextForEntry(data, originalEntry.id)!;
  data.attempts = [
    {
      id: "studio-old-attempt",
      problemId: originalEntry.problemId,
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:02:00.000Z",
      elapsedMs: 120000,
      outcome: "hint",
      difficulty: "edges",
      takeaway: "Preserve the endpoints.",
      notes: "Original notes.",
      mistakes: ["indexing"],
      trackContext: context,
    },
  ];
  data = saveRevision(data, {
    id: "studio-old-recall",
    problemId: originalEntry.problemId,
    handle: null,
    activity: "explain",
    outcome: "cue",
    response: "Remember the invariant.",
    cue: "Check the ends.",
    completedAt: "2026-10-02T00:00:00Z",
    nextReviewAt: "2026-10-12",
    trackContext: context,
  });
  await seed(page, data);
  await page.goto(`/tracks/${data.tracks![0].id}`);
  await page.getByRole("button", { name: "Edit track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const entry = dialog.locator("[data-studio-entry]").first();
  await openDetails(entry);
  await entry.getByLabel("Codeforces ID", { exact: true }).fill("189A");
  await entry
    .getByLabel("Problem 1 title", { exact: true })
    .fill("Replacement problem");
  await dialog
    .getByRole("button", { name: "Save track changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit track", exact: true }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.trackEntries![0].id).toBe(originalEntry.id);
  expect(saved.trackEntries![0].problemId).not.toBe(originalEntry.problemId);
  expect(saved.attempts).toEqual(data.attempts);
  expect(saved.revisions).toEqual(data.revisions);
  await page.getByRole("button", { name: "Remove track", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove track", exact: true })
    .click();
  await page.goto(`/problems/${encodeURIComponent(originalEntry.problemId)}`);
  await expect(
    page.getByText("Original notes.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Remember the invariant.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${context.trackTitle} · ${context.stageTitle} (track no longer available)`,
      { exact: true },
    ),
  ).toBeVisible();
  expect((await durable(page)).attempts).toEqual(data.attempts);
  expect((await durable(page)).revisions).toEqual(data.revisions);
});

for (const theme of ["light", "dark"])
  test(`Track Studio stays readable with keyboard, long titles, Large text and reduced motion in ${theme}`, async ({
    page,
  }, testInfo) => {
    const data = emptyData();
    data.settings.textSize = "large";
    await seed(page, data, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tracks");
    const dialog = await pastePreview(
      page,
      "Stage 1: Foundation\n381A — A comfortable study notebook with a very long title for the problem that must wrap clearly even on a narrow screen\n1358C1\nA missing identity stays visible for correction",
    );
    const row = dialog.locator("[data-studio-entry]").last();
    await row.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(
      row.getByLabel("Codeforces ID", { exact: true }),
    ).toBeVisible();
    await row.getByRole("button", { name: /^Exclude problem/ }).click();
    await dialog
      .getByLabel("Track title", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/forma-studio-${testInfo.project.name}-${theme}-large.png`,
      animations: "disabled",
    });
    await row.locator(":scope > summary").click();
    await dialog
      .locator("[data-studio-entry] > summary")
      .first()
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/forma-studio-${testInfo.project.name}-${theme}-large-entries.png`,
      animations: "disabled",
    });
    await openDetails(row);
    await dialog
      .getByRole("button", { name: "Confirm import", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/forma-studio-${testInfo.project.name}-${theme}-large-footer.png`,
      animations: "disabled",
    });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const footer = dialog.getByRole("button", {
      name: "Confirm import",
      exact: true,
    });
    await footer.focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await footer.scrollIntoViewIfNeeded();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Discard draft", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect((await durable(page)).tracks).toEqual([]);
  });
