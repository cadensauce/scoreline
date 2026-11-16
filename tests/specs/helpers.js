// ESPN refuses browser requests from GitHub's servers (bot protection) but answers plain Node requests
// (the push worker polls it the same way). So tests fetch ESPN data and logos with Node and hand them to the
// page; the app itself behaves exactly as on a phone. Returns a counter of bytes passed to the page.
// With `net` ({ latencyMs, bytesPerMs }), each response is held back as a phone network would
// (e.g. fast 4G: 150 ms + ~1.1 MB/s), so speed numbers include download time.
const cache = new Map();   // same URL within a run: fetch once (keeps ESPN load low; timing still simulated)

async function espnViaRunner(page, net) {
  const stats = { bytes: 0, logoBytes: 0, requests: 0 };
  await page.route(/https:\/\/(site\.api\.espn\.com|sports\.core\.api\.espn\.com|site\.web\.api\.espn\.com|a\.espncdn\.com)\//, async (route) => {
    const url = route.request().url();
    try {
      let hit = cache.get(url);
      if (!hit || Date.now() - hit.at > 20000) {
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
        hit = { at: Date.now(), status: r.status, type: r.headers.get("content-type") || "application/octet-stream", body: Buffer.from(await r.arrayBuffer()) };
        cache.set(url, hit);
      }
      stats.bytes += hit.body.length; stats.requests++;
      if (/teamlogos/.test(url)) stats.logoBytes += hit.body.length;
      if (net) await new Promise((r) => setTimeout(r, net.latencyMs + hit.body.length / net.bytesPerMs));
      await route.fulfill({ status: hit.status, body: hit.body, headers: { "content-type": hit.type, "access-control-allow-origin": "*" } });
    } catch { await route.abort().catch(() => {}); }
  });
  return stats;
}
module.exports = { espnViaRunner };
