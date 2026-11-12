import { expect, test } from "@playwright/test";

test("moving and deleting a part updates its wires, and the run shortcut works", async ({ page }) => {
  await page.goto("/");
  const circuit = () => page.evaluate(() => JSON.parse(localStorage.getItem("circuit-studio-schematic-v1")!));
  const part = page.locator('#schematic [data-component="r1"] rect');
  const bounds = await part.boundingBox();
  if (!bounds) throw new Error("Resistor not visible");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const moved = await circuit();
  expect(moved.components.find((component: { id: string }) => component.id === "r1").position.y).not.toBe(0);
  expect(moved.wires.find((wire: { id: string }) => wire.id === "w1").points.at(-1).y)
    .toBe(moved.components.find((component: { id: string }) => component.id === "r1").position.y);
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#analysis-status")).toContainText("solved successfully");
  await page.locator('#schematic [data-component="r1"]').click();
  await page.keyboard.press("Delete");
  const removed = await circuit();
  expect(removed.wires.map((wire: { id: string }) => wire.id)).toEqual(["w3"]);
});
