// Win probability: our NBA model loads in the browser and behaves sensibly; NBA game pages label it as ours.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

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
  // A finished game from the last few days (so the test doesn't depend on today's schedule).
  let id = null;
  for (let d = 1; d <= 4 && !id; d++) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const sb = await (await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=" + day)).json();
    id = (sb.events || []).find((e) => e.status?.type?.state === "post")?.id || null;
  }
  test.skip(!id, "no finished NBA game in the last 4 days");
  await page.evaluate((gid) => openGame("nba", gid), id);
  const sec = page.locator("[data-wpsec]").first();
  await expect(sec).toBeVisible({ timeout: 20000 });
  await expect(sec).toContainText(/Scoreline win probability|ESPN win probability/);
  await expect(sec).toContainText("Scoreline win probability", { timeout: 15000 });
});
