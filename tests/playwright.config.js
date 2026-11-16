// Scoreline browser tests. Run in GitHub Actions (.github/workflows/test.yml); the site is served from the repo root.
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./specs",
  timeout: 45000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
  use: {
    baseURL: "http://127.0.0.1:8080/",
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 8080 --bind 127.0.0.1 --directory ..",
    url: "http://127.0.0.1:8080/index.html",
    reuseExistingServer: true,
  },
});
