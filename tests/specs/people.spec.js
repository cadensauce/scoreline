// Find people (top bar): search usernames, see who is a friend, send a request, and get a clear answer.
// account.js (Firebase) is replaced by a small fake, so nothing touches the real database.
const { test, expect } = require("@playwright/test");
const { espnViaRunner } = require("./helpers");

async function setup(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await espnViaRunner(page);
  await page.route(/\/account\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.addInitScript(() => {
    localStorage.setItem("scoreline:tourDone", "true");
    const people = [
      { username: "cadenbinglefry", uid: "me", rel: "me", name: "Caden" },
      { username: "cadenbinglenut", uid: "u2", rel: "" },
      { username: "cadenpal", uid: "u3", rel: "friend", name: "Pal" },
    ];
    window.__adds = [];
    window.scorelineSocial = {
      signedIn: () => true,
      find: async (q) => people.filter((p) => p.username.startsWith(q.replace(/^@/, ""))).map((p) => ({ ...p, avatar: "", deco: "" })),
      add: async (n) => { window.__adds.push(n); if (n === "cadenbinglenut") return "Friend request sent to @" + n; throw new Error("No account called @" + n + "."); },
      avatar: (src, name) => '<div class="avatar">' + (name || "?")[0].toUpperCase() + "</div>",
      html: async () => "",
    };
  });
  await page.goto("index.html");
  return errors;
}
const sheet = (page) => page.locator(".sheet.show").last();

test("find people: search, add, and say it was sent", async ({ page }) => {
  const errors = await setup(page);
  await page.locator("#peopleBtn").click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText("Find people");
  await sheet(page).locator("[data-people-q]").fill("@caden");
  await expect(sheet(page).locator(".soc-row")).toHaveCount(3);
  await expect(sheet(page).locator(".soc-row").nth(0)).toContainText("You");
  await expect(sheet(page).locator(".soc-row").nth(2)).toContainText("Friends");
  await sheet(page).locator('[data-people-add="cadenbinglenut"]').click();
  await expect(sheet(page).locator("[data-err]")).toHaveText("Friend request sent to @cadenbinglenut");
  await expect(sheet(page).locator(".soc-row").nth(1)).toContainText("Sent");
  expect(await page.evaluate(() => window.__adds)).toEqual(["cadenbinglenut"]);
  expect(errors).toEqual([]);
});

test("find people: no match says there's no account", async ({ page }) => {
  await setup(page);
  await page.locator("#peopleBtn").click();
  await sheet(page).locator("[data-people-q]").fill("zzzz");
  await expect(sheet(page).locator("[data-people-res]")).toContainText("No account called @zzzz.");
});

for (const w of [320, 375, 430]) {
  test("find people button and page fit a " + w + " px phone", async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    await setup(page);
    await expect(page.locator("#peopleBtn")).toBeVisible();
    await page.locator("#peopleBtn").click();
    await sheet(page).locator("[data-people-q]").fill("caden");
    await expect(sheet(page).locator(".soc-row")).toHaveCount(3);
    const over = await page.evaluate(() => { const b = [...document.querySelectorAll(".sheet.show .sheet-body")].pop(); return b.scrollWidth > b.clientWidth + 1; });
    expect(over).toBe(false);
  });
}
