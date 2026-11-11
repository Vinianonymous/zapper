import { expect, test } from "@playwright/test";

test("place a part, persist it, and export the circuit JSON", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#schematic");
  await expect(canvas).toBeVisible();

  await page.getByRole("button", { name: /Resistor/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await expect(page.getByRole("heading", { name: /R3 · Resistor/ })).toBeVisible();

  await page.getByRole("button", { name: /Wire/ }).click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("circuit-studio-schematic-v1") ?? "null"),
  );
  expect(stored.components).toHaveLength(5);
  expect(stored.wires.length).toBeGreaterThan(3);

  await page.getByRole("combobox", { name: "Export format" }).selectOption("json");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("circuit.json");

  await page.reload();
  await expect(page.locator("#schematic [data-component]")).toHaveCount(5);
});
