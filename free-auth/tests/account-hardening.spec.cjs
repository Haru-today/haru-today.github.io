const { test, expect } = require("@playwright/test");

test("account temporary outage preserves page and disables actions", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 503, body: "temporary" }));
  await page.goto("/account.html");
  await expect(page.locator("#authState")).toHaveText(/확인하지 못했습니다/);
  await expect(page).toHaveURL(/\/account\.html$/);
  await expect(page.locator("#withdrawWrap")).toBeHidden();
  await expect(page.locator("#withdraw")).toBeDisabled();
  await expect(page.locator("#logout")).toBeDisabled();
  await expect(page.locator("#retryStatus")).toBeEnabled();
});

test("account expired session returns to login", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, body: "expired" }));
  await page.goto("/account.html");
  await expect(page).toHaveURL(/\/login\.html$/);
});

test("account refuses incomplete identity response", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({
    json: { authenticated: true, status: "approved", role: "member" }
  }));
  await page.goto("/account.html");
  await expect(page.locator("#authState")).toHaveText(/확인하지 못했습니다/);
  await expect(page.locator("#withdraw")).toBeDisabled();
  await expect(page.locator("#retryStatus")).toBeEnabled();
});
