// ESPN refuses requests from browsers running on GitHub's servers (bot protection), but answers plain
// server-side requests. Fetch ESPN data and logos on the test-runner side and hand them to the page, so the
// app behaves exactly as it does on a phone. Returns a counter of bytes passed to the page.
// With `net` ({ latencyMs, bytesPerMs }), each response is held back as a phone network would
// (e.g. fast 4G: 150 ms + ~1.1 MB/s), so speed numbers include download time.
async function espnViaRunner(page, net) {
  const stats = { bytes: 0, logoBytes: 0, requests: 0 };
  await page.route(/https:\/\/(site\.api\.espn\.com|sports\.core\.api\.espn\.com|site\.web\.api\.espn\.com|a\.espncdn\.com)\//, async (route) => {
    try {
      const res = await route.fetch({ timeout: 20000 });
      const body = await res.body();
      stats.bytes += body.length; stats.requests++;
      if (/teamlogos/.test(route.request().url())) stats.logoBytes += body.length;
      if (net) await new Promise((r) => setTimeout(r, net.latencyMs + body.length / net.bytesPerMs));
      await route.fulfill({ status: res.status(), body, headers: { ...res.headers(), "access-control-allow-origin": "*" } });
    } catch { await route.abort(); }
  });
  return stats;
}
module.exports = { espnViaRunner };
