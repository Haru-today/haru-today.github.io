const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: /browser\.spec\.cjs/,
  timeout: 30_000,
  expect: { timeout: 7000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "free-auth-browser-report" }]] : "list",
  outputDir: "free-auth-browser-results",
  use: { baseURL: "http://127.0.0.1:4177", headless: true },
  projects: [
    { name: "desktop-chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "mobile-320", use: { browserName: "chromium", viewport: { width: 320, height: 680 }, isMobile: true, hasTouch: true } },
    { name: "mobile-390", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: "python3 -m http.server 4177 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4177/login.html",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
