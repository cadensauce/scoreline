// Smoke test: every tab opens without script errors.
const { test, expect } = require("@playwright/test");

test("every tab loads without script errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("index.html");
  for (const tab of ["home", "nfl", "cfb", "f1", "nba", "mlb"]) {
    await page.locator(`[data-tab="${tab}"]:visible`).first().click();
    await expect(page.locator("#main")).not.toBeEmpty();
    await page.waitForTimeout(800);
  }
  expect(errors).toEqual([]);
});
