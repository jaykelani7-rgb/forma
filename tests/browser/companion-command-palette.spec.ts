import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";
import type { CompanionCommand } from "../../packages/contracts/src";
import { applyCompanionCommand, initialCompanionState } from "../../packages/core/src/companion";
import { emptyData } from "../../src/lib/model";

interface PaletteFixture {
  commands: CompanionCommand[];
  expandRequests: boolean[];
  shortcut(press: number, expanded: boolean, wasExpanded: boolean): void;
}

declare global {
  interface Window {
    __paletteFixture: PaletteFixture;
  }
}

const stamp = "2026-11-08T08:00:00.000Z";
const activeThread = "Try the equal bounds before changing the loop.";
const savedThread = "Check the fencepost on both edges before changing the loop.\nIf the lower bound and upper bound coincide, try a matching value, a value below, and a value above before considering the implementation complete.";
const takeaway = "I isolated the fencepost by writing out the final three states.";

async function openCompanion(page: Page, { paused = false, expanded = true } = {}) {
  const renderer = resolve(".companion-build/renderer");
  const prefix = "/__command_palette__/";
  await page.route(`**${prefix}**`, async route => {
    const path = resolve(renderer, decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.length)));
    if (!path.startsWith(renderer + sep)) return route.abort();
    const contentType = path.endsWith(".html") ? "text/html"
      : path.endsWith(".js") ? "text/javascript"
      : path.endsWith(".css") ? "text/css"
      : "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType });
  });

  const data = emptyData();
  data.problems = [
    { id: "active-problem", title: "Watermelon", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/4/A", problemCode: "4A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
    { id: "past-problem", title: "Lower Boundary", platform: "Codeforces", url: "https://codeforces.com/problemset/problem/5/A", problemCode: "5A", tags: [], rating: 800, createdAt: stamp, reviewAt: null, reviewCount: 0 },
  ];
  data.attempts = [{
    id: "earlier-attempt", problemId: "past-problem", startedAt: stamp, completedAt: "2026-11-08T08:10:00.000Z",
    elapsedMs: 600_000, outcome: "hint", difficulty: "edges", takeaway, notes: "I had mixed up inclusive and exclusive endpoints.",
  }];
  const snapshot: CompanionSnapshot = {
    ...applyCompanionCommand(data, {
      ...initialCompanionState(),
      identity: "contest:4:A",
      problemId: "active-problem",
      desk: [
        { id: "active-thread", problemId: "active-problem", createdAt: stamp, kind: "thread", text: activeThread },
        { id: "past-thread", problemId: "past-problem", createdAt: stamp, kind: "thread", text: savedThread },
      ],
    }, { type: "start", id: "fixture-session", payload: {} }, Date.parse(stamp)),
    revision: 1,
    savedAt: stamp,
    preferences: { theme: "ink", reducedMotion: true, snoozedUntil: null },
    integration: { connected: true, paired: true, status: "Fixture connected" },
    codeforces: { checking: false, checkedAt: null, error: null },
    presentation: { expanded, paletteShortcutPress: 4, paletteShortcutWasExpanded: expanded },
  };
  if (paused) Object.assign(snapshot, applyCompanionCommand(snapshot.data, snapshot.state, {
    type: "pause", id: "fixture-pause", payload: {},
  }, Date.parse(stamp) + 60_000));

  await page.addInitScript(snapshot => {
    const listeners = new Set<(value: CompanionSnapshot) => void>();
    const notify = () => { for (const listener of listeners) listener(structuredClone(snapshot)); };
    const fixture: PaletteFixture = {
      commands: [],
      expandRequests: [],
      shortcut(press, expanded, wasExpanded) {
        snapshot.presentation = { expanded, paletteShortcutPress: press, paletteShortcutWasExpanded: wasExpanded };
        notify();
      },
    };
    window.__paletteFixture = fixture;
    window.forma = {
      getSnapshot: async () => structuredClone(snapshot),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async command(command) {
        fixture.commands.push(structuredClone(command));
        if (command.type !== "resume" || command.expectedProblemKey !== snapshot.state.identity
          || command.expectedSessionId !== snapshot.data.session?.id || !snapshot.data.session) {
          throw new Error("The fixture only resumes its current paused session.");
        }
        snapshot.data.session.runningSince = Date.now();
        snapshot.state.lifecycle = "working";
        snapshot.revision++;
        notify();
        return structuredClone(snapshot);
      },
      async ui(action, payload) {
        if (action === "expand" && typeof payload === "boolean") {
          fixture.expandRequests.push(payload);
          snapshot.presentation = { ...snapshot.presentation, expanded: payload };
          notify();
        }
        return action === "thought-takes" ? [] : null;
      },
    };
  }, snapshot);
  await page.goto(`${prefix}index.html`);
  await expect(page.getByRole("button", { name: expanded ? "Open command palette" : /^Open companion/ })).toBeVisible();
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette", exact: true });
const search = (page: Page) => palette(page).getByRole("combobox", { name: "Search commands and notebook", exact: true });

test("keyboard search previews the exact past reflection and thread and restores focus", async ({ page }) => {
  await openCompanion(page);
  const trigger = page.getByRole("button", { name: "Open command palette", exact: true });
  await trigger.focus();
  await page.keyboard.press("Meta+k");
  await expect(search(page)).toBeFocused();
  await search(page).fill("fencepost");
  await expect(palette(page).getByRole("option", { selected: true })).toContainText("Needed a hint");
  await page.keyboard.press("Enter");
  await expect(palette(page).getByRole("heading", { name: "Needed a hint", exact: true })).toBeFocused();
  await expect(palette(page).getByText(takeaway, { exact: true })).toBeVisible();
  await expect(palette(page).getByText("I had mixed up inclusive and exclusive endpoints.", { exact: true })).toBeVisible();
  await expect(palette(page).getByRole("button", { name: "Open problem desk", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("fencepost");
  await page.keyboard.press("ArrowDown");
  await expect(palette(page).getByRole("option", { selected: true })).toContainText("Saved thread");
  await page.keyboard.press("Enter");
  const note = palette(page).locator(".command-palette-preview-note p");
  await expect(note).toBeVisible();
  expect(await note.textContent()).toBe(savedThread);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const current = await page.evaluate(async () => ({
    snapshot: await window.forma!.getSnapshot(), commands: window.__paletteFixture.commands,
  }));
  expect(current.commands).toEqual([]);
  expect(current.snapshot.state.problemId).toBe("active-problem");
  expect(current.snapshot.data.session).toMatchObject({
    id: "companion:fixture-session", runningSince: Date.parse(stamp),
  });
});

test("the empty palette resumes the paused session with its original target", async ({ page }) => {
  await openCompanion(page, { paused: true });
  await page.keyboard.press("Control+k");
  const selected = palette(page).getByRole("option", { selected: true });
  await expect(selected).toContainText("Resume Watermelon");
  await expect(selected).toContainText(activeThread);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__paletteFixture.commands)).toMatchObject([
    { type: "resume", expectedProblemKey: "contest:4:A", expectedSessionId: "companion:fixture-session" },
  ]);
  expect(await page.evaluate(async () => (await window.forma!.getSnapshot()).data.session?.runningSince)).not.toBeNull();
});

test("global shortcut opens a compact Ribbon and ignores old press counters", async ({ page }) => {
  await openCompanion(page, { expanded: false });
  const press = (counter: number, expanded: boolean) => page.evaluate(({ counter, expanded }) => {
    window.__paletteFixture.shortcut(counter, expanded, false);
  }, { counter, expanded });
  await press(4, false);
  await expect(palette(page)).toHaveCount(0);
  await press(5, true);
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__paletteFixture.expandRequests)).toEqual([false]);
  await press(5, false);
  await press(4, false);
  await expect(palette(page)).toHaveCount(0);
  await press(6, true);
  await expect(search(page)).toBeFocused();
  await press(6, false);
  await expect(palette(page)).toHaveCount(0);
  await press(6, true);
  await expect(palette(page)).toHaveCount(0);
});
