import { expect, test } from "@playwright/test";

test("loads the dark editor with a ready starter circuit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Circuit Simulator", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.getByRole("button", { name: "Run DC", exact: true })).toBeEnabled();
  await expect(page.locator("#schematic [data-component]")).toHaveCount(4);
});
