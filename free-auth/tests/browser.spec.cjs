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
  await expect(page.getByText("실제 건강검진 수치 및 유전자형은", { exact: false })).toBeVisible();
  await expect(page.getByText("가입 회원정보 및 심사 이력", { exact: false })).toBeVisible();
  const operator = page.locator('section[aria-labelledby="operator"]');
  await expect(operator.getByText("이정민", { exact: true })).toBeVisible();
  await expect(operator.getByRole("link", { name: "jleegenomics@gmail.com", exact: true }))
    .toHaveAttribute("href", "mailto:jleegenomics@gmail.com");
  await expect(page.locator('meta[name="policy-status"]')).toHaveAttribute("content", "draft");
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth
  }));
  expect(dimensions.scroll, JSON.stringify(dimensions) + " " + info.project.name).toBeLessThanOrEqual(dimensions.width + 1);
});

test("refined LABDAM login stays compact, readable and usable across screen widths", async ({ page }, info) => {
  await page.goto("/login.html");
  const panel = page.locator(".login-panel");
  const cta = page.locator("#googleStart");
  await expect(page.getByRole("heading", { name: /LABDAM에 오신 것을 환영합니다/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google 계정으로 가입 신청" })).toBeVisible();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", "/auth/start");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "회원가입 개인정보 처리 안내" })).toBeVisible();
  const sizes = await page.evaluate(() => {
    const panel = document.querySelector(".login-panel").getBoundingClientRect();
    const cta = document.getElementById("googleStart").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      panelX: panel.x, panelRight: panel.right, panelWidth: panel.width,
      buttonHeight: cta.height, buttonWidth: cta.width
    };
  });
  expect(sizes.scroll, info.project.name + " horizontal overflow").toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.panelX).toBeGreaterThanOrEqual(0);
  expect(sizes.panelRight).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.panelWidth).toBeLessThanOrEqual(460.5);
  expect(sizes.buttonHeight).toBeGreaterThanOrEqual(48);
  expect(sizes.buttonWidth).toBeGreaterThanOrEqual(sizes.panelWidth * 0.7);
});

test("Korean welcome message keeps complete words on narrow 320px phones", async ({ page }) => {
  for (const width of [320, 375, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/login.html");
    const layout = await page.locator("#welcome-title").evaluate(heading => {
      const spans = [...heading.querySelectorAll(".welcome-line")];
      const wraps = spans.map(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return {
          rows: new Set(rects.map(r => Math.round(r.top))).size,
          width: el.getBoundingClientRect().width,
          contentRight: Math.max(...rects.map(r => r.right)),
          containerRight: heading.getBoundingClientRect().right
        };
      });
      return {
        text: spans.map(el => el.textContent.trim()).join(" "),
        wraps, overflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    expect(layout.text).toBe("LABDAM에 오신 것을 환영합니다.");
    expect(layout.wraps).toHaveLength(2);
    expect(layout.wraps[0].rows, "first line split at " + width).toBe(1);
    expect(layout.wraps[1].rows, "word '환영합니다.' split at " + width).toBe(1);
    expect(layout.wraps.every(item => item.contentRight <= item.containerRight + 1), "text overflow at " + width).toBe(true);
    expect(layout.overflow, "horizontal scroll at " + width).toBe(false);
  }
});

test("small privacy guidance and local results notice meet WCAG AA contrast", async ({ page }) => {
  await page.goto("/login.html");
  const contrast = await page.evaluate(() => {
    const linear = channel => {
      const v = channel / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number);
      return channels.map(linear).reduce((sum, value, index) =>
        sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const background = luminance(getComputedStyle(document.querySelector(".login-panel")).backgroundColor);
    return [".privacy-copy", "#localDataStatus"].map(selector => {
      const el = document.querySelector(selector);
      const foreground = luminance(getComputedStyle(el).color);
      const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      return { selector, ratio, fontSize: Number.parseFloat(getComputedStyle(el).fontSize) };
    });
  });
  for (const item of contrast) {
    expect(item.ratio, item.selector + " text contrast").toBeGreaterThanOrEqual(4.5);
    expect(item.fontSize, item.selector + " font size").toBeGreaterThanOrEqual(12);
  }
});

test("redesigned Google CTA preserves protected destination and rejects external login redirect", async ({ page }) => {
  await page.goto("/login.html?next=%2Flabinsight%2Fcarepath.html");
  await expect(page.locator("#googleStart")).toHaveAttribute("href",
    "/auth/start?next=%2Flabinsight%2Fcarepath.html");
  await page.goto("/login.html?next=%2F%2Fevil.example%2Ffake-login");
  await expect(page.locator("#googleStart")).toHaveAttribute("href", "/auth/start");
  await expect(page.getByRole("link", { name: "Caffeine Atlas 공개 체험 열기" }))
    .toHaveAttribute("href", "https://haru-today.github.io/caffeine-atlas/");
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

test("admin review disables all competing decisions and refresh until the server confirms", async ({ page }) => {
  const members=[{google_sub:"12345678901234",email:"review@example.invalid",display_name:"Reviewer",
    purpose:"학습",status:"approved",role:"member",created_at:1780000000}];
  let started=0,release;
  await page.route("**/api/me",route=>route.fulfill({json:{
    authenticated:true,email:"admin@example.invalid",name:"Admin",
    status:"approved",role:"admin",csrf:"b".repeat(64)
  }}));
  await page.route("**/api/admin/applications",route=>route.fulfill({json:{ok:true,members}}));
  await page.route("**/api/admin/review",async route=>{
    started++;
    await new Promise(resolve=>{release=resolve;});
    members[0].status="rejected";
    await route.fulfill({json:{ok:true}});
  });
  page.on("dialog",dialog=>dialog.accept());
  await page.goto("/admin.html");
  await expect(page.getByRole("button",{name:"거절",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"거절",exact:true}).click();
  await expect.poll(()=>started).toBe(1);
  for(const name of ["승인","거절","대기로"]){
    await expect(page.getByRole("button",{name,exact:true})).toBeDisabled();
  }
  await expect(page.locator("#refresh")).toBeDisabled();
  release();
  await expect(page.locator("#refresh")).toBeEnabled();
  await expect(page.getByRole("button",{name:"거절",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"승인",exact:true})).toBeEnabled();
  expect(started).toBe(1);
});

test("pending page blocks duplicate mutations while saving, then permits a retry", async ({ page }) => {
  let started=0,release;
  await page.route("**/api/me",route=>route.fulfill({json:{
    authenticated:true,email:"applicant@example.invalid",name:"Test",
    status:"pending",role:"member",purpose:"",csrf:"a".repeat(64)
  }}));
  await page.route("**/api/application",async route=>{
    started++;
    if(started===1){
      await new Promise(resolve=>{release=resolve;});
      await route.fulfill({status:503,json:{ok:false}});
    }else{
      await route.fulfill({json:{ok:true,status:"pending"}});
    }
  });
  await page.goto("/pending.html");
  await page.locator("#purpose").fill("학습 목적");
  await page.locator("#savePurpose").click();
  await expect.poll(()=>started).toBe(1);
  for(const id of ["#refreshStatus","#savePurpose","#withdraw","#logout"]){
    await expect(page.locator(id)).toBeDisabled();
  }
  release();
  await expect(page.locator("#formMessage")).toHaveText(/저장하지 못했습니다/);
  await expect(page.locator("#savePurpose")).toBeEnabled();
  await page.locator("#savePurpose").click();
  await expect(page.locator("#formMessage")).toHaveText("가입 목적이 저장되었습니다.");
  expect(started).toBe(2);
});

test("pending page disables mutations if status cannot be verified and restores them on retry", async ({ page }) => {
  let available=false;
  await page.route("**/api/me",route=>available?
    route.fulfill({json:{authenticated:true,email:"applicant@example.invalid",
      status:"pending",role:"member",purpose:"",csrf:"b".repeat(64)}}):
    route.fulfill({status:503,body:"temporarily unavailable"}));
  await page.goto("/pending.html");
  await expect(page.locator("#message")).toHaveText(/로그인 상태를 확인하지 못했습니다/);
  for(const id of ["#savePurpose","#withdraw","#logout"]){
    await expect(page.locator(id)).toBeDisabled();
  }
  available=true;
  await page.locator("#refreshStatus").click();
  await expect(page.locator("#status")).toHaveText("관리자 승인 대기");
  for(const id of ["#savePurpose","#withdraw","#logout"]){
    await expect(page.locator(id)).toBeEnabled();
  }
});

test("rejected applicant may leave but cannot submit a new pending-only purpose", async ({ page }) => {
  await page.route("**/api/me",route=>route.fulfill({json:{
    authenticated:true,email:"rejected@example.invalid",status:"rejected",
    role:"member",purpose:"",csrf:"c".repeat(64)
  }}));
  await page.goto("/pending.html");
  await expect(page.locator("#status")).toHaveText("승인되지 않음");
  await expect(page.locator("#purposeWrap")).toBeHidden();
  await expect(page.locator("#savePurpose")).toBeDisabled();
  await expect(page.locator("#logout")).toBeEnabled();
  await expect(page.locator("#withdraw")).toBeEnabled();
});
