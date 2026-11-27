// Ideas page: list sorted by votes, vote, post. account.js is faked; the rules are tested in tests/rules/ideas.test.mjs.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

test("ideas: top first, vote changes the count, post an idea", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.route(/\/account\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(() => {
    localStorage.setItem("scoreline:tourDone", "true");
    const rows = [{ id: "a", text: "Add darts", name: "", at: Date.now() - 6e5, status: "open", up: 2, down: 0, mine: 0 }, { id: "b", text: "Bigger text", name: "pal", at: Date.now(), status: "open", up: 9, down: 1, mine: 0 }];
    window.__posted = [];
    window.scorelineIdeas = {
      ready: async () => true, role: async () => "", list: async () => rows.map((x) => ({ ...x })), mineIds: async () => [],
      vote: async (id, v) => { const r = rows.find((x) => x.id === id); r.up += v === 1 ? 1 : 0; r.down += v === -1 ? 1 : 0; return { up: r.up, down: r.down, mine: v }; },
      post: async (text, o) => { window.__posted.push({ text, ...o }); return "c"; },
    };
  });
  await page.goto("index.html");
  await page.evaluate(() => openIdeas());
  const sheet = page.locator(".sheet.show").last();
  await expect(sheet.locator(".idea").first()).toContainText("Bigger text");
  await sheet.locator('.idea[data-idea="a"] [data-idea-vote="1"]').click();
  await expect(sheet.locator('.idea[data-idea="a"] [data-idea-vote="1"]')).toContainText("3");
  await sheet.locator("[data-idea-text]").fill("Add ping pong");
  await sheet.locator("[data-idea-priv]").check();
  await sheet.locator("[data-idea-form] button[type=submit]").click();
  await expect.poll(() => page.evaluate(() => window.__posted.length)).toBe(1);
  expect(await page.evaluate(() => window.__posted[0])).toMatchObject({ text: "Add ping pong", priv: true });
  expect(errors).toEqual([]);
});
