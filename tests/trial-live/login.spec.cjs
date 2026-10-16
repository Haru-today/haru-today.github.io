"use strict";
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

// Read-only verification of the already deployed, public login page.
// Never navigate to /auth/start, create accounts, or send health data.
test("live LABDAM login remains legible at the deployed trial origin", async ({ page }, testInfo) => {
  const response = await page.goto("/login.html", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/LABDAM/);
  await expect(page.getByRole("heading", { level: 1, name: /LABDAM에 오신 것을 환영합니다/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google 계정으로 계속하기" }))
    .toHaveAttribute("href", "/auth/start");
  await expect(page.getByRole("link", { name: "Caffeine Atlas 공개 체험 열기" }))
    .toHaveAttribute("href", "https://haru-today.github.io/caffeine-atlas/");
  await expect(page.getByText("로그인 불필요", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "회원가입 개인정보 처리 안내" }))
    .toHaveAttribute("href", "/membership-privacy.html");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  // Preserve an actual screenshot of the remotely deployed page, not a local bundle.
  await page.screenshot({ path: testInfo.outputPath("deployed-login.png"), fullPage: true, animations: "disabled" });

  const layout = await page.evaluate(() => {
    const heading = document.getElementById("welcome-title");
    const lines = Array.from(heading.querySelectorAll(".welcome-line"));
    const panel = document.querySelector(".login-panel").getBoundingClientRect();
    const google = document.getElementById("googleStart").getBoundingClientRect();
    const caffeine = document.querySelector(".caffeine-card").getBoundingClientRect();
    const wordRows = lines.map(line => {
      const range = document.createRange();
      range.selectNodeContents(line);
      return [...new Set(Array.from(range.getClientRects(), r => Math.round(r.top)))].length;
    });
    return {
      words: lines.map(line => line.textContent.trim()),
      wordRows,
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      panelLeft: panel.left,
      panelRight: panel.right,
      googleHeight: google.height,
      caffeineHeight: caffeine.height,
      contentFits: lines.every(line => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return Array.from(range.getClientRects()).every(r => r.right <= heading.getBoundingClientRect().right + 1);
      })
    };
  });
  expect(layout.words).toEqual(["LABDAM에 오신 것을", "환영합니다."]);
  expect(layout.wordRows, "Korean words must not be split").toEqual([1, 1]);
  expect(layout.contentWidth, "horizontal page overflow").toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.contentFits, "welcome heading clips or extends past its card").toBe(true);
  expect(layout.googleHeight).toBeGreaterThanOrEqual(44);
  expect(layout.caffeineHeight).toBeGreaterThanOrEqual(44);
  await testInfo.attach("layout.json", { body: JSON.stringify({ project: testInfo.project.name, layout }, null, 2), contentType: "application/json" });

  // Fail the read-only CI audit if the deployed login has WCAG A/AA violations.
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const findings = a11y.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => n.target) }));
  await testInfo.attach("accessibility.json", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  console.log("Read-only live login review:", testInfo.project.name, JSON.stringify(layout), "accessibility findings:", findings.length);
  expect(findings, "Deployed login must have no axe WCAG A/AA violations; see accessibility.json attachment").toEqual([]);
});
