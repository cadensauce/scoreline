// Profiles: the page (banner, stats, favourite sports/teams/players) and the editor. account.js (Firebase) is replaced
// by small fakes, so nothing touches the real database.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

async function setup(page, { stats = true } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.route(/\/account\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(({ stats }) => {
    localStorage.setItem("scoreline:tourDone", "true");
    const W = (window.__fake = { saved: [] });
    const card = { avatar: "", name: "Caden", bio: "Niners all day", theme: "field", show: "friends", title: "", banner: "", deco: "",
      sports: ["nfl"], favTeams: [{ lg: "nfl", id: "25", n: "San Francisco 49ers", a: "SF", l: "" }], favPlayers: [] };
    const pal = { ...card, name: "", bio: "", theme: "court", sports: [], favTeams: [], favPlayers: [{ lg: "nba", id: "1966", n: "LeBron James", t: "LAL", p: "SF" }] };
    window.scorelineProfile = {
      me: () => "me",
      load: async (uid) => (uid === "ghost" ? { uid, mine: false, isFriend: false, username: "ghost", joined: 0, card: null, stats: null }
        : uid && uid !== "me" ? { uid, mine: false, isFriend: true, username: "pal", joined: Date.now() - 9 * 864e5, card: pal, stats: stats ? { picks: { w: 7, l: 3, streak: 2, best: 4 }, fantasy: { n: 2, top3: 1 }, leagues: 1, friends: 4, marksEarned: 120, at: Date.now() } : null }
        : { uid: "me", mine: true, isFriend: false, username: "cadenbinglefry", joined: Date.now() - 45 * 864e5, card: JSON.parse(JSON.stringify(card)), stats: stats ? { picks: { w: 1, l: 0, streak: 1, best: 1 }, fantasy: { n: 0, top3: 0 }, leagues: 0, friends: 1, marksEarned: 10, at: Date.now() } : null, friends: 1 }),
      save: async (c) => { W.saved.push(c); },
      photo: async () => "",
      pool: async (lg) => (lg === "nfl" ? { "4361741": { n: "Brock Purdy", t: "SF", p: "QB" }, "3139477": { n: "Patrick Mahomes", t: "KC", p: "QB" } } : {}),
      owned: async () => new Set(), teen: async () => true,
      avatar: (src, name, size) => '<div class="avatar' + (size ? " " + size : "") + '">' + (name || "?")[0].toUpperCase() + "</div>",
    };
    window.scorelineSocial = { html: async () => '<div class="soc-me"><span class="soc-who" data-viewcard="me" role="button"><span><b>Caden</b></span></span><button class="pill-btn" type="button" data-editprofile>Edit profile</button></div><div class="panel"><div class="opt soc-row"><span class="soc-who" data-viewcard="pal" role="button"><span><b>@pal</b></span></span></div><div class="opt soc-row"><span class="soc-who" data-viewcard="ghost" role="button"><span><b>@ghost</b></span></span></div></div>' };
  }, { stats });
  await page.goto("index.html");
  await page.locator('[data-tab="social"]:visible').first().click();
  return errors;
}
const sheet = (page) => page.locator(".sheet.show").last();

test("profile: your page shows name, bio, stats and favourites", async ({ page }) => {
  const errors = await setup(page);
  await page.locator('#main [data-viewcard="me"]').click();
  const s = sheet(page);
  await expect(s.locator(".prof-id")).toContainText("Caden");
  await expect(s.locator(".prof-id")).toContainText("@cadenbinglefry");
  await expect(s).toContainText("Niners all day");
  await expect(s.locator(".prof-stat")).toHaveCount(9);
  await expect(s).toContainText("1–0");
  await expect(s.locator(".prof-sport")).toContainText("NFL");
  await expect(s.locator(".prof-tile")).toContainText("San Francisco 49ers");
  await expect(s.locator(".prof-banner")).toHaveClass(/t-field/);
  await expect(s.getByRole("button", { name: "Edit profile" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("profile: a friend's page has Message and their players; a private one says so", async ({ page }) => {
  const errors = await setup(page);
  await page.locator('#main [data-viewcard="pal"]').click();
  await expect(sheet(page).locator(".prof-tile")).toContainText("LeBron James");
  await expect(sheet(page).getByRole("button", { name: "Message" })).toBeVisible();
  await expect(sheet(page)).toContainText("7–3");
  await page.goBack(); await page.waitForTimeout(600);   // one sheet per tap: a second tap within half a second is ignored
  await page.locator('#main [data-viewcard="ghost"]').click();
  await expect(sheet(page)).toContainText("keeps their profile private");
  expect(errors).toEqual([]);
});

test("profile: no stats yet says so instead of showing zeros", async ({ page }) => {
  await setup(page, { stats: false });
  await page.locator('#main [data-viewcard="me"]').click();
  await expect(sheet(page)).toContainText("Your stats show up here after your first settled pick");
  await expect(sheet(page).locator(".prof-stat")).toHaveCount(0);
});

test("profile editor: change name, theme and sports, add a player, then save", async ({ page }) => {
  const errors = await setup(page);
  await page.locator("#main [data-editprofile]").click();
  const s = sheet(page);
  await s.locator("[data-pe-name]").fill("Caden P");
  await s.locator("[data-pe-bio]").fill("Purdy fan");
  await s.locator('[data-pe-theme="night"]').click();
  await s.locator('[data-pe-sport="nba"]').click();
  await s.locator('[data-pe-sport="nba"]').click();   // off again
  await s.locator('[data-pe-sport="f1"]').click();
  await s.locator("[data-pe-sport=\"f1\"]").click();
  await s.locator('[data-pe-sport="nfl"]').click();   // none chosen = search every sport
  await s.locator("[data-pe-q]").fill("purd");
  await s.locator('[data-pe-player="nfl|4361741"]').click();
  await expect(s.locator("[data-pe-unplayer]")).toContainText("Brock Purdy");
  await s.locator('[data-pe-show="me"]').click();
  await s.locator("[data-pe-save]").click();
  await expect.poll(() => page.evaluate(() => window.__fake.saved.length)).toBe(1);
  const out = await page.evaluate(() => window.__fake.saved[0]);
  expect(out).toMatchObject({ name: "Caden P", bio: "Purdy fan", theme: "night", show: "me", sports: [], banner: "", deco: "" });
  expect(out.favPlayers).toEqual([{ lg: "nfl", id: "4361741", n: "Brock Purdy", t: "SF", p: "QB" }]);
  expect(errors).toEqual([]);
});

for (const w of [320, 375, 430]) {
  test("profile and editor fit a " + w + " px phone", async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    await setup(page);
    const over = () => page.evaluate(() => { const b = document.querySelector(".sheet.show:last-of-type .sheet-body") || document.querySelector(".sheet.show .sheet-body"); return b ? b.scrollWidth > b.clientWidth + 1 : true; });
    await page.locator('#main [data-viewcard="me"]').click();
    await page.waitForTimeout(500);
    expect(await over()).toBe(false);
    await page.goBack(); await page.waitForTimeout(400);
    await page.locator("#main [data-editprofile]").click();
    await page.waitForTimeout(500);
    expect(await over()).toBe(false);
  });
}
