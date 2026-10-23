import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { emptyData } from "../../src/lib/model";
import { initialCompanionState } from "../../packages/core/src/companion";
import { deriveSetupStatus } from "../../packages/setup/status";
import type { CompanionSnapshot } from "../../apps/desktop/renderer/api";

declare global { interface Window { __setupMock: { calls: { action: string; payload?: unknown }[]; failRestore: boolean } } }

async function openSetup(page: Page, theme: "light" | "ink" = "light") {
  const root = resolve(".companion-build/renderer");
  await page.route("**/__setup__/**", async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice("/__setup__/".length)) || "index.html";
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) { await route.abort(); return; }
    const contentType = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    await route.fulfill({ body: await readFile(path), contentType });
  });
  const snapshot: CompanionSnapshot = { data: emptyData(), state: initialCompanionState(), revision: 1, savedAt: "2026-10-23T08:00:00.000Z", integration: { paired: true, connected: false, browserEnabled: true, browserSupported: true, status: "Waiting for VS Code" }, preferences: { theme, reducedMotion: true, snoozedUntil: null }, codeforces: { checking: false, checkedAt: null, error: null }, presentation: { expanded: true } };
  const status = deriveSetupStatus({ storage: { available: true }, vscode: { paired: true, connected: false }, practiceFolders: { observable: false }, browser: { supported: true, enabled: true, hostInstalled: true }, provider: { provider: "gemini", configured: true }, login: { supported: true, packaged: false, enabled: false } });
  await page.addInitScript(({ snapshot, status }) => {
    const controls = { calls: [] as { action: string; payload?: unknown }[], failRestore: false };
    window.__setupMock = controls;
    window.forma = {
      getSnapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, command: async () => { throw new Error("Fixture forbids automatic practice commands."); },
      ui: async (action: string, payload?: unknown) => {
        controls.calls.push({ action, payload });
        if (action === "setup-status") return structuredClone(status);
        if (action === "backup-export") return { saved: true };
        if (action === "restore-choose") return { token: "fixture-preview-token", scope: "notebook", includeTutor: false, counts: { problems: 2, attempts: 3, thoughts: 1, conversations: 0, turns: 0, drafts: 0 }, replacement: ["Replace notebook learning records and planner projections.", "Keep existing Tutor conversations and drafts."], warnings: ["Folder permissions are not imported."] };
        if (action === "restore-confirm") {
          if (controls.failRestore) throw new Error("Recovery backup failed. Current data was not changed.");
          return { backupPath: "/fixture/recovery/forma-before-restore.json", summary: "Notebook restored with timers paused." };
        }
        return null;
      },
    };
  }, { snapshot, status });
  await page.goto("/__setup__/index.html");
  await page.getByRole("button", { name: "Companion settings" }).click();
  await expect(page.getByText("Local notebook ready", { exact: true })).toBeVisible();
}

test("setup presents independent observed states and never tests credentials or changes login settings", async ({ page }) => {
  await openSetup(page);
  await page.getByText("Connection details", { exact: true }).click();
  await expect(page.getByText("Paired", { exact: true })).toBeVisible();
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible();
  await expect(page.getByText("Not observable", { exact: true })).toBeVisible();
  await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Gemini · key configured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Open Fenn when I sign in")).toBeDisabled();
  await expect(page.getByLabel("Open Fenn when I sign in")).not.toBeChecked();
  const calls = await page.evaluate(() => window.__setupMock.calls.map(call => call.action));
  expect(calls).toContain("setup-status");
  expect(calls.some(action => /tutor-send|tutor-transcribe|tutor-microphone|launch-at-login/.test(action))).toBe(false);
});

test("backup export makes Tutor an explicit companion-only choice", async ({ page }) => {
  await openSetup(page, "ink");
  await page.getByText("Choose what to export", { exact: true }).click();
  await page.getByRole("button", { name: "Export notebook backup", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__setupMock.calls.find(call => call.action === "backup-export")?.payload)).toEqual({ scope: "notebook", includeTutor: false });
  await page.getByLabel("Backup contents").selectOption("companion");
  const tutorChoice = page.getByLabel("Include Tutor conversations, immutable context and unsent drafts");
  await expect(tutorChoice).not.toBeChecked();
  await tutorChoice.check();
  await page.getByRole("button", { name: "Export companion backup", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__setupMock.calls.filter(call => call.action === "backup-export").at(-1)?.payload)).toEqual({ scope: "companion", includeTutor: true });
});

test("restore shows exact scope and requires explicit confirmation, retaining review after recovery-backup failure", async ({ page }) => {
  await openSetup(page);
  await page.getByRole("button", { name: "Choose a backup to restore", exact: true }).click();
  const review = page.getByRole("region", { name: "Review restore" });
  await expect(review).toBeVisible();
  await expect(review.getByText("Keep existing Tutor conversations and drafts.", { exact: true })).toBeVisible();
  const restore = review.getByRole("button", { name: "Create recovery backup & restore", exact: true });
  await expect(restore).toBeDisabled();
  expect(await page.evaluate(() => window.__setupMock.calls.some(call => call.action === "restore-confirm"))).toBe(false);
  await review.getByLabel("I understand the replacement scope above and want to restore this backup.").check();
  await page.evaluate(() => { window.__setupMock.failRestore = true; });
  await restore.click();
  await expect(page.getByRole("alert")).toHaveText("Recovery backup failed. Current data was not changed.");
  await expect(review).toBeVisible();
  await page.evaluate(() => { window.__setupMock.failRestore = false; });
  await restore.click();
  await expect(review).toHaveCount(0);
  await expect(page.getByText(/Recovery backup: \/fixture\/recovery/)).toBeVisible();
  expect(await page.evaluate(() => window.__setupMock.calls.filter(call => call.action === "restore-confirm").map(call => call.payload))).toEqual([{ token: "fixture-preview-token" }, { token: "fixture-preview-token" }]);
});
