// Speed measurements on a mid-range phone profile (4x slower CPU, "fast 4G" network).
// Runs against this commit (local server) and against the live site, so every run gives a before/after pair.
// Results go to the console and to perf-results.json; they inform PROGRESS.md, they don't fail the build.
const { test } = require("@playwright/test");
const fs = require("fs");

const TARGETS = { thisCommit: "http://127.0.0.1:8080/index.html", liveSite: "https://cadensauce.github.io/scoreline/" };
const results = {};

async function phone(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8 * 4, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let bytes = 0, logoBytes = 0, requests = 0;
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; requests++; });
  cdp.on("Network.responseReceived", (e) => { if (/teamlogos/.test(e.response.url)) logoBytes += e.response.encodedDataLength || 0; });
  return { totals: () => ({ kb: Math.round(bytes / 1024), requests }) };
}

for (const [name, url] of Object.entries(TARGETS)) {
  test(`speed: ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    const net = await phone(page);
    const t0 = Date.now();
    await page.goto(url);
    await page.locator("[data-ev]").first().waitFor({ timeout: 60000 });
    const firstScoresMs = Date.now() - t0;
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    const load = net.totals();

    // Second open: saved scores should appear before the network answers.
    const t1 = Date.now();
    await page.reload();
    await page.locator("[data-ev]").first().waitFor({ timeout: 60000 });
    const reopenScoresMs = Date.now() - t1;

    const tabs = {};
    for (const tab of ["nfl", "cfb", "nba", "home"]) {
      const t = Date.now();
      await page.locator(`[data-tab="${tab}"]:visible`).first().click();
      await page.waitForFunction((k) => window.state?.tab === k || document.querySelector("#main [data-ev]"), tab).catch(() => {});
      await page.locator("#main [data-ev]").first().waitFor({ timeout: 30000 }).catch(() => {});
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
    results[name] = { firstScoresMs, reopenScoresMs, downloadKB: load.kb, requests: load.requests, tabSwitchMs: tabs, scroll: frames, ...vitals };
    console.log("PERF", name, JSON.stringify(results[name]));
    fs.writeFileSync("perf-results.json", JSON.stringify(results, null, 2));
  });
}
