const { test, expect } = require("@playwright/test");

test("free approval signup explains restrictions and exposes privacy before any Google OAuth request", async ({ page }, info) => {
  await page.goto("/login.html");
  await expect(page).toHaveTitle(/LABDAM/);
  await expect(page.getByRole("heading", { name: "Google 계정으로 가입 신청" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google 계정으로 계속하기" })).toHaveAttribute("href", "/auth/start");
  await expect(page.getByRole("link", { name: "회원가입 개인정보 처리 안내" })).toHaveAttribute("href", "/membership-privacy.html");
  await expect(page.getByText("관리자가 승인한 회원만 이용", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Caffeine Atlas 공개 체험 열기" }))
    .toHaveAttribute("href", "https://haru-today.github.io/caffeine-atlas/");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.goto("/membership-privacy.html");
  await expect(page.getByRole("heading", { name: "회원가입 개인정보 처리 안내" })).toBeVisible();
  await expect(page.getByText("건강검진 수치 및 유전자형 분석 데이터는 회원 데이터베이스에 저장하지 않습니다", { exact: false })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth
  }));
  expect(dimensions.scroll, JSON.stringify(dimensions) + " " + info.project.name).toBeLessThanOrEqual(dimensions.width + 1);
});

test("pending applicant sees status, can edit purpose and withdraw membership", async ({ page }) => {
  let applicationCount = 0, withdrawn = false;
  await page.route("**/api/me", route => route.fulfill({
    json: { authenticated: true, email: "applicant@example.invalid", name: "Applicant",
      status: "pending", role: "member", purpose: "의료정보 조회", csrf: "a".repeat(64) }
  }));
  await page.route("**/api/application", route => {
    applicationCount++;
    expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
    expect(route.request().postDataJSON().purpose).toBe("학습 자료 확인");
    return route.fulfill({ json: { ok: true, status: "pending" } });
  });
  await page.route("**/api/account/delete", route => {
    withdrawn = true;
    expect(route.request().headers()["x-csrf-token"]).toBe("a".repeat(64));
    return route.fulfill({ json: { ok: true, code: "ACCOUNT_DELETED" } });
  });
  page.on("dialog", d => d.accept());
  await page.goto("/pending.html");
  await expect(page.getByText("가입 신청이 접수됐습니다", { exact: false })).toBeVisible();
  await expect(page.locator("#email")).toHaveText("applicant@example.invalid");
  await page.locator("#purpose").fill("학습 자료 확인");
  await page.getByRole("button", { name: "가입 목적 저장" }).click();
  await expect(page.locator("#formMessage")).toHaveText("가입 목적이 저장되었습니다.");
  expect(applicationCount).toBe(1);
  await page.getByRole("button", { name: "가입 신청 철회·정보 삭제" }).click();
  await expect.poll(() => withdrawn).toBe(true);
});

test("member account shows role and withdrawal without administrator access", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({
    json: { authenticated: true, name: "Approved User", email: "member@example.invalid",
      status: "approved", role: "member", csrf: "c".repeat(64) }
  }));
  await page.goto("/account.html");
  await expect(page.locator("#email")).toHaveText("member@example.invalid");
  await expect(page.locator("#status")).toHaveText("승인 완료");
  await expect(page.locator("#adminLink")).toBeHidden();
  await expect(page.locator("#withdraw")).toBeVisible();
  await expect(page.getByRole("link", { name: "LabInsight 이용" })).toHaveAttribute("href", "/labinsight/");
});

test("pending approval can be checked again without repeating Google sign-in", async ({ page }) => {
  let approved = false;
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, email: "applicant@example.invalid", name: "Applicant",
    status: approved ? "approved" : "pending", role: "member", csrf: "a".repeat(64)
  } }));
  await page.goto("/pending.html");
  await expect(page.locator("#status")).toHaveText("관리자 승인 대기");
  approved = true;
  await page.getByRole("button", { name: "승인 상태 다시 확인" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("failed logout stays on account screen and tells the member to retry", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, email: "member@example.invalid", status: "approved",
    role: "member", csrf: "a".repeat(64)
  } }));
  await page.route("**/auth/logout", route => route.abort("failed"));
  await page.goto("/account.html");
  await expect(page.locator("#authState")).toHaveText("로그인 상태가 확인되었습니다.");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.locator("#authState")).toHaveText(/로그아웃을 완료하지 못했습니다/);
  await expect(page).toHaveURL(/\/account\.html$/);
});

test("administrator sees the approval dashboard and cannot accidentally delete own admin record", async ({ page }) => {
  const members = [
    { google_sub: "12345678901234", email: "pending@example.invalid", display_name: "Candidate", purpose: "학술 학습",
      status: "pending", role: "member", created_at: 1780000000 }
  ];
  let reviewed = false;
  await page.route("**/api/me", route => route.fulfill({
    json: { authenticated: true, name: "Lab Administrator", email: "admin@example.invalid",
      status: "approved", role: "admin", csrf: "b".repeat(64) }
  }));
  await page.route("**/api/admin/applications", route => route.fulfill({
    json: { ok: true, members }
  }));
  await page.route("**/api/admin/review", route => {
    expect(route.request().headers()["x-csrf-token"]).toBe("b".repeat(64));
    expect(route.request().postDataJSON()).toEqual({
      google_sub: "12345678901234", status: "approved"
    });
    reviewed = true;
    members[0].status = "approved";
    return route.fulfill({ json: { ok: true } });
  });
  page.on("dialog", d => d.accept());
  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "회원가입 신청 관리" })).toBeVisible();
  await expect(page.getByText("pending@example.invalid")).toBeVisible();
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect.poll(() => reviewed).toBe(true);
  await expect(page.locator("#members tr")).toHaveCount(1);
  await page.goto("/account.html");
  await expect(page.locator("#adminLink")).toBeVisible();
  await expect(page.locator("#withdrawWrap")).toBeHidden();
});
