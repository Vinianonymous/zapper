import { expect, test } from "@playwright/test";

test("RC low-pass AC sweep plots two probes, cursor readout, and sampled table", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("combobox", { name: "Example" }).selectOption("rc");
  await page.getByRole("button", { name: "Load", exact: true }).click();

  await expect(page.getByRole("combobox", { name: "Analysis" })).toHaveValue("ac");
  await expect(page.getByRole("button", { name: "Run AC", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("AC sweep solved successfully");

  await expect(page.locator("#ac-view")).toBeVisible();
  await expect(page.locator("#dc-view")).toBeHidden();
  await expect(page.locator("#ac-legend .ac-legend-item")).toHaveCount(3);
  await expect(page.locator("#ac-legend")).toContainText("Voltage · R1.a");
  await expect(page.locator("#ac-legend")).toContainText("Voltage · C1.a");
  await expect(page.locator("#ac-magnitude svg polyline")).toHaveCount(3);
  await expect(page.locator("#ac-phase svg polyline")).toHaveCount(3);

  // The shared cursor is at log10(159.15 / 10) / log10(100000 / 10) ≈ 0.3 of the plot width.
  const box = await page.locator("#ac-magnitude svg").boundingBox();
  if (!box) throw new Error("Magnitude chart has no bounding box");
  const plotLeft = box.x + box.width * (68 + 0.3 * (900 - 68 - 16)) / 900;
  await page.mouse.move(plotLeft, box.y + box.height / 2);
  await expect(page.locator("#ac-readout")).toContainText("158");
  await expect(page.locator("#ac-readout")).toContainText("mV");
  await expect(page.locator("#ac-readout")).toContainText("dB");
  await expect(page.locator("#ac-readout")).toContainText("°");

  await expect(page.locator("#ac-table-head th")).toHaveCount(7);
  await expect(page.locator("#ac-table-body tr")).toHaveCount(21);
  await expect(page.locator("#ac-table-head")).toContainText("Frequency");
  await expect(page.locator("#ac-table-body")).toContainText("100 kHz");

  const cursor = page.getByRole("slider", { name: "Cursor sample" });
  await cursor.focus();
  await cursor.press("End");
  await expect(page.locator("#ac-readout")).toContainText("100 kHz");
  await cursor.press("Home");
  await expect(page.locator("#ac-readout")).toContainText("10 Hz");

  await page.getByLabel("Start (Hz)").fill("20");
  await page.getByLabel("Start (Hz)").press("Tab");
  await expect(page.locator("#analysis-status")).toContainText("stale");
  await expect(cursor).toBeDisabled();
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("AC sweep solved successfully");
});

test("AC sweep surfaces invalid settings and leaves the previous circuit intact", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("combobox", { name: "Example" }).selectOption("rc");
  await page.getByRole("button", { name: "Load", exact: true }).click();

  const stop = page.getByLabel("Stop (Hz)");
  await stop.fill("5");
  await stop.press("Tab");
  await expect(page.locator("#notice")).toContainText("stop frequency");
  await expect(page.locator("#analysis-status")).not.toContainText("stale");
  await expect(page.getByRole("button", { name: "Run AC", exact: true })).toBeVisible();
});
