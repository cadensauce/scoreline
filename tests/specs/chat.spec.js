// Chat entry points on the page: the top-bar Chats button + unread badge, and Share on a game page.
// account.js (Firebase) is replaced by a small fake; the chat rules themselves are tested in tests/rules/chat.test.mjs.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

async function setup(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.route(/\/account\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(() => {
    localStorage.setItem("scoreline:tourDone", "true");
    window.__chat = { opened: 0, shared: [] };
    window.scorelineChat = { openList: () => { window.__chat.opened++; }, share: (s) => { window.__chat.shared.push(s); }, unread: () => 0, openFriends: () => {} };
  });
  await page.goto("index.html");
  return errors;
}

test("chats button opens chats and shows the unread count", async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("scoreline-chats", { detail: { unread: 3 } })));
  await expect(page.locator("#chatBtn")).toHaveAttribute("data-count", "3");
  await page.locator("#chatBtn").click();
  expect(await page.evaluate(() => window.__chat.opened)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("scoreline-chats", { detail: { unread: 0 } })));
  await expect(page.locator("#chatBtn")).toHaveAttribute("data-count", "");
  expect(errors).toEqual([]);
});

test("share a game into a chat", async ({ page }) => {
  const errors = await setup(page);
  await page.locator("#main [data-ev]").first().click();
  const sheet = page.locator(".sheet.show").last();
  await expect(sheet.locator("[data-sheetshare]")).toBeVisible();
  await expect(sheet.locator(".sheet-title")).not.toHaveText("");
  await sheet.locator("[data-sheetshare]").click();
  const s = await page.evaluate(() => window.__chat.shared[0]);
  expect(s.k).toBe("game");
  expect(s.id).toBeTruthy();
  expect(s.t.length).toBeGreaterThan(0);
  expect(s.t.length).toBeLessThanOrEqual(80);
  expect(errors).toEqual([]);
});

for (const w of [320, 375, 430]) {
  test("top bar buttons don't overlap on a " + w + " px phone", async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    await setup(page);
    const boxes = await page.evaluate(() => [...document.querySelectorAll("header .brand, header #marksChip, .top-right > *")]
      .filter((x) => x.offsetParent && x.getBoundingClientRect().width > 1).map((x) => { const r = x.getBoundingClientRect(); return [x.id || x.className, r.left, r.right]; }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, al, ar] = boxes[i], [b, bl, br] = boxes[j];
      expect(al < br - 1 && bl < ar - 1, a + " overlaps " + b).toBe(false);
    }
  });
}
