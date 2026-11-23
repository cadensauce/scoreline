// Fantasy, Season leagues and the Social tab. The real page runs as on a phone; account.js (Firebase) is replaced by
// small fakes, so nothing touches the real database. Checks: the tutorial prompt, the Marks Fantasy lock (and that it
// can't be skipped), a Free lineup, a league from creation through the draft, and the Social tab.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

// who: { signedIn, teen } as the Terms agreement status (teen: true = agreed, null = not yet, false = said under 13)
async function setup(page, who = { signedIn: true, teen: true }, { tutDone = true } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.route(/\/account\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(({ who, tutDone }) => {
    localStorage.setItem("scoreline:tourDone", "true");
    if (tutDone) localStorage.setItem("scoreline:fxTutDone", "true"); else localStorage.removeItem("scoreline:fxTutDone");
    const W = (window.__fake = { who, saved: [], starters: [] });
    const T = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
    window.scorelinePicks = {
      status: async () => (W.who.signedIn ? { signedIn: true, teen: W.who.teen } : { signedIn: false }),
      setAge: async () => { W.who.teen = true; }, balance: async () => 0, mine: async () => [], upcoming: async () => [],
      shopItems: async () => [], owned: async () => new Set(), equipped: () => ({}), isDev: async () => false,
    };
    const pool = { q1: { n: "QB One", t: "AAA", p: "QB" }, q2: { n: "QB Two", t: "BBB", p: "QB" }, r1: { n: "RB One", t: "AAA", p: "RB" }, r2: { n: "RB Two", t: "BBB", p: "RB" },
      w1: { n: "WR One", t: "AAA", p: "WR" }, w2: { n: "WR Two", t: "BBB", p: "WR" }, t1: { n: "TE One", t: "AAA", p: "TE" } };
    const contest = { id: "nfl_w_x", lg: "nfl", fmt: "w", label: "Week 99", lockAt: T(Date.now() + 864e5), slots: ["qb:QB", "rb1:RB", "rb2:RB", "wr1:WR", "wr2:WR", "te:TE"], pool, status: "open" };
    window.scorelineFantasy = {
      board: async (lg, fmt) => (lg === "nfl" && fmt === "w" ? [{ id: "nfl_w_x", label: "Week 99", lockAt: contest.lockAt, status: "open" }] : []),
      contest: async () => contest, mine: async () => null, save: async (c, m, l) => { W.saved.push({ c, m, l }); }, clear: async () => {}, friends: async () => [],
    };
    const drivers = {}; for (let i = 0; i < 8; i++) drivers["d" + i] = { n: "Driver " + i, t: "T" + i, p: "D" };
    let L = null, cb = null; const push = () => setTimeout(() => cb && cb(JSON.parse(JSON.stringify(L))), 20);
    window.scorelineLeagues = {
      me: () => "me", name: async (u) => u, friendsList: async () => [{ uid: "pal", name: "pal" }],
      mine: async () => ({ leagues: L ? [L] : [], invites: [] }),
      create: async (o) => { L = { id: "L1", owner: "me", members: ["me", "pal"], invites: [], status: "forming", rosterSize: 3, ...o }; return "L1"; },
      watch: (id, f) => { cb = f; push(); return () => { cb = null; }; },
      invite: async () => {}, join: async () => {}, leave: async () => {}, remove: async () => {},
      start: async () => { Object.assign(L, { status: "drafting", order: ["pal", "me"], pick: 0, taken: {} }); push(); },
      pick: async (l, who, pid) => { L.pick++; L.taken[pid] = who; L.last = { uid: who, pid }; if (L.pick === 6) Object.assign(L, { status: "active", totals: { me: 30, pal: 12 } }); push(); },
      pool: async () => drivers, starters: async () => ({}), saveStarters: async (id, lu) => { W.starters.push(lu); },
    };
    window.scorelineSocial = { html: async () => (W.who.signedIn
      ? '<div class="section-title"><b>Add a friend</b></div><form class="acct-add" data-addf><input placeholder="Their username"><button class="pill-btn" type="submit">Add</button></form><div class="section-title"><b>Friends</b></div><div class="panel"><div class="opt"><span><b>@pal</b></span><span class="acct-acts"><button class="pill-btn" type="button" data-chat="pal">Message</button><button class="pill-btn" type="button" data-viewcard="pal">Profile</button><button class="pill-btn" type="button" data-unfriend="pal">✕</button></span></div></div>'
      : '<div class="panel"><b>Friends and messages</b><p class="muted">Sign in to add friends, see requests and message your friends.</p></div>') };
  }, { who, tutDone });
  await page.goto("index.html");
  return errors;
}
const tab = (page, k) => page.locator(`[data-tab="${k}"]:visible`).first().click();
const main = (page) => page.locator("#main");

test("fantasy: first visit asks if you know how to play; the tutorial covers both modes and says Marks are NOT real money", async ({ page }) => {
  const errors = await setup(page, { signedIn: true, teen: true }, { tutDone: false });
  await tab(page, "fantasy");
  await expect(main(page)).toContainText("Do you know how to play fantasy?");
  await expect(page.getByRole("button", { name: "Yeah, skip the tutorial." })).toBeVisible();
  await page.getByRole("button", { name: "No, Show me how to play!" }).click();
  const seen = [];
  for (let i = 0; i < 7; i++) { seen.push(await page.locator(".fx-tut > b").textContent()); await page.locator('[data-fx-step="1"]').click(); }
  expect(seen).toEqual(expect.arrayContaining(["Free Fantasy", "Marks Fantasy", "Important"]));
  await expect(page.locator('[data-fx-mode="free"]')).toBeVisible();
  await expect(main(page)).toContainText("Marks are NOT real money");
  expect(errors).toEqual([]);
});

for (const [who, why] of [[{ signedIn: true, teen: null }, "Agree to the Terms of Service first"], [{ signedIn: true, teen: false }, "Only for ages 13 and up"], [{ signedIn: false }, "Sign in first"]]) {
  test("fantasy: Marks Fantasy stays locked (" + why + ") and Free Fantasy still opens", async ({ page }) => {
    const errors = await setup(page, who);
    await tab(page, "fantasy");
    for (let i = 0; i < 2; i++) {   // trying again doesn't get around it
      await page.locator('[data-fx-mode="marks"]').first().click();
      await expect(main(page)).toContainText(why);
      await expect(page.locator("[data-fx-fmt]")).toHaveCount(0);
      await page.locator('[data-fx-back="mode"]').click();
    }
    await page.locator('[data-fx-mode="free"]').click();
    await expect(page.locator("[data-fx-fmt]")).toHaveCount(3);
    expect(errors).toEqual([]);
  });
}

test("fantasy: agreeing to the Terms opens Marks Fantasy", async ({ page }) => {
  await setup(page, { signedIn: true, teen: null });
  await tab(page, "fantasy");
  await page.locator('[data-fx-mode="marks"]').first().click();
  await page.locator("[data-fx-agree]").click();
  await expect(page.locator("[data-fx-fmt]")).toHaveCount(3);
  await expect(main(page)).toContainText("Marks Fantasy");
});

test("fantasy: build and save a Free weekly lineup (no Marks)", async ({ page }) => {
  const errors = await setup(page);
  await tab(page, "fantasy");
  await page.locator('[data-fx-mode="free"]').click();
  await page.locator('[data-fx-fmt="w"]').click();
  await page.locator('[data-fx-lg="nfl"]').click();
  await page.locator('[data-fx-cid="nfl_w_x"]').click();
  await page.locator('[data-fx-slot="qb"]').click();
  await page.locator('[data-fx-player="q2"]').click();
  await page.locator('[data-fx-slot="rb1"]').click();
  await page.locator('[data-fx-player="r1"]').click();
  await page.locator("[data-fx-save]").click();
  await expect.poll(() => page.evaluate(() => window.__fake.saved)).toEqual([{ c: "nfl_w_x", m: "free", l: { qb: "q2", rb1: "r1" } }]);
  await expect(main(page)).toContainText("no Marks or any other currency");
  expect(errors).toEqual([]);
});

test("season league: create, start the draft, draft in turns, then standings and starters", async ({ page }) => {
  const errors = await setup(page);
  await tab(page, "fantasy");
  await page.locator('[data-fx-mode="free"]').click();
  await page.locator('[data-fx-fmt="s"]').click();
  await page.locator("[data-lg-new]").click();
  await page.locator("[data-lg-name]").fill("Test League");
  await page.locator('[data-lg-sport="f1"]').click();
  await page.locator("[data-lg-name]").fill("Test League");
  await page.locator("[data-lg-create]").click();
  await expect(main(page)).toContainText("Test League");
  await page.locator("[data-lg-start]").click();
  await expect(main(page)).toContainText("On the clock");
  for (let i = 0; i < 6; i++) { await page.locator("[data-lg-pick]").first().click(); await page.waitForTimeout(150); }
  await expect(main(page)).toContainText("Standings");
  await page.locator('[data-lg-slot="d1"]').click();
  await page.locator("[data-lg-player]").first().click();
  await page.locator("[data-lg-save]").click();
  await expect.poll(() => page.evaluate(() => window.__fake.starters.length)).toBe(1);
  expect(errors).toEqual([]);
});

test("you tab: friends with Message and Profile (Social is part of You); signed out asks to sign in", async ({ page }) => {
  const errors = await setup(page);
  await tab(page, "you");
  await expect(page.locator("#main [data-addf]")).toBeVisible();
  await expect(page.locator('#main [data-chat="pal"]')).toBeVisible();
  await page.evaluate(() => { window.__fake.who.signedIn = false; });
  await tab(page, "home"); await tab(page, "you");
  await expect(main(page)).toContainText("Sign in to add friends");
  expect(errors).toEqual([]);
});

test("fantasy and social fit a 320 px phone with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page);
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await tab(page, "fantasy"); await page.waitForTimeout(600);
  expect(await wide()).toBe(false);
  await page.locator('[data-fx-mode="free"]').click(); await page.locator('[data-fx-fmt="w"]').click(); await page.locator('[data-fx-lg="nfl"]').click();
  await page.locator('[data-fx-cid="nfl_w_x"]').click(); await page.locator('[data-fx-slot="qb"]').click(); await page.waitForTimeout(600);
  expect(await wide()).toBe(false);
  await tab(page, "you"); await page.waitForTimeout(900);
  expect(await wide()).toBe(false);
});
