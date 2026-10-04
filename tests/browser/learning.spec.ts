import { expect, test, type Page } from "@playwright/test";
import {
  connectProfile,
  mergeActivity,
  saveQuickReflection,
} from "../../src/lib/codeforces";
import { defaultDiscovery } from "../../src/lib/discovery";
import {
  addDays,
  emptyData,
  localDate,
  validateData,
  type Data,
} from "../../src/lib/model";
import type {
  ActivityPage,
  SubmissionInput,
} from "../../src/lib/codeforces-types";

const titles = {
  assisted: "Imported graph practice",
  pending: "Unreflected accepted practice",
  accepted: "Accepted catalogue problem",
  fresh: "Fresh catalogue problem",
  alternate: "Alternative catalogue problem",
};
// Real opt-in account tokens must never enter uploaded browser traces.
test.use({
  trace:
    process.env.FORMA_BROWSER_TEST_ACCOUNT_A_TOKEN ||
    process.env.FORMA_BROWSER_TEST_ACCOUNT_B_TOKEN
      ? "off"
      : "retain-on-failure",
});

function importedFixture(): Data {
  const now = new Date();
  const submission = (
    id: number,
    title: string,
    contestId: number,
    days: number,
  ): SubmissionInput => ({
    id,
    submittedAt: addDays(now, days).toISOString(),
    verdict: "OK",
    language: "GNU C++20",
    problem: {
      key: `contest:${contestId}:A`,
      title,
      code: `${contestId}A`,
      url: `https://codeforces.com/problemset/problem/${contestId}/A`,
      rating: 1200,
      tags: ["graphs"],
    },
  });
  const page: ActivityPage = {
    handle: "fixture_user",
    from: 1,
    count: 50,
    submissions: [
      submission(101, titles.assisted, 1001, -7),
      submission(102, titles.pending, 1002, -1),
      submission(103, titles.accepted, 1003, -1),
    ],
  };
  let data = mergeActivity(
    connectProfile(
      emptyData(),
      { handle: "fixture_user", rating: 1400, rank: "specialist" },
      now,
    ),
    "fixture_user",
    [page],
    "refresh",
    now,
  );
  const assisted = data.codeforces.practiceAttempts.find(
    (attempt) =>
      data.problems.find((problem) => problem.id === attempt.problemId)
        ?.title === titles.assisted,
  )!;
  data = saveQuickReflection(
    data,
    assisted.id,
    {
      outcome: "hint",
      difficulty: "approach",
      takeaway: "Sketch the graph before coding.",
      reviewAt: localDate(now),
      overrideSchedule: true,
    },
    now,
  );
  data.codeforces.profiles[0].historyComplete = false;
  data.discovery = {
    ...defaultDiscovery(),
    selectedKey: "contest:1004:A",
    selectedOn: localDate(now),
  };
  return data;
}

async function seed(page: Page, data: Data, theme: "light" | "dark" = "light") {
  await page.addInitScript(
    ({ data, theme }) => {
      if (localStorage.getItem("forma.browser-fixture")) return;
      localStorage.setItem("forma.personal.v1", JSON.stringify(data));
      localStorage.setItem("forma.theme", theme);
      localStorage.setItem("forma.browser-fixture", "seeded");
    },
    { data, theme },
  );
  await page.route("**/api/catalogue", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        stale: false,
        problems: [
          {
            key: "contest:1003:A",
            title: titles.accepted,
            code: "1003A",
            url: "https://codeforces.com/problemset/problem/1003/A",
            rating: 1200,
            tags: ["graphs"],
          },
          {
            key: "contest:1004:A",
            title: titles.fresh,
            code: "1004A",
            url: "https://codeforces.com/problemset/problem/1004/A",
            rating: 1200,
            tags: ["graph theory fixture"],
          },
          {
            key: "contest:1005:A",
            title: titles.alternate,
            code: "1005A",
            url: "https://codeforces.com/problemset/problem/1005/A",
            rating: 1300,
            tags: ["dp"],
          },
        ],
      },
    }),
  );
  await page.route("**/api/codeforces?**", (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    return route.fulfill({
      json:
        action === "profile"
          ? { handle: "fixture_user", rating: 1400, rank: "specialist" }
          : { handle: "fixture_user", from: 1, count: 50, submissions: [] },
    });
  });
}

async function savedWorkspace(page: Page): Promise<Data | null> {
  return page.evaluate(
    () =>
      new Promise<Data | null>((resolve, reject) => {
        const request = indexedDB.open("forma-workspaces", 1);
        request.onsuccess = () => {
          const read = request.result
            .transaction("workspaces")
            .objectStore("workspaces")
            .get("personal");
          read.onsuccess = () => {
            resolve(read.result?.data ?? null);
            request.result.close();
          };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

test("imported-only learning progress, pending state and a later timed breakthrough", async ({
  page,
}) => {
  await seed(page, importedFixture());
  await page.goto("/progress");
  await expect(page.locator(".progress-overview")).toContainText(
    "0 timed sessions",
  );
  await expect(page.locator(".progress-overview")).toContainText("0m");
  await expect(
    page.getByRole("img", {
      name: "0 independent solves, 1 assisted attempts, 0 not solved yet.",
    }),
  ).toBeVisible();
  await expect(page.getByText(/2 attempted, reflection pending/)).toBeVisible();
  await page.goto("/problems");
  await page.getByLabel("Filter by outcome").selectOption("pending");
  await expect(
    page.getByRole("button", { name: titles.pending, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by outcome").selectOption("fresh");
  await expect(
    page.getByRole("button", { name: titles.pending, exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Filter by outcome").selectOption("");
  await page
    .getByRole("button", { name: titles.assisted, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Sketch the graph before coding.",
  );
  await expect(page.getByRole("dialog")).toContainText("No timed sessions yet");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: `Start session: ${titles.assisted}` })
    .click();
  await page.getByRole("button", { name: "Finish session" }).click();
  await page
    .getByRole("button", { name: "Solved independently", exact: true })
    .click();
  await page.getByRole("button", { name: "No revisit", exact: true }).click();
  await page.getByRole("button", { name: "Save reflection" }).click();
  await expect(
    page.getByRole("heading", { name: /You found your own way through/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await savedWorkspace(page))?.attempts.length)
    .toBe(1);
  await page.goto("/progress");
  await expect(
    page.getByRole("img", {
      name: "1 independent solves, 1 assisted attempts, 0 not solved yet.",
    }),
  ).toBeVisible();
  await expect(page.locator(".later-solves")).toContainText(titles.assisted);
  await expect(page.locator(".progress-overview")).toContainText(
    "1 timed sessions",
  );
});

test("quick reflection keeps a deliberate future revisit and accessible controls in both themes", async ({
  page,
}, testInfo) => {
  const future = localDate(addDays(new Date(), 35));
  await seed(page, importedFixture(), "dark");
  await page.goto("/activity");
  await page
    .getByRole("button", { name: `Reflect: ${titles.pending}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Used the editorial", exact: true })
    .click();
  await dialog.locator(".quick-optional > summary").click();
  await dialog
    .getByRole("button", { name: "Turning the idea into code", exact: true })
    .click();
  await dialog
    .getByLabel(/One thing to remember/)
    .fill("Write the invariant before implementing.");
  await dialog.getByLabel("Proposed revisit date").fill(future);
  await dialog.locator(".quick-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const save = dialog.getByRole("button", {
    name: "Save reflection",
    exact: true,
  });
  const skip = dialog.getByRole("button", {
    name: "Skip for now",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await expect(skip).toBeInViewport();
  await page.screenshot({
    path: `docs/forma-reflection-${testInfo.project.name}-ink.png`,
    animations: "disabled",
  });
  await save.click();
  await page
    .getByRole("button", {
      name: `Edit reflection: ${titles.pending}`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Proposed revisit date")).toHaveValue(future);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await savedWorkspace(page))?.problems.find(
          (problem) => problem.title === titles.pending,
        )?.reviewAt,
    )
    .toBe(future);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Warm paper", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/activity");
  await page
    .getByRole("button", {
      name: `Edit reflection: ${titles.pending}`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Proposed revisit date")).toHaveValue(future);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Save reflection" }),
  ).toBeInViewport();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: `docs/forma-reflection-${testInfo.project.name}-light.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("fresh discovery excludes accepted history, hides approach tags and retains dismissals through reload", async ({
  page,
}, testInfo) => {
  await seed(page, importedFixture(), "dark");
  await page.goto("/");
  const discovery = page.getByRole("region", {
    name: "Choose your next problem",
  });
  await expect(
    discovery.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await expect(discovery).toContainText("Imported history is incomplete");
  await expect(
    discovery.getByRole("heading", { name: titles.accepted, exact: true }),
  ).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1280) < 760) {
    const targets = await page.locator(".mobile-nav a").evaluateAll((links) =>
      links.map((link) => {
        const rectangle = link.getBoundingClientRect();
        return {
          top: Math.round(rectangle.top),
          width: rectangle.width,
          height: rectangle.height,
        };
      }),
    );
    expect(targets.length).toBe(5);
    expect(new Set(targets.map((target) => target.top)).size).toBe(1);
    expect(
      targets.every((target) => target.width >= 44 && target.height >= 44),
    ).toBe(true);
  }
  await expect(discovery.locator(".discovery-tags p")).toBeHidden();
  await page.screenshot({
    path: `docs/forma-today-${testInfo.project.name}-ink.png`,
    animations: "disabled",
  });
  await discovery.getByText("Reveal topic tags", { exact: true }).click();
  await expect(discovery.locator(".discovery-tags p")).toHaveText(
    "graph theory fixture",
  );
  await expect(discovery.locator(".discovery-tags p")).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Warm paper", exact: true }).click();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    discovery.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/forma-today-${testInfo.project.name}-light.png`,
    animations: "disabled",
  });
  await discovery
    .getByRole("button", { name: "Not today", exact: true })
    .click();
  await expect(
    discovery.getByRole("heading", { name: titles.alternate, exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await savedWorkspace(page))?.discovery?.dismissals.some(
        (dismissal) =>
          dismissal.key === "contest:1004:A" &&
          dismissal.reason === "not_today",
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(
    discovery.getByRole("heading", { name: titles.alternate, exact: true }),
  ).toBeVisible();
  await expect(
    discovery.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toHaveCount(0);
  await discovery
    .getByRole("button", { name: "Too difficult", exact: true })
    .click();
  await expect(discovery).toContainText("No suitable fresh problem right now");
  await expect(discovery).not.toContainText("Generic match");
});

test("duration changes practice composition and fresh practice becomes a recoverable timed session", async ({
  page,
}) => {
  await seed(page, importedFixture());
  await page.goto("/");
  const discovery = page.getByRole("region", {
    name: "Choose your next problem",
  });
  const durations = page.getByRole("group", { name: "Session duration" });
  await expect(
    discovery.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await durations.getByRole("button", { name: "15 min", exact: true }).click();
  await expect(
    discovery.getByRole("heading", { name: titles.assisted, exact: true }),
  ).toBeVisible();
  await expect(
    discovery.getByRole("button", { name: "Start this revisit", exact: true }),
  ).toBeVisible();
  await durations.getByRole("button", { name: "60 min", exact: true }).click();
  await expect(discovery).toContainText(
    `Suggested order: revisit ${titles.assisted}, then this fresh problem if time remains.`,
  );
  await durations.getByRole("button", { name: "30 min", exact: true }).click();
  await expect(
    discovery.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await discovery
    .getByRole("button", { name: "Start fresh practice", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const stored = await savedWorkspace(page);
      return stored?.problems.find(
        (problem) => problem.id === stored.session?.problemId,
      )?.title;
    })
    .toBe(titles.fresh);
  await page.getByRole("button", { name: "Pause timer", exact: true }).click();
  await expect
    .poll(async () => (await savedWorkspace(page))?.session?.runningSince)
    .toBeNull();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: titles.fresh, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume timer", exact: true }),
  ).toBeVisible();
});

test("a suspended stale tab cannot replace newer session notes and offers an exportable recovery copy", async ({
  page,
  context,
}) => {
  const fixture = importedFixture();
  fixture.session = {
    id: "browser-session",
    problemId: fixture.problems[0].id,
    startedAt: new Date().toISOString(),
    runningSince: null,
    elapsedMs: 120000,
    targetMinutes: 30,
    notes: "Original notes",
    timerVisible: true,
    phase: "focus",
  };
  await seed(page, fixture);
  await page.goto("/session");
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "Original notes",
  );
  const stale = await context.newPage();
  // Simulate a suspended tab which misses cross-tab events. The production
  // write transaction still has to reject the genuinely conflicting stale edit.
  await stale.addInitScript(`
    Object.defineProperty(window, 'BroadcastChannel', {value: class { constructor() {} postMessage() {} close() {} }});
    const originalAddEventListener = window.addEventListener.bind(window);
    window.addEventListener = (type, ...args) => { if (type !== 'focus') originalAddEventListener(type, ...args); };
  `);
  await stale.goto("/session");
  await expect(stale.getByLabel("A place for your thoughts")).toHaveValue(
    "Original notes",
  );
  await page
    .getByLabel("A place for your thoughts")
    .fill("Newer notes from tab A");
  await expect
    .poll(async () => (await savedWorkspace(page))?.session?.notes)
    .toBe("Newer notes from tab A");
  await stale
    .getByLabel("A place for your thoughts")
    .fill("Different notes from stale tab B");
  await expect(
    stale.getByText(/Another tab changed the same records/),
  ).toBeVisible();
  await expect(stale.getByLabel("A place for your thoughts")).toHaveValue(
    "Newer notes from tab A",
  );
  await stale.goto("/settings");
  await stale
    .getByRole("button", { name: "Review recovery copies", exact: true })
    .click();
  await stale
    .getByRole("button", { name: "Export recovery copy", exact: true })
    .first()
    .click();
  await stale.getByText("View backup JSON", { exact: true }).click();
  const backup = JSON.parse(await stale.getByLabel("Backup JSON").inputValue());
  expect(backup.session.notes).toBe("Different notes from stale tab B");
  await page.reload();
  await expect(page.getByLabel("A place for your thoughts")).toHaveValue(
    "Newer notes from tab A",
  );
});

test("account endpoints fail closed without a verified session and preserve local use", async ({
  page,
}) => {
  await seed(page, importedFixture());
  const suppliedOwner = await page.request.get(
    "/api/account?userId=00000000-0000-4000-8000-000000000000&handle=fixture_user",
  );
  expect(suppliedOwner.status()).toBe(400);
  expect((await suppliedOwner.json()).code).toBe("invalid_request");
  const account = await page.request.get("/api/account");
  expect([401, 503]).toContain(account.status());
  expect(account.headers()["cache-control"]).toContain("no-store");
  expect(["unauthorized", "not_configured"]).toContain(
    (await account.json()).code,
  );
  const workspace = await page.request.get("/api/workspace");
  expect([401, 503]).toContain(workspace.status());
  await page.goto("/problems");
  await expect(
    page.getByRole("button", { name: titles.assisted, exact: true }),
  ).toBeVisible();
});

test.describe("configured account checks", () => {
  test("two verified accounts remain distinct and private reads reject supplied owners", async ({
    request,
  }) => {
    const firstToken = process.env.FORMA_BROWSER_TEST_ACCOUNT_A_TOKEN;
    const secondToken = process.env.FORMA_BROWSER_TEST_ACCOUNT_B_TOKEN;
    test.skip(
      !firstToken || !secondToken,
      "Set two throwaway test-account access tokens against a configured Forma server to verify real account reads.",
    );
    const firstHeaders = { Authorization: `Bearer ${firstToken}` };
    const secondHeaders = { Authorization: `Bearer ${secondToken}` };
    const [firstAccount, secondAccount] = await Promise.all([
      request.get("/api/account", { headers: firstHeaders }),
      request.get("/api/account", { headers: secondHeaders }),
    ]);
    test.skip(
      firstAccount.status() === 503 || secondAccount.status() === 503,
      "A provisioned account backend is required for real account isolation checks.",
    );
    expect(firstAccount.status()).toBe(200);
    expect(secondAccount.status()).toBe(200);
    const firstId = (await firstAccount.json()).user.id;
    const secondId = (await secondAccount.json()).user.id;
    expect(typeof firstId).toBe("string");
    expect(typeof secondId).toBe("string");
    expect(firstId === secondId).toBe(false);
    const clients: [Record<string, string>, string][] = [
      [firstHeaders, secondId],
      [secondHeaders, firstId],
    ];
    for (const [headers, otherAccountId] of clients) {
      const workspace = await request.get("/api/workspace", { headers });
      expect(workspace.status()).toBe(200);
      expect(workspace.headers()["cache-control"]).toContain(
        "private, no-store",
      );
      const body = await workspace.json();
      expect(Number.isSafeInteger(body.revision) && body.revision >= 0).toBe(
        true,
      );
      if (body.data !== null) validateData(body.data);
      const supplied = await request.get(
        `/api/workspace?userId=${encodeURIComponent(otherAccountId)}`,
        { headers },
      );
      expect(supplied.status()).toBe(400);
    }
  });
});
