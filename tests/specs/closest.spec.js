// Closest Games: live games sorted by closeness, then upcoming by most even matchup, then finished.
const { test, expect } = require("@playwright/test");

test("Closest Games orders live, then upcoming, then finished", async ({ page }) => {
  await page.goto("index.html");
  const order = await page.evaluate(async () => {
    await window.ScorelineWP.ready("nfl");
    const g = (id, state, a, h, prob, aid = "1", hid = "2") => ({ id, status: { type: { state }, period: 4, displayClock: "5:00" },
      competitions: [{ situation: prob == null ? {} : { lastPlay: { probability: { homeWinPercentage: prob } } },
        competitors: [{ homeAway: "away", score: String(a), team: { id: aid } }, { homeAway: "home", score: String(h), team: { id: hid } }] }] });
    const evs = [g("final", "post", 10, 30), g("blowout", "in", 0, 28, 0.99), g("tossup", "in", 21, 20, 0.52), g("soon", "pre", 0, 0)];
    state.filters = new Set(["close"]);
    return applyFilter(evs, "nfl").map((e) => e.id);
  });
  expect(order).toEqual(["tossup", "blowout", "soon", "final"]);
});