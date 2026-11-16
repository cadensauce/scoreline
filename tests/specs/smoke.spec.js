// Smoke test: every tab opens without script errors, and real scores show up.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

test("every tab loads scores without script errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.goto("index.html");
  await page.locator("#main [data-ev]").first().waitFor({ state: "attached", timeout: 30000 });
  for (const tab of ["nfl", "cfb", "f1", "home"]) {
    await page.locator(`[data-tab="${tab}"]:visible`).first().click();
    await expect(page.locator("#main")).not.toBeEmpty();
    await page.waitForTimeout(1200);
    await expect(page.locator("#main .error")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
