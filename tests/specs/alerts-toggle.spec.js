// Regression test for item 15: alerts could be turned on but not properly turned off.
// Runs the site as the Android app would (phone mode + a fake native push bridge) and watches what it
// sends to the alert server (Firestore REST), which is intercepted here; nothing reaches the real database.
const { test, expect } = require("@playwright/test");

const SUBS = /firestore\.googleapis\.com\/.*\/documents\/pushSubs\/([0-9a-f]{64})/;

async function setup(page, context, { deleteFails = false } = {}) {
  await context.grantPermissions(["notifications"]);
  // Act like the installed Android app: Tauri's notification + app APIs and the native push bridge.
  await page.addInitScript(() => {
    window.__TAURI__ = {
      notification: { isPermissionGranted: async () => true, requestPermission: async () => "granted", sendNotification() {} },
      app: { getVersion: async () => "1.0.99" },
      opener: { openUrl: async () => {} },
    };
    window.ScorelineNative = { pushToken: () => "test-token-123", pushError: () => "" };
  });
  await page.route(/api\.github\.com/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  const calls = [];
  await page.route(/firestore\.googleapis\.com/, async (route) => {
    const req = route.request(), m = req.url().match(SUBS);
    if (m) calls.push({ method: req.method(), id: m[1] });
    if (m && req.method() === "DELETE" && deleteFails) return route.abort();
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return calls;
}

const master = (page) => page.locator("#alertsMaster");
async function openAlerts(page) {
  await page.goto("index.html");
  await page.locator('[data-tab="you"]:visible').first().click();
  await page.locator("[data-open-notifs]").click();   // the alert switches live on You → Notifications
  await expect(master(page)).toBeVisible();
}

test("turning alerts off really turns them off, and the switch shows it", async ({ page, context }) => {
  const calls = await setup(page, context);
  await openAlerts(page);
  await expect(master(page)).not.toHaveClass(/\bon\b/);

  await master(page).click();
  await expect(master(page)).toHaveClass(/\bon\b/);
  await expect.poll(() => calls.filter((c) => c.method === "PATCH").length).toBeGreaterThan(0);
  const id = calls.find((c) => c.method === "PATCH").id;

  await master(page).click();
  await expect(master(page)).not.toHaveClass(/\bon\b/);                 // the bug: this used to stay "on"
  await expect.poll(() => calls.some((c) => c.method === "DELETE" && c.id === id)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("scoreline:alerts"))).toBe("false");

  // Survives a reload: still off, and nothing re-subscribes.
  const before = calls.length;
  await page.reload();
  await page.locator('[data-tab="you"]:visible').first().click();
  await page.locator("[data-open-notifs]").click();   // the alert switches live on You → Notifications
  await expect(master(page)).not.toHaveClass(/\bon\b/);
  await page.waitForTimeout(1500);
  expect(calls.slice(before).some((c) => c.method === "PATCH")).toBe(false);
});

test("alerts that are on stay on after a reload, under the same device id", async ({ page, context }) => {
  const calls = await setup(page, context);
  await openAlerts(page);
  await master(page).click();
  await expect.poll(() => calls.filter((c) => c.method === "PATCH").length).toBeGreaterThan(0);
  const id = calls.find((c) => c.method === "PATCH").id;

  await page.reload();
  await page.locator('[data-tab="you"]:visible').first().click();
  await page.locator("[data-open-notifs]").click();   // the alert switches live on You → Notifications
  await expect(master(page)).toHaveClass(/\bon\b/);
  await expect.poll(() => calls.filter((c) => c.method === "PATCH" && c.id === id).length).toBeGreaterThan(1);
});

test("a turn-off that couldn't reach the server is finished on the next launch", async ({ page, context }) => {
  const calls = await setup(page, context, { deleteFails: true });
  await openAlerts(page);
  await master(page).click();
  await expect.poll(() => calls.filter((c) => c.method === "PATCH").length).toBeGreaterThan(0);
  const id = calls.find((c) => c.method === "PATCH").id;
  await master(page).click();
  await expect(master(page)).not.toHaveClass(/\bon\b/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("scoreline:pushOffPending"))).toBe("true");

  // Next launch with a working connection: the leftover entry is removed.
  await page.unroute(/firestore\.googleapis\.com/);
  const after = [];
  await page.route(/firestore\.googleapis\.com/, (route) => { const m = route.request().url().match(SUBS); if (m) after.push({ method: route.request().method(), id: m[1] }); return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.reload();
  await expect.poll(() => after.some((c) => c.method === "DELETE" && c.id === id)).toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("scoreline:pushOffPending"))).toBe("false");
});
