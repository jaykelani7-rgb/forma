import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { emptyData, validateData, type Data } from "../../src/lib/model";
import { importTrack } from "../../src/lib/tracks";
import { parsePracticeSheet } from "../../src/lib/docx-import";
import {
  sharedTrackFromTrack,
  type SharedTrackFile,
} from "../../src/lib/shared-tracks";
import type { OwnedShare } from "../../src/lib/share-links";
const title = "A shared path through careful boundaries";
const secret = "PRIVATE-LEARNING-6ac1";
function sender() {
  const data = importTrack(
    emptyData(),
    {
      id: "private-track",
      title,
      sourceName: `${secret}.docx`,
      sourceFingerprint: secret,
      stages: [
        {
          id: "stage-one",
          title: "Foundation",
          description: "Choose one boundary at a time.",
          suggestedTime: "20 minutes",
          entries: [
            {
              id: "member-one",
              code: "381A",
              url: "https://codeforces.com/contest/381/problem/A",
              title: "Sereja and Dima",
              rating: 800,
              pattern: "Compare both ends.",
            },
            {
              id: "member-two",
              code: "381A1",
              url: "https://codeforces.com/problemset/problem/381/A1",
              title: "Split variant",
              rating: null,
              pattern: "",
            },
          ],
        },
        {
          id: "stage-two",
          title: "Return and extend",
          description: "A deliberate repeat and a different namespace.",
          suggestedTime: "30 minutes",
          entries: [
            {
              id: "member-three",
              code: "381A",
              url: "https://codeforces.com/problemset/problem/381/A",
              title: "Repeat the foundation",
              rating: 800,
              pattern: "",
            },
            {
              id: "member-four",
              code: "381A",
              url: "https://codeforces.com/gym/381/problem/A",
              title: "Gym exercise",
              rating: null,
              pattern: "",
            },
          ],
        },
      ],
    },
    { duplicates: "reject" },
  );
  data.settings.displayName = secret;
  data.settings.textSize = "large";
  data.problems[0].revisionCue = secret;
  data.problems[0].reviewAt = "2026-11-01";
  data.problems[0].reviewManual = true;
  data.attempts = [
    {
      id: "private-attempt",
      problemId: data.problems[0].id,
      startedAt: "2026-10-08T04:00:00Z",
      completedAt: "2026-10-08T04:05:00Z",
      elapsedMs: 300000,
      outcome: "hint",
      difficulty: null,
      takeaway: secret,
      notes: secret,
    },
  ];
  return validateData(data);
}
async function account(request: APIRequestContext, data = emptyData()) {
  const result = await request.post(
    "http://127.0.0.1:54399/__test__/accounts",
    { data: { data } },
  );
  expect(result.ok()).toBeTruthy();
  return (await result.json()) as { id: string; email: string; token: string };
}
async function publish(
  request: APIRequestContext,
  owner: { token: string },
  file: SharedTrackFile,
  operationId = randomUUID(),
) {
  const result = await request.post("/api/shares", {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: { file, operationId },
  });
  expect(result.status(), await result.text()).toBe(200);
  return (await result.json()).share as OwnedShare;
}
async function signIn(page: Page, user: { email: string }) {
  await page.goto("/settings");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("forma-fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#account").getByRole("status")).toHaveText(
    "synced",
  );
}
async function durable(page: Page, workspace = "personal") {
  return page.evaluate(
    (key) =>
      new Promise<Data>((resolve, reject) => {
        const open = indexedDB.open("forma-workspaces", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db
            .transaction("workspaces")
            .objectStore("workspaces")
            .get(key);
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
  // Wait for the app's existing daily maintenance before comparing whole notebooks.
  await expect
    .poll(
      async () => (await durable(page, workspace)).practicePlans?.length ?? 0,
    )
    .toBeGreaterThan(0);
  return durable(page, workspace);
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
        tx.objectStore("workspaces").get("__link_abort__").onsuccess = () =>
          tx.abort();
      }
      return tx;
    };
  });
}

test.beforeEach(async ({ context }) => {
  // Isolated visitors have distinct proxy identities; exercise the real limiter
  // without treating an entire concurrent browser suite as one anonymous visitor.
  await context.setExtraHTTPHeaders({
    "X-Forwarded-For": `fixture-${randomUUID()}`,
  });
});
async function review(page: Page, token: string) {
  await page.goto(`/tracks?share=${token}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    title,
  );
  return dialog;
}

test("review and publish a private track, preview anonymously, import locally, practise, then revoke without harming the imported copy", async ({
  page,
  browser,
  request,
}, info) => {
  const owner = await account(request, sender());
  await signIn(page, owner);
  await page.goto("/tracks/private-track");
  const before = await readyNotebook(page, `account:${owner.id}`);
  await page.getByRole("button", { name: "Share track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Create share link", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Include descriptions", { exact: true }).check();
  await dialog.getByLabel("Include pattern hints", { exact: true }).check();
  await dialog
    .getByLabel("Share description", { exact: true })
    .fill("Shared by a friend. A frozen practice curriculum.");
  await dialog
    .getByLabel("I understand anyone with this link can view the snapshot.")
    .check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/shares") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create share link", exact: true })
    .click();
  const published = (await (await response).json()).share as OwnedShare;
  await expect(
    dialog.getByRole("link", { name: "View published snapshot" }),
  ).toHaveAttribute("href", `/share/${published.token}`);
  const resolved = await request.get(`/api/shared-tracks/${published.token}`);
  expect(resolved.headers()["cache-control"]).toContain("no-store");
  const publicData = await resolved.json();
  expect(publicData).toEqual({
    file: sharedTrackFromTrack(sender(), "private-track", {
      includeDescriptions: true,
      includeHints: true,
      shareDescription: "Shared by a friend. A frozen practice curriculum.",
    }),
  });
  expect(await durable(page, `account:${owner.id}`)).toEqual(before);
  expect(Object.keys(publicData)).toEqual(["file"]);
  expect(JSON.stringify(publicData)).not.toContain(secret);
  expect(JSON.stringify(publicData)).not.toContain("private-track");
  const recipientContext = await browser.newContext(info.project.use);
  const recipient = await recipientContext.newPage();
  try {
    await recipientContext.setExtraHTTPHeaders({
      "X-Forwarded-For": `fixture-${randomUUID()}`,
    });
    await recipient.goto(`/share/${published.token}`);
    await expect(
      recipient.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await recipient.evaluate(() => localStorage.getItem("forma.personal.v1")),
    ).toBeNull();
    expect(await recipient.evaluate(() => indexedDB.databases())).toEqual([]);
    await expect(recipient.locator("meta[name=robots]")).toHaveAttribute(
      "content",
      /noindex/,
    );
    await recipient
      .getByRole("button", { name: "Large text", exact: true })
      .click();
    for (const theme of ["light", "ink"]) {
      if (theme === "ink")
        await recipient
          .getByRole("button", { name: "Ink appearance", exact: true })
          .click();
      await expect(
        recipient.getByRole("link", { name: "Add to my Forma", exact: true }),
      ).toHaveCSS(
        "background-color",
        theme === "ink" ? "rgb(231, 226, 216)" : "rgb(44, 89, 69)",
      );
      await recipient.screenshot({
        path: `docs/forma-link-public-${info.project.name}-${theme}-large.png`,
        fullPage: true,
      });
    }
    await recipient
      .getByRole("link", { name: "Add to my Forma", exact: true })
      .click();
    const preview = recipient.getByRole("dialog");
    await expect(
      preview.getByLabel("Track title", { exact: true }),
    ).toHaveValue(title);
    expect((await durable(recipient)).tracks ?? []).toHaveLength(0);
    await preview
      .getByLabel("Share description", { exact: true })
      .fill("My independent local copy.");
    await preview
      .getByRole("button", { name: "Confirm import", exact: true })
      .click();
    await expect(
      recipient.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const imported = await durable(recipient);
    expect(imported.activeTrackId).toBeNull();
    expect(imported.session).toBeNull();
    expect(imported.attempts).toEqual([]);
    expect(imported.trackEntries).toHaveLength(4);
    expect(imported.tracks![0].id).not.toBe("private-track");
    expect(new Set(imported.trackEntries!.map((e) => e.problemId)).size).toBe(
      3,
    );
    await recipient
      .getByRole("button", { name: "Make this my active track", exact: true })
      .click();
    await recipient.goto(
      `/tracks/${imported.tracks![0].id}/stages/${imported.trackStages![0].id}`,
    );
    await recipient
      .getByRole("button", {
        name: "Start practice: Sereja and Dima",
        exact: true,
      })
      .click();
    await recipient
      .getByRole("button", { name: "Finish session", exact: true })
      .click();
    await recipient
      .getByRole("button", { name: "Solved independently", exact: true })
      .click();
    await recipient
      .getByLabel("One thing to remember")
      .fill("One endpoint moves after each choice.");
    await recipient
      .getByRole("button", { name: "Save reflection", exact: true })
      .click();
    await recipient
      .getByRole("link", { name: "View Learning Memory", exact: true })
      .click();
    await expect(
      recipient.getByRole("region", {
        name: "What your records show",
        exact: true,
      }),
    ).toContainText("One endpoint moves");
    await recipient.goto("/progress");
    await expect(
      recipient.getByRole("region", {
        name: "What your records show.",
        exact: true,
      }),
    ).toContainText("timed");
    await page.goto("/tracks/shared");
    const item = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await item
      .getByRole("button", { name: "Revoke link", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Revoke link", exact: true })
      .click();
    await expect(item).toContainText("Revoked");
    expect(
      (await request.get(`/api/shared-tracks/${published.token}`)).status(),
    ).toBe(404);
    const retained = await durable(recipient);
    expect(retained.tracks).toHaveLength(1);
    expect(retained.attempts).toHaveLength(1);
    await recipient.goto(`/share/${published.token}`);
    await expect(
      recipient.getByRole("heading", {
        name: "This shared track is unavailable.",
        exact: true,
      }),
    ).toBeVisible();
    await recipient.goto(`/tracks/${imported.tracks![0].id}`);
    await expect(
      recipient.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  } finally {
    await recipientContext.close();
  }
});

test("anonymous enumeration and another account are denied, retries reuse a snapshot and revised publication creates another link", async ({
  request,
}) => {
  const alice = await account(request, sender()),
    bob = await account(request);
  const file = sharedTrackFromTrack(sender(), "private-track");
  const op = randomUUID();
  const results = await Promise.all([
    publish(request, alice, file, op),
    publish(request, alice, file, op),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await request.get("/api/shares")).status()).toBe(401);
  const other = await request.get("/api/shares", {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  expect((await other.json()).shares).toEqual([]);
  expect(
    (
      await request.delete(`/api/shares/${results[0].id}`, {
        headers: { Authorization: `Bearer ${bob.token}` },
      })
    ).status(),
  ).toBe(404);
  const changed = structuredClone(file);
  changed.track.title = "Revised shared content";
  const next = await publish(request, alice, changed);
  expect(next.token).not.toBe(results[0].token);
  expect(
    (await (await request.get(`/api/shared-tracks/${results[0].token}`)).json())
      .file,
  ).toEqual(file);
  const mismatch = await request.post("/api/shares", {
    headers: { Authorization: `Bearer ${alice.token}` },
    data: { file: changed, operationId: op },
  });
  expect(mismatch.status()).toBe(409);
  for (const token of ["invalid", "0".repeat(64)])
    expect((await request.get(`/api/shared-tracks/${token}`)).status()).toBe(
      404,
    );
});

test("revocation while an editable preview is open blocks confirmation and preserves the draft", async ({
  page,
  request,
}) => {
  const owner = await account(request);
  const share = await publish(
    request,
    owner,
    sharedTrackFromTrack(sender(), "private-track"),
  );
  const dialog = await review(page, share.token);
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Retained unsaved copy");
  const ids = await dialog
    .locator("[data-studio-entry]")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-studio-entry")),
    );
  await request.delete(`/api/shares/${share.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("unavailable");
  await expect(dialog.getByLabel("Track title", { exact: true })).toHaveValue(
    "Retained unsaved copy",
  );
  expect(
    await dialog
      .locator("[data-studio-entry]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-studio-entry")),
      ),
  ).toEqual(ids);
  expect((await durable(page)).tracks ?? []).toHaveLength(0);
});

test("existing history survives import and equivalent links allow an explicit separate copy", async ({
  page,
  request,
}) => {
  const personal = sender();
  personal.tracks = [];
  personal.trackStages = [];
  personal.trackEntries = [];
  personal.activeTrackId = null;
  await page.addInitScript((data) => {
    if (!localStorage.getItem("links-seeded")) {
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("links-seeded", "yes");
    }
  }, personal);
  const owner = await account(request);
  const share = await publish(
    request,
    owner,
    sharedTrackFromTrack(sender(), "private-track"),
  );
  let dialog = await review(page, share.token);
  await expect(dialog).toContainText("already in your workspace");
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const first = await durable(page);
  expect(first.attempts).toEqual(personal.attempts);
  expect(first.problems).toEqual(personal.problems);
  dialog = await review(page, share.token);
  await expect(
    dialog.getByRole("link", { name: "Open existing track", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Import a separate copy", { exact: false }).check();
  await dialog
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toBeVisible();
  const copies = await durable(page);
  expect(copies.tracks).toHaveLength(2);
  expect(copies.attempts).toEqual(personal.attempts);
  expect(copies.problems).toEqual(personal.problems);
});

test("a lost publication response can be retried without creating another share", async ({
  page,
  request,
}) => {
  const owner = await account(request, sender());
  await signIn(page, owner);
  await page.goto("/tracks/private-track");
  await page.getByRole("button", { name: "Share track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("I understand anyone with this link can view the snapshot.")
    .check();
  let requests = 0;
  const operations: string[] = [];
  await page.route("**/api/shares", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    requests++;
    operations.push(route.request().postDataJSON().operationId);
    const response = await route.fetch();
    if (requests === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Create share link", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Create share link", exact: true })
    .dblclick();
  await expect(
    dialog.getByRole("link", { name: "View published snapshot" }),
  ).toBeVisible();
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
  const list = await request.get("/api/shares", {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect((await list.json()).shares).toHaveLength(1);
});

test("the actual 100-problem five-stage curriculum retains its order through link publication and reviewed import", async ({
  page,
  request,
}) => {
  const source = await parsePracticeSheet(
    new Uint8Array(await readFile("tests/fixtures/docx/two-pointers-100.docx")),
    "fixture.docx",
  );
  const data = importTrack(emptyData(), source, { duplicates: "reject" });
  const file = sharedTrackFromTrack(data, source.id, {
    includeDescriptions: true,
    includeHints: true,
  });
  const owner = await account(request, data);
  const share = await publish(request, owner, file);
  await page.goto(`/share/${share.token}`);
  await expect(
    page.getByText("5 stages · 100 problem memberships", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/shared-tracks/${share.token}`)).json())
      .file,
  ).toEqual(file);
  await page
    .getByRole("link", { name: "Add to my Forma", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: file.track.title, exact: true }),
  ).toBeVisible();
  const imported = await durable(page);
  expect(imported.trackStages).toHaveLength(5);
  expect(imported.trackEntries).toHaveLength(100);
  expect(imported.activeTrackId).toBeNull();
  expect(
    sharedTrackFromTrack(imported, imported.tracks![0].id, {
      includeDescriptions: true,
      includeHints: true,
    }),
  ).toEqual(file);
});

test("a delayed publication response cannot appear after another tab changes the account", async ({
  page,
  context,
  request,
}) => {
  const alice = await account(request, sender()),
    bob = await account(request);
  await signIn(page, alice);
  await page.goto("/tracks/private-track");
  await page.getByRole("button", { name: "Share track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("I understand anyone with this link can view the snapshot.")
    .check();
  let release!: () => void, created!: (share: OwnedShare) => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const published = new Promise<OwnedShare>((resolve) => {
    created = resolve;
  });
  await page.route("**/api/shares", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    created((await response.json()).share);
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* The account switch aborts the old owner request. */
    }
  });
  const other = await context.newPage();
  try {
    await dialog
      .getByRole("button", { name: "Create share link", exact: true })
      .click();
    const share = await published;
    await other.goto("/settings");
    await other.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await signIn(other, bob);
    release();
    await page.goto("/settings");
    await expect(page.locator(".account-panel")).toContainText(bob.email);
    await page.goto("/tracks/shared");
    await expect(
      page.getByText("You have no share links yet.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View published snapshot" }),
    ).toHaveCount(0);
    const aliceShares = await request.get("/api/shares", {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(
      (await aliceShares.json()).shares.map((s: OwnedShare) => s.id),
    ).toEqual([share.id]);
    const bobShares = await request.get("/api/shares", {
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    expect((await bobShares.json()).shares).toEqual([]);
    expect(
      (await durable(page, `account:${bob.id}`)).tracks ?? [],
    ).toHaveLength(0);
    expect(
      (await durable(page, `account:${alice.id}`)).tracks?.map(
        (track) => track.id,
      ),
    ).toEqual(["private-track"]);
  } finally {
    release();
    await other.close();
  }
});

test("an aborted linked import retains its edits and identifiers and a double retry saves one independent copy", async ({
  page,
  request,
}) => {
  const owner = await account(request);
  const share = await publish(
    request,
    owner,
    sharedTrackFromTrack(sender(), "private-track"),
  );
  const dialog = await review(page, share.token);
  await dialog
    .getByLabel("Track title", { exact: true })
    .fill("Retried linked curriculum");
  for (const stage of await dialog.locator("[data-studio-stage]").all()) {
    if ((await stage.getAttribute("open")) === null)
      await stage.locator(":scope > summary").click();
  }
  const stageIds = await dialog
    .locator("[data-studio-stage]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-studio-stage")),
    );
  const entryIds = await dialog
    .locator("[data-studio-entry]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-studio-entry")),
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
    "Retried linked curriculum",
  );
  expect(await durable(page)).toEqual(before);
  expect(
    await dialog
      .locator("[data-studio-stage]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-studio-stage")),
      ),
  ).toEqual(stageIds);
  expect(
    await dialog
      .locator("[data-studio-entry]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-studio-entry")),
      ),
  ).toEqual(entryIds);
  await dialog
    .getByRole("button", { name: "Retry saving track", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Retried linked curriculum",
      exact: true,
    }),
  ).toBeVisible();
  const saved = await durable(page);
  expect(saved.tracks).toHaveLength(1);
  expect(saved.trackStages?.map((stage) => stage.id)).toEqual(stageIds);
  expect(saved.trackEntries?.map((entry) => entry.id)).toEqual(entryIds);
  expect(saved.trackEntries).toHaveLength(4);
  expect(saved.problems).toHaveLength(3);
  expect(saved.activeTrackId).toBeNull();
  expect(saved.session).toBeNull();
  await page.reload();
  expect((await durable(page)).tracks).toEqual(saved.tracks);
  expect((await durable(page)).trackEntries).toEqual(saved.trackEntries);
});

test("private edits leave the old public snapshot frozen and revised content receives a separate link", async ({
  page,
  request,
}) => {
  const original = sender();
  const owner = await account(request, original);
  const file = sharedTrackFromTrack(original, "private-track");
  const first = await publish(request, owner, file);
  await signIn(page, owner);
  await page.goto("/tracks/private-track");
  await page.getByRole("button", { name: "Edit track", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel("Track title", { exact: true })
    .fill("A revised private curriculum");
  await editor
    .getByRole("button", { name: "Save track changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A revised private curriculum",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/shared-tracks/${first.token}`)).json())
      .file,
  ).toEqual(file);
  await page.getByRole("button", { name: "Share track", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "older links remain available until revoked",
  );
  await dialog
    .getByLabel("I understand anyone with this link can view the snapshot.")
    .check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/shares") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create share link", exact: true })
    .click();
  const second = (await (await response).json()).share as OwnedShare;
  expect(second.token).not.toBe(first.token);
  await expect(
    dialog.getByRole("link", { name: "View published snapshot" }),
  ).toHaveAttribute("href", `/share/${second.token}`);
  const nextFile = sharedTrackFromTrack(
    await durable(page, `account:${owner.id}`),
    "private-track",
  );
  expect(
    (await (await request.get(`/api/shared-tracks/${second.token}`)).json())
      .file,
  ).toEqual(nextFile);
  expect(
    (await (await request.get(`/api/shared-tracks/${first.token}`)).json())
      .file,
  ).toEqual(file);
  const list = await request.get("/api/shares", {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  expect((await list.json()).shares).toHaveLength(2);
});

test("the real service worker and browser history never revive a revoked snapshot", async ({
  page,
  context,
  request,
}) => {
  const owner = await account(request);
  const file = sharedTrackFromTrack(sender(), "private-track");
  const first = await publish(request, owner, file);
  const secondFile = structuredClone(file);
  secondFile.track.title = "Another active snapshot";
  const second = await publish(request, owner, secondFile);
  await page.goto("/settings");
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const before = await readyNotebook(page);
  await page.goto(`/share/${first.token}`);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  expect(await durable(page)).toEqual(before);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => new URL(request.url).pathname,
          ),
        ),
      )
    ).flat();
  });
  expect(cached).toContain("/offline.html");
  expect(
    cached.some(
      (path) => path.startsWith("/share/") || path.startsWith("/api/"),
    ),
  ).toBe(false);
  await page.goto(`/share/${second.token}`);
  await expect(
    page.getByRole("heading", { name: secondFile.track.title, exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.delete(`/api/shares/${first.id}`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      })
    ).status(),
  ).toBe(200);
  await page.goBack();
  await expect(
    page.getByRole("heading", {
      name: "This shared track is unavailable.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add to my Forma", exact: true }),
  ).toHaveCount(0);
  const resolved = await request.get(`/api/shared-tracks/${first.token}`);
  expect(resolved.status()).toBe(404);
  expect(resolved.headers()["cache-control"]).toContain("no-store");
  expect(resolved.headers()["x-robots-tag"]).toContain("noindex");
  await context.setOffline(true);
  try {
    await page.goto(`/share/${first.token}`);
    await expect(
      page.getByRole("heading", {
        name: "A quiet moment offline.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add to my Forma", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test("unsupported or unsafe public responses render an unavailable page without importing or executing shared text", async ({
  page,
  request,
}) => {
  const owner = await account(request);
  const file = sharedTrackFromTrack(sender(), "private-track");
  const share = await publish(request, owner, file);
  const malicious = structuredClone(file);
  malicious.track.title = '<img src=x onerror="window.sharedScriptRan=true">';
  malicious.track.shareDescription =
    "<script>window.sharedScriptRan=true</script>";
  await page.route(`**/api/shared-tracks/${share.token}`, (route) =>
    route.fulfill({ json: { file: malicious } }),
  );
  await page.goto(`/share/${share.token}`);
  await expect(
    page.getByRole("heading", { name: malicious.track.title, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Object.hasOwn(window, "sharedScriptRan")),
  ).toBe(false);
  expect(await page.locator("main img").count()).toBe(0);
  await page.unroute(`**/api/shared-tracks/${share.token}`);
  for (const invalid of [
    { ...file, version: 99 },
    {
      ...file,
      track: {
        ...file.track,
        stages: [
          {
            ...file.track.stages[0],
            problems: [
              {
                ...file.track.stages[0].problems[0],
                url: "https://example.test/steal",
              },
            ],
          },
        ],
      },
    },
  ]) {
    await page.route(`**/api/shared-tracks/${share.token}`, (route) =>
      route.fulfill({ json: { file: invalid } }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "This shared track is unavailable.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add to my Forma", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    await page.unroute(`**/api/shared-tracks/${share.token}`);
  }
  for (const invalid of ["invalid", "0".repeat(64)]) {
    await page.goto(`/share/${invalid}`);
    await expect(
      page.getByRole("heading", {
        name: "This shared track is unavailable.",
        exact: true,
      }),
    ).toBeVisible();
  }
});

test("long public curricula support keyboard disclosures, Large text and narrow reflow in both themes", async ({
  page,
  request,
}) => {
  const owner = await account(request);
  const file = sharedTrackFromTrack(sender(), "private-track", {
    includeHints: true,
    includeDescriptions: true,
  });
  file.track.title = `A long curriculum ${"boundary".repeat(22)}`;
  file.track.stages[0].title = `An extended foundation ${"invariant".repeat(20)}`;
  file.track.stages[0].problems[0].title = `A careful exercise ${"endpoint".repeat(20)}`;
  const share = await publish(request, owner, file);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/share/${share.token}`);
  await expect(
    page.getByRole("heading", { name: file.track.title, exact: true }),
  ).toBeVisible();
  const large = page.getByRole("button", { name: "Large text", exact: true });
  await large.focus();
  await page.keyboard.press("Enter");
  await expect(large).toHaveAttribute("aria-pressed", "true");
  const stage = page.locator("main > div > ol > li > details").first();
  const summary = stage.locator(":scope > summary");
  await summary.focus();
  await page.keyboard.press("Space");
  await expect(stage).not.toHaveAttribute("open");
  await page.keyboard.press("Space");
  await expect(stage).toHaveAttribute("open");
  const hint = stage.locator("details").first();
  await hint.locator(":scope > summary").focus();
  await page.keyboard.press("Space");
  await expect(hint).toHaveAttribute("open");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const theme of ["light", "ink"]) {
    if (theme === "ink")
      await page
        .getByRole("button", { name: "Ink appearance", exact: true })
        .click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(360);
    const add = page.getByRole("link", {
      name: "Add to my Forma",
      exact: true,
    });
    await add.focus();
    await expect(add).toBeFocused();
  }
});
