import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dividerExample } from "../../src/model/document";
import { releaseFixture } from "../../benchmarks/fixtures";

test("redrawing an interrupted divider path restores its visible and simulated connectivity", async ({ page }) => {
  await page.goto("/");
  const point = async (x: number, y: number) => page.locator("#schematic").evaluate((svg: SVGSVGElement, p) => {
    const screen = new DOMPoint(p.x * 20, p.y * 20).matrixTransform(svg.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  const hit = await point(10, 0);
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.press("Delete");
  await expect(page.locator('#schematic [data-wire="w2"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("failed");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  for (const [x, y] of [[8, 0], [12, 2]]) {
    const pin = await point(x!, y!);
    await page.mouse.click(pin.x, pin.y);
  }
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  await expect(page.getByRole("row", { name: /Voltage · R2\.a .*5 V/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Current · R1 .*5 mA/ })).toBeVisible();
});

test("keyboard property edits retain focus and palette state is exposed", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-component="r1"] text').first().click();
  const reference = page.getByLabel("Reference", { exact: true });
  await reference.fill("Load resistor");
  await reference.press("Enter");
  await reference.dispatchEvent("change");
  await expect(reference).toBeFocused();
  await page.keyboard.press("Tab");
  const value = page.getByLabel("Value (Ω)", { exact: true });
  await expect(value).toBeFocused();
  await value.fill("2k");
  await value.press("Tab");
  await expect(page.getByLabel("Grid X", { exact: true })).toBeFocused();
  await expect(page.locator('#schematic [data-component="r1"]')).toContainText("2 kΩ");
  await page.getByRole("button", { name: "Wire", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wire", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Select / move", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("cancelled drags restore connectivity, invalidate readings, and do not corrupt saved history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  const stored = await page.evaluate(() => localStorage.getItem("circuit-studio-schematic-v1"));
  const before = await page.locator("#net-list").textContent();
  const symbol = page.locator('[data-component="r1"] rect');
  const box = await symbol.boundingBox();
  if (!box) throw new Error("Missing R1");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 3 });
  await expect(page.locator("#analysis-status")).toContainText("stale");
  await expect(page.locator("#probe-readings")).not.toContainText("5 mA");
  await page.locator("#schematic").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect(await page.locator("#net-list").textContent()).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("circuit-studio-schematic-v1"))).toBe(stored);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("untrusted imports render as text; SVG is standalone and frames Unicode labels", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  const circuit = dividerExample();
  circuit.components[0]!.ref = '<script>alert("x")</script>';
  circuit.components[1]!.ref = "電".repeat(40);
  await page.locator("#import-file").setInputFiles({ name: "untrusted.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(circuit)) });
  await expect(page.locator("#notice")).toContainText("imported");
  await expect(page.locator("#schematic script")).toHaveCount(0);
  await expect(page.locator("#schematic")).toContainText('<script>alert("x")</script>');
  await page.getByLabel("Export format").selectOption("svg");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const text = await readFile(await (await download).path(), "utf8");
  // Open without the application, its CSS, or any simulation output.
  await page.setContent(text);
  await expect(page.locator("script, foreignObject, image, use, style")).toHaveCount(0);
  const framed = await page.locator("svg").evaluate((svg: SVGSVGElement) => {
    const bounds = svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll("text")).every((text) => {
      const box = text.getBBox();
      return box.x >= bounds.x && box.y >= bounds.y && box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height;
    });
  });
  expect(framed).toBe(true);
});

test("static build runs, edits, imports and exports with only local asset requests", async ({ page }) => {
  const unexpected: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173" || request.method() !== "GET" || ["fetch", "xhr", "websocket"].includes(request.resourceType())) {
      unexpected.push(request.url());
      await route.abort();
    } else await route.continue();
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "Run DC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("rc");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("rlc");
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByRole("button", { name: "Run Transient", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("Transient solved successfully");
  await page.getByRole("combobox", { name: "Analysis", exact: true }).selectOption("ac");
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  const slider = page.getByLabel("Cursor sample");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await page.getByText("Text-accessible sampled values", { exact: true }).click();
  await expect(page.locator("#ac-table-body tr")).toHaveCount(21);
  await page.getByLabel("Start (Hz)").fill("20");
  await page.getByLabel("Start (Hz)").press("Tab");
  await expect(page.locator("#analysis-status")).toContainText("stale");
  await expect(page.locator("#ac-magnitude path")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const buffer = await readFile(await (await download).path());
  await page.locator("#import-file").setInputFiles({ name: "circuit.json", mimeType: "application/json", buffer });
  await expect(page.locator("#notice")).toContainText("imported");
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("size-target circuit remains inspectable while its sweep is cancelled", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  const circuit = releaseFixture();
  circuit.settings.ac.points = 10_000;
  await page.locator("#import-file").setInputFiles({ name: "large.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(circuit)) });
  await expect(page.locator("#schematic [data-component]")).toHaveCount(200);
  await page.getByRole("combobox", { name: "Analysis", exact: true }).selectOption("ac");
  await page.getByRole("button", { name: "Run AC", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#analysis-status")).toContainText("cancelled");
  await expect(page.locator("#ac-magnitude path")).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run AC", exact: true })).toBeEnabled();
});
