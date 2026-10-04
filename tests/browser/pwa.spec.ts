import { expect, test, type Page } from "@playwright/test";
import { emptyData, type Data } from "../../src/lib/model";

function fixture(activeSession = false): Data {
  const data = emptyData();
  data.problems = [
    {
      id: "offline-problem",
      title: "Offline practice fixture",
      platform: "Manual",
      url: "",
      problemCode: "",
      tags: ["arrays"],
      rating: null,
      createdAt: new Date().toISOString(),
      reviewAt: null,
      reviewCount: 0,
    },
  ];
  if (activeSession)
    data.session = {
      id: "offline-session",
      problemId: data.problems[0].id,
      startedAt: new Date().toISOString(),
      runningSince: null,
      elapsedMs: 120000,
      targetMinutes: 30,
      notes: "Original local notes",
      timerVisible: true,
      phase: "focus",
    };
  return data;
}

async function seed(page: Page, data: Data) {
  await page.addInitScript((data) => {
    if (localStorage.getItem("forma.pwa-fixture")) return;
    localStorage.setItem("forma.personal.v1", JSON.stringify(data));
    localStorage.setItem("forma.pwa-fixture", "seeded");
  }, data);
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: { fetchedAt: new Date().toISOString(), stale: false, problems: [] },
    }),
  );
}

async function savedWorkspace(page: Page): Promise<Data | null> {
  return page.evaluate(
    () =>
      new Promise<Data | null>((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onsuccess = () => {
          const database = request.result;
          const read = database
            .transaction("workspaces")
            .objectStore("workspaces")
            .get("personal");
          read.onsuccess = () => {
            resolve(read.result?.data ?? null);
            database.close();
          };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

test("install assets are served and the real service worker keeps API responses out of its public cache", async ({
  page,
}) => {
  await seed(page, fixture());
  await page.goto("/settings");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.display).toBe("standalone");
  expect(body.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );
  const worker = await page.request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-store");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/"))?.active?.state,
      ),
    )
    .toBe("activated");
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      json: { marker: "private-response-fixture" },
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
  expect(
    await page.evaluate(async () =>
      (
        await fetch("/api/workspace", {
          headers: { Authorization: "Bearer deterministic-fixture" },
        })
      ).json(),
    ),
  ).toEqual({ marker: "private-response-fixture" });
  const resources = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith("forma-public-"),
    );
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
  expect(resources).toContain("/offline.html");
  expect(resources).toContain("/icons/forma-192.png");
  expect(
    resources.every(
      (path) =>
        path === "/offline.html" ||
        path.startsWith("/icons/") ||
        path.startsWith("/fonts/"),
    ),
  ).toBe(true);
  expect(resources.some((path) => path.startsWith("/api/"))).toBe(false);
  expect(resources).not.toContain("/settings");
});

test("a loaded tab saves offline session notes and a cold navigation shows the deliberate reconnect page", async ({
  page,
  context,
}) => {
  await seed(page, fixture(true));
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "Original local notes",
  );
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await expect(
    page.getByText("You’re offline.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("A place for your thoughts")
    .fill("These notes were written offline.");
  await expect
    .poll(async () => (await savedWorkspace(page))?.session?.notes)
    .toBe("These notes were written offline.");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A quiet moment offline.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your saved notebook stays on this device."),
  ).toBeVisible();
  expect((await savedWorkspace(page))?.session?.notes).toBe(
    "These notes were written offline.",
  );
  await context.setOffline(false);
  await page
    .getByRole("link", { name: "Try opening Forma again", exact: true })
    .click();
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "These notes were written offline.",
  );
  await expect(
    page.getByRole("button", { name: "Resume timer", exact: true }),
  ).toBeVisible();
});

test("gentle reminders require opt-in and today's dismissal survives reload", async ({
  page,
}) => {
  await seed(page, fixture());
  await page.goto("/settings");
  const enabled = page.getByRole("checkbox", {
    name: "Offer a gentle reminder on Today",
    exact: true,
  });
  await expect(enabled).not.toBeChecked();
  await expect(
    page.getByText(/does not deliver notifications when the app is closed/),
  ).toBeVisible();
  await enabled.check();
  await page.getByLabel("Reminder time", { exact: true }).fill("00:00");
  await page
    .getByRole("button", { name: "Save reminder time", exact: true })
    .click();
  await expect
    .poll(async () => (await savedWorkspace(page))?.settings.reminder?.time)
    .toBe("00:00");
  await page.goto("/");
  await expect(
    page.getByText("A little practice, if you have room.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Dismiss practice reminder for today",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () => (await savedWorkspace(page))?.settings.reminder?.dismissedOn,
    )
    .toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.reload();
  await expect(
    page.getByText("A little practice, if you have room.", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/settings");
  await page
    .getByRole("checkbox", {
      name: "Offer a gentle reminder on Today",
      exact: true,
    })
    .uncheck();
  await expect
    .poll(async () => (await savedWorkspace(page))?.settings.reminder?.enabled)
    .toBe(false);
});

test("an available update waits for an active session and never reloads away the completed page", async ({
  page,
}) => {
  await seed(page, fixture(true));
  // A deterministic waiting-worker fixture exercises the application guard;
  // the other tests above register and use the real browser service worker.
  await page.addInitScript(() => {
    const messages: unknown[] = [];
    Object.defineProperty(window, "formaUpdateMessages", { value: messages });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {},
        register: async () => ({
          waiting: {
            postMessage: (message: unknown) => messages.push(message),
          },
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      },
    });
  });
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "Original local notes",
  );
  const activate = page.getByRole("button", {
    name: "Activate update",
    exact: true,
  });
  await expect(activate).toBeDisabled();
  await page
    .getByLabel("A place for your thoughts")
    .fill("Keep this draft through the update.");
  await expect
    .poll(async () => (await savedWorkspace(page))?.session?.notes)
    .toBe("Keep this draft through the update.");
  await expect(activate).toBeDisabled();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save reflection", exact: true })
    .click();
  await expect
    .poll(async () => (await savedWorkspace(page))?.session)
    .toBeNull();
  await expect(activate).toBeEnabled();
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await activate.click();
  await expect(
    page.getByText("Update activated.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-complete")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { formaUpdateMessages?: unknown[] })
          .formaUpdateMessages,
    ),
  ).toEqual([{ type: "ACTIVATE_UPDATE" }]);
  expect(navigations).toBe(0);
  expect((await savedWorkspace(page))?.attempts[0].notes).toBe(
    "Keep this draft through the update.",
  );
});
