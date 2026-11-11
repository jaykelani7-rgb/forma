import { expect, test } from "@playwright/test";
import { macDownloadUrl } from "../../src/lib/mac-download";

test("the browser preview rehearses a session without opening a notebook", async ({ page }) => {
  await page.goto("/preview");
  await expect(page.getByRole("heading", { name: "Try a practice session." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const rehearsal = page.getByRole("region", { name: "Sample session rehearsal" });
  await expect(rehearsal.getByRole("heading", { name: "Meet your ribbon." })).not.toBeFocused();
  await rehearsal.getByRole("button", { name: "Open sample ribbon" }).click();
  await expect(rehearsal.getByRole("heading", { name: "Start with one problem." })).toBeFocused();
  await rehearsal.getByRole("button", { name: "Start sample timer" }).click();
  await rehearsal.getByRole("button", { name: "Pause sample timer" }).click();
  await rehearsal.getByLabel("Sample outcome").selectOption("independent");
  await rehearsal.getByLabel("One thought for next time").fill("Try the smallest example first.");
  await rehearsal.getByRole("button", { name: "Bookmark sample thought" }).click();
  await expect(rehearsal.getByText("Try the smallest example first.")).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await page.reload();
  await expect(rehearsal.getByRole("button", { name: "Open sample ribbon" })).toBeVisible();
  await expect(rehearsal.getByText("Try the smallest example first.")).toHaveCount(0);
});

test("the Mac release controls the public home and preserves access to notebook export", async ({ page }) => {
  const downloadUrl = macDownloadUrl();
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(await manifest.json()).toMatchObject({ start_url: downloadUrl ? "/today" : "/" });
  await page.goto("/");
  const download = page.getByRole("link", { name: "Download for Mac", exact: true });
  if (downloadUrl) {
    await expect(page.getByRole("heading", { name: "Make time to solve." })).toBeVisible();
    await expect(download).toHaveAttribute("href", downloadUrl);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  } else {
    await expect(page.getByRole("navigation", { name: "Primary navigation", includeHidden: true })).toBeAttached();
    await expect(download).toHaveCount(0);
  }

  await page.goto("/download");
  await expect(page.getByRole("heading", { name: "Forma for Mac." })).toBeVisible();
  if (downloadUrl) await expect(download).toHaveAttribute("href", downloadUrl);
  else await expect(download).toHaveCount(0);
  await page.getByRole("link", { name: "Export web data" }).click();
  await expect(page.getByRole("button", { name: "Export my data" })).toBeVisible();
  if (downloadUrl) {
    const today = page.getByRole("navigation", { name: "Primary navigation", includeHidden: true }).getByRole("link", { name: "Today", exact: true, includeHidden: true });
    await expect(today).toHaveAttribute("href", "/today");
  }
  await page.goto("/today");
  await expect(page.getByRole("navigation", { name: "Primary navigation", includeHidden: true })).toBeAttached();
});
