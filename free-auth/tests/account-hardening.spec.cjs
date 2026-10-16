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

test("successful logout clears only the LabInsight health report before allowing another login", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "a".repeat(64)
  } }));
  await page.route("**/auth/logout", route => {
    expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
    return route.fulfill({ status: 200, body: "ok" });
  });
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("labinsight-latest-report", "synthetic-health-values");
    localStorage.setItem("labinsight-latest-report", "synthetic-legacy-values");
    sessionStorage.setItem("unrelated-preference", "keep");
  });
  await page.locator("#logout").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  const result = await page.evaluate(() => ({
    session: sessionStorage.getItem("labinsight-latest-report"),
    legacy: localStorage.getItem("labinsight-latest-report"),
    unrelated: sessionStorage.getItem("unrelated-preference")
  }));
  expect(result).toEqual({ session: null, legacy: null, unrelated: "keep" });
});

test("failed logout never deletes a health report while login remains active", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "a".repeat(64)
  } }));
  await page.route("**/auth/logout", route => route.fulfill({ status: 503, body: "failed" }));
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem("labinsight-latest-report", "synthetic-health-values"));
  await page.locator("#logout").click();
  await expect(page.locator("#authState")).toHaveText(/로그아웃을 완료하지 못했습니다/);
  expect(await page.evaluate(() => sessionStorage.getItem("labinsight-latest-report")))
    .toBe("synthetic-health-values");
});

test("successful account withdrawal deletes only known local health-report keys", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "a".repeat(64)
  } }));
  await page.route("**/api/account/delete", route => route.fulfill({ status: 200,
    json: { ok: true, code: "ACCOUNT_DELETED" } }));
  page.on("dialog", d => d.accept());
  await page.goto("/account.html");
  await expect(page.locator("#withdraw")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("labinsight-latest-report", "synthetic-health-values");
    localStorage.setItem("labinsight-latest-report", "synthetic-legacy-values");
  });
  await page.locator("#withdraw").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => [
    sessionStorage.getItem("labinsight-latest-report"), localStorage.getItem("labinsight-latest-report")
  ])).toEqual([null, null]);
});

test("pending applicant withdrawal clears an older same-origin report", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "pending", role: "member",
    email: "applicant@example.invalid", purpose: "", csrf: "b".repeat(64)
  } }));
  await page.route("**/api/account/delete", route => route.fulfill({ status: 200,
    json: { ok: true, code: "ACCOUNT_DELETED" } }));
  page.on("dialog", d => d.accept());
  await page.goto("/pending.html");
  await expect(page.locator("#withdraw")).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem("labinsight-latest-report", "synthetic-old-user-data"));
  await page.locator("#withdraw").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem("labinsight-latest-report"))).toBeNull();
});
