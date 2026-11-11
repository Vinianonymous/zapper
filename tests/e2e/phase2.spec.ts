import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("run DC, read probes, and export JSON plus both image formats", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("DC operating point solved");
  await expect(page.getByRole("row", { name: /Voltage · R2\.a .*5 V/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Current · R1 .*5 mA/ })).toBeVisible();

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Export format" }).selectOption("json");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe("circuit.json");
  const jsonText = await readFile(await json.path(), "utf8");
  expect(JSON.parse(jsonText).schemaVersion).toBe(1);
  expect(JSON.parse(jsonText).components).toHaveLength(4);
  expect(JSON.parse(jsonText).probes).toHaveLength(2);

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Export format" }).selectOption("svg");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("circuit.svg");
  const svgText = await readFile(await svg.path(), "utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain('fill="#10141c"');
  expect(svgText).toContain("R1");
  expect(svgText).not.toContain("data-component");

  const pngDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "Export format" }).selectOption("png");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe("circuit.png");
  const pngBytes = await readFile(await png.path());
  expect(pngBytes.subarray(1, 4).toString()).toBe("PNG");
  expect(pngBytes.length).toBeGreaterThan(1000);
});

test("switch edits make old results stale; invalid imports preserve the circuit", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("combobox", { name: "Example" }).selectOption("switch");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");

  const switchBox = await page.locator("[data-component='s1']").boundingBox();
  if (!switchBox) throw new Error("Switch has no bounding box");
  await page.mouse.click(switchBox.x + switchBox.width / 2, switchBox.y + switchBox.height * 0.3);
  await page.getByLabel("Closed", { exact: true }).uncheck();
  await expect(page.locator("#analysis-status")).toContainText("stale");
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.getByRole("row", { name: /Voltage · R2\.a .*0 V/ })).toBeVisible();

  const before = await page.locator("#schematic [data-component]").count();
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":2}'),
  });
  await expect(page.locator("#notice")).toContainText("schema version");
  await expect(page.locator("#schematic [data-component]")).toHaveCount(before);
});

test("missing ground fails with an actionable diagnostic", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Voltage source", exact: true }).click();
  const box = await page.locator("#schematic").boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#diagnostics")).toContainText("missing-ground");
  await expect(page.locator("#analysis-status")).toContainText("preflight failed");
});
