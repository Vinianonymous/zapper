import { expect, test } from "@playwright/test";

test("editor exposes tools, probes, connectivity and export without a theme switch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Select \/ move/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Run DC", exact: true })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Export format" })).toBeVisible();
  await expect(page.getByText("Connectivity")).toBeVisible();
  await expect(page.locator("#probe-list")).toContainText("Voltage");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("starter voltage divider solves in the DC worker", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText(/solved successfully|failed/i, { timeout: 10_000 });
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
});
