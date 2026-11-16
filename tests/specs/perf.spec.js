// Speed measurements on a mid-range phone profile (4x slower CPU, "fast 4G" network).
// Runs against this commit (local server) and against the live site, so every run gives a before/after pair.
// Results go to the console and to perf-results.json; they inform PROGRESS.md, they don't fail the build.
const { test } = require("@playwright/test");
const fs = require("fs");
const { espnViaRunner } = require("./helpers");

const TARGETS = { thisCommit: "http://127.0.0.1:8080/index.html", liveSite: "https://cadensauce.github.io/scoreline/" };
const results = {};

// Mid-range phone: CPU 4x slower than the runner; ESPN data and logos arrive at "fast 4G" speed
// (150 ms + ~1.1 MB/s, applied by espnViaRunner since ESPN must be fetched on the runner side).
async function phone(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const stats = await espnViaRunner(page, { latencyMs: 150, bytesPerMs: 1100 });
  return { totals: () => ({ kb: Math.round(stats.bytes / 1024), logoKB: Math.round(stats.logoBytes / 1024), requests: stats.requests }) };
}

for (const [name, url] of Object.entries(TARGETS)) {
  test(`speed: ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    const net = await phone(page);
    page.on("pageerror", (e) => console.log("PAGEERROR", name, e.message));
    page.on("requestfailed", (r) => console.log("REQFAIL", name, r.url().slice(0, 100), r.failure()?.errorText));
    const t0 = Date.now();
    await page.goto(url);
    try { await page.locator("[data-ev]").first().waitFor({ state: "attached", timeout: 60000 }); }
    catch (e) { console.log("NOSCORES", name, (await page.evaluate(() => document.querySelector("#main")?.innerText.slice(0, 400))).replace(/\s+/g, " ")); throw e; }
    const firstScoresMs = Date.now() - t0;
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const load = net.totals();

    // Second open: saved scores should appear before the network answers.
    const t1 = Date.now();
    await page.reload();
    await page.locator("[data-ev]").first().waitFor({ state: "attached", timeout: 60000 });
    const reopenScoresMs = Date.now() - t1;

    const tabs = {};
    for (const tab of ["nfl", "cfb", "nba", "home"]) {
      const t = Date.now();
      await page.locator(`[data-tab="${tab}"]:visible`).first().click();
      // Done when the new tab's own games are on screen (not the previous tab's).
      await page.waitForFunction((k) => k === "home" ? document.querySelector("#main [data-home] [data-ev]") : document.querySelector('#main [data-lg="' + k + '"][data-ev], #main [data-ev][data-lg="' + k + '"]') || document.querySelector("#main .empty"), tab, { timeout: 30000 }).catch(() => {});
      tabs[tab] = Date.now() - t;
    }
    // Scroll the long college list and count slow frames.
    await page.locator('[data-tab="cfb"]:visible').first().click();
    await page.waitForTimeout(3000);
    const frames = await page.evaluate(async () => {
      let n = 0, slow = 0, last = performance.now(), run = true;
      const loop = (t) => { if (!run) return; if (t - last > 34) slow++; n++; last = t; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      for (let y = 0; y < 5000; y += 60) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(r)); }
      run = false; return { frames: n, slowFrames: slow };
    });
    const vitals = await page.evaluate(() => new Promise((res) => {
      let lcp = 0, cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      setTimeout(() => res({ lcpMs: Math.round(lcp), cls: +cls.toFixed(3), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }), 500);
    }));
    results[name] = { firstScoresMs, reopenScoresMs, downloadKB: load.kb, logoKB: load.logoKB, requests: load.requests, tabSwitchMs: tabs, scroll: frames, ...vitals };
    console.log("PERF", name, JSON.stringify(results[name]));
    fs.writeFileSync("perf-results.json", JSON.stringify(results, null, 2));
  });
}
