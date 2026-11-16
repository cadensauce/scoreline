// Screenshots of the main screens at phone and desktop size, with real data, for design review.
// Saved to tests/screens/*.png and uploaded by the workflow as the "screens" artifact.
const { test } = require("@playwright/test");
const { espnViaRunner, goTab } = require("./helpers");

const SIZES = { mobile: { width: 375, height: 812 }, web: { width: 1280, height: 800 } };

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`screens: ${size}`, async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: size === "mobile", hasTouch: size === "mobile", userAgent: size === "mobile" ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36" : undefined });
    const page = await context.newPage();
    if (size === "mobile") await page.addInitScript(() => { window.__PREVIEW_APP = 1; });
    await espnViaRunner(page);
    await page.goto("index.html");
    await page.locator("#main [data-ev]").first().waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(1500);
    const shot = (name) => page.screenshot({ path: `screens/${name}-${size}.png` });
    await shot("home");
    for (const tab of ["nfl", "cfb", "nba", "f1"]) {
      await goTab(page, tab);
      await page.waitForTimeout(2500);
      await shot(tab);
    }
    await page.locator('[data-tab="nfl"]:visible').first().click();
    await page.waitForTimeout(2000);
    const card = page.locator("#main [data-ev]").first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(4000);
      await shot("game");
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(800);
      await shot("game-lower");
      await page.keyboard.press("Escape");
    }
    if (size === "mobile") {
      await page.waitForTimeout(800);   // let the game sheet finish closing
      await page.locator('[data-tab="you"]:visible').first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await shot("you");
    }
    // Light theme: the same main screens.
    await page.evaluate(() => localStorage.setItem("scoreline:theme", JSON.stringify("light")));
    await page.reload();
    await page.locator("#main [data-ev]").first().waitFor({ state: "attached", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator('[data-tab="home"]:visible').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot("light-home");
    const lcard = page.locator("#main [data-ev]").first();
    if (await lcard.count()) { await lcard.click(); await page.waitForTimeout(3500); await shot("light-game"); await page.keyboard.press("Escape"); await page.waitForTimeout(800); }
    if (size === "mobile") { await page.locator('[data-tab="you"]:visible').first().click({ timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1200); await shot("light-you"); }
    await context.close();
  });
}
