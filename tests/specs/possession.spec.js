// Possession on score rows: a live football row shows the ball next to the team that has it, plus the down.
const { test, expect } = require("@playwright/test");

test("live football row shows possession, down and red zone", async ({ page }) => {
  await page.goto("index.html");
  const html = await page.evaluate(() => gameCard({
    id: "1", date: new Date().toISOString(),
    status: { type: { state: "in", shortDetail: "5:13 - 4th" } },
    competitions: [{
      situation: { possession: "22", shortDownDistanceText: "2nd & 7", isRedZone: true },
      competitors: [
        { homeAway: "away", score: "17", team: { id: "21", shortDisplayName: "Eagles", abbreviation: "PHI" } },
        { homeAway: "home", score: "20", team: { id: "22", shortDisplayName: "Cowboys", abbreviation: "DAL" } },
      ],
    }],
  }, "nfl", 0));
  const box = await page.evaluate((h) => { const d = document.createElement("div"); d.innerHTML = h; return { rows: [...d.querySelectorAll(".team")].map((r) => ({ name: r.querySelector("strong").textContent, ball: !!r.querySelector(".poss") })), sit: d.querySelector(".sit-mini")?.textContent }; }, html);
  expect(box.rows).toEqual([{ name: "Eagles", ball: false }, { name: "Cowboys", ball: true }]);
  expect(box.sit).toBe("2nd & 7 · Red zone");
});

test("a finished game shows no possession", async ({ page }) => {
  await page.goto("index.html");
  const html = await page.evaluate(() => gameCard({ id: "2", date: new Date().toISOString(), status: { type: { state: "post", shortDetail: "Final" } },
    competitions: [{ situation: { possession: "22" }, competitors: [{ homeAway: "away", score: "17", team: { id: "21", shortDisplayName: "Eagles" } }, { homeAway: "home", score: "20", team: { id: "22", shortDisplayName: "Cowboys" } }] }] }, "nfl", 0));
  expect(html).not.toContain('class="poss"');
});