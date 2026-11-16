// Win probability: our NBA model loads in the browser and behaves sensibly; NBA game pages label it as ours.
const { test, expect } = require("@playwright/test");
const { espnViaRunner, goTab } = require("./helpers");

test("NBA model gives sensible numbers", async ({ page }) => {
  await page.goto("index.html");
  const r = await page.evaluate(async () => {
    await window.ScorelineWP.ready("nba");
    const W = window.ScorelineWP;
    const even = W.nba({ homeScore: 50, awayScore: 50, period: 3, clock: "6:00", possession: null, pregameHomeWP: 0.5 });
    const upBig = W.nba({ homeScore: 110, awayScore: 90, period: 4, clock: "1:00", possession: "home", pregameHomeWP: 0.5 });
    const downBig = W.nba({ homeScore: 90, awayScore: 110, period: 4, clock: "1:00", possession: "away", pregameHomeWP: 0.5 });
    const missing = W.nba({ homeScore: 50 });
    return { even, upBig, downBig, missing };
  });
  expect(r.even).toBeGreaterThan(0.35); expect(r.even).toBeLessThan(0.7);
  expect(r.upBig).toBeGreaterThan(0.97);
  expect(r.downBig).toBeLessThan(0.03);
  expect(r.missing).toBeNull();
});

test("an NBA game page shows Scoreline win probability", async ({ page }) => {
  await espnViaRunner(page);
  await page.goto("index.html");
  await page.locator("#main [data-ev]").first().waitFor({ state: "attached", timeout: 30000 });
  await goTab(page, "nba");
  const card = page.locator('#main [data-ev][data-lg="nba"]').filter({ hasText: /final|q\d|\d:\d\d/i }).first();
  test.skip(!(await card.count()), "no started NBA game in today's data");
  await card.click();
  const sec = page.locator("[data-wpsec]").first();
  await expect(sec).toBeVisible({ timeout: 20000 });
  await expect(sec).toContainText(/Scoreline win probability|ESPN win probability/);
  await expect(sec).toContainText("Scoreline win probability", { timeout: 15000 });
});
