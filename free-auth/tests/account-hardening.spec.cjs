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

test("starting a different Google login clears the previous same-origin report before OAuth", async ({ page }) => {
  await page.route("**/auth/start*", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>synthetic OAuth boundary</title>"
  }));
  await page.goto("/login.html?next=%2Flabinsight%2F");
  await page.evaluate(() => {
    sessionStorage.setItem("labinsight-latest-report", "synthetic-old-member-report");
    localStorage.setItem("labinsight-latest-report", "synthetic-old-legacy-report");
    localStorage.setItem("non-health-preference", "keep");
  });
  await page.getByRole("link", { name: "Google 계정으로 계속하기" }).click();
  await expect(page).toHaveURL(/\/auth\/start\?next=/);
  expect(await page.evaluate(() => ({
    current: sessionStorage.getItem("labinsight-latest-report"),
    old: localStorage.getItem("labinsight-latest-report"),
    pref: localStorage.getItem("non-health-preference")
  }))).toEqual({ current: null, old: null, pref: "keep" });
});

test("CarePath session history is purged on successful account logout", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "c".repeat(64)
  }}));
  await page.route("**/auth/logout", route => route.fulfill({ status: 200, body: "ok" }));
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("labinsight-carepath-session-v1", "synthetic-yearly-health");
    localStorage.setItem("labinsight-carepath-session-v1", "synthetic-old-data");
  });
  await page.locator("#logout").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => [
    sessionStorage.getItem("labinsight-carepath-session-v1"),
    localStorage.getItem("labinsight-carepath-session-v1")
  ])).toEqual([null, null]);
});

test("failed account logout retains CarePath data while member remains authenticated", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "c".repeat(64)
  }}));
  await page.route("**/auth/logout", route => route.fulfill({ status: 503, body: "failed" }));
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem("labinsight-carepath-session-v1", "synthetic-yearly-health"));
  await page.locator("#logout").click();
  await expect(page.locator("#authState")).toHaveText(/로그아웃을 완료하지 못했습니다/);
  expect(await page.evaluate(() => sessionStorage.getItem("labinsight-carepath-session-v1")))
    .toBe("synthetic-yearly-health");
});

test("a new Google login clears both latest report and CarePath timeline across both stores", async ({ page }) => {
  await page.route("**/auth/start*", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>synthetic Google OAuth transition</title>"
  }));
  await page.goto("/login.html?next=%2Flabinsight%2Fcarepath.html");
  await page.evaluate(() => {
    for (const store of [sessionStorage, localStorage]) {
      store.setItem("labinsight-latest-report", "synthetic-report-do-not-reuse");
      store.setItem("labinsight-carepath-session-v1", "synthetic-CarePath-do-not-reuse");
    }
    sessionStorage.setItem("unrelated-preference", "preserve");
  });
  await page.getByRole("link", { name: "Google 계정으로 계속하기" }).click();
  await expect(page).toHaveURL(/\/auth\/start\?next=/);
  expect(await page.evaluate(() => ({
    protectedKeys: ["labinsight-latest-report", "labinsight-carepath-session-v1"].flatMap(key =>
      [sessionStorage.getItem(key), localStorage.getItem(key)]),
    unrelated: sessionStorage.getItem("unrelated-preference")
  }))).toEqual({ protectedKeys: [null, null, null, null], unrelated: "preserve" });
});

test("pending-member account withdrawal removes CarePath from both stores before allowing another login", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "pending", role: "member",
    email: "applicant@example.invalid", purpose: "", csrf: "b".repeat(64)
  }}));
  await page.route("**/api/account/delete", route => route.fulfill({
    status: 200, json: { ok: true, code: "ACCOUNT_DELETED" }
  }));
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/pending.html");
  await expect(page.locator("#withdraw")).toBeEnabled();
  await page.evaluate(() => {
    sessionStorage.setItem("labinsight-carepath-session-v1", "synthetic-CarePath-before-withdrawal");
    localStorage.setItem("labinsight-carepath-session-v1", "synthetic-legacy-history");
  });
  await page.locator("#withdraw").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => [
    sessionStorage.getItem("labinsight-carepath-session-v1"),
    localStorage.getItem("labinsight-carepath-session-v1")
  ])).toEqual([null, null]);
});


test("successful logout clears report, CarePath and demo bookings without touching unrelated preferences", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "f".repeat(64)
  }}));
  await page.route("**/auth/logout", route => route.fulfill({ status: 200, body: "ok" }));
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => {
    const oldKeys = ["labinsight-latest-report", "labinsight-carepath-session-v1",
      "labinsight-demo-bookings-v2", "labinsight-bookings"];
    for (const store of [sessionStorage, localStorage]) {
      for (const key of oldKeys) store.setItem(key, "synthetic-do-not-reuse");
      store.setItem("unrelated-preference", "keep");
    }
  });
  await page.locator("#logout").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  const result = await page.evaluate(() => {
    const oldKeys = ["labinsight-latest-report", "labinsight-carepath-session-v1",
      "labinsight-demo-bookings-v2", "labinsight-bookings"];
    return {
      legacy: [sessionStorage, localStorage].flatMap(store => oldKeys.map(key => store.getItem(key))),
      unrelated: [sessionStorage.getItem("unrelated-preference"), localStorage.getItem("unrelated-preference")]
    };
  });
  expect(result).toEqual({ legacy: Array(8).fill(null), unrelated: ["keep", "keep"] });
});

test("pending applicant withdrawal clears simulated bookings before another account uses the tab", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "pending", role: "member",
    email: "applicant@example.invalid", purpose: "", csrf: "e".repeat(64)
  }}));
  await page.route("**/api/account/delete", route => route.fulfill({
    status: 200, json: { ok: true, code: "ACCOUNT_DELETED" }
  }));
  page.on("dialog", d => d.accept());
  await page.goto("/pending.html");
  await expect(page.locator("#withdraw")).toBeEnabled();
  await page.evaluate(() => {
    for (const store of [sessionStorage, localStorage]) {
      store.setItem("labinsight-demo-bookings-v2", "synthetic-booking");
      store.setItem("labinsight-bookings", "synthetic-legacy-booking");
    }
  });
  await page.locator("#withdraw").click();
  await expect(page).toHaveURL(/\/login\.html$/);
  expect(await page.evaluate(() => [sessionStorage, localStorage].flatMap(store =>
    ["labinsight-demo-bookings-v2", "labinsight-bookings"].map(key => store.getItem(key))
  ))).toEqual([null, null, null, null]);
});

test("new Google login clears past simulated bookings before leaving the login page", async ({ page }) => {
  await page.route("**/auth/start*", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>synthetic login handoff</title>"
  }));
  await page.goto("/login.html?next=%2Flabinsight%2F");
  await page.evaluate(() => {
    for (const store of [sessionStorage, localStorage]) {
      store.setItem("labinsight-demo-bookings-v2", "old-sample");
      store.setItem("labinsight-bookings", "old-legacy-sample");
    }
    sessionStorage.setItem("caffeine-atlas-preference", "keep");
  });
  await page.getByRole("link", { name: "Google 계정으로 계속하기" }).click();
  await expect(page).toHaveURL(/\/auth\/start\?next=/);
  expect(await page.evaluate(() => ({
    bookings: [sessionStorage, localStorage].flatMap(store =>
      ["labinsight-demo-bookings-v2", "labinsight-bookings"].map(key => store.getItem(key))),
    caffeine: sessionStorage.getItem("caffeine-atlas-preference")
  }))).toEqual({ bookings: [null, null, null, null], caffeine: "keep" });
});

test("failed logout preserves demo bookings while the member remains logged in", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ json: {
    authenticated: true, status: "approved", role: "member",
    email: "member@example.invalid", csrf: "d".repeat(64)
  }}));
  await page.route("**/auth/logout", route => route.fulfill({ status: 503, body: "offline" }));
  await page.goto("/account.html");
  await expect(page.locator("#logout")).toBeEnabled();
  await page.evaluate(() => sessionStorage.setItem("labinsight-demo-bookings-v2", "synthetic-booking"));
  await page.locator("#logout").click();
  await expect(page.locator("#authState")).toHaveText(/로그아웃을 완료하지 못했습니다/);
  expect(await page.evaluate(() => sessionStorage.getItem("labinsight-demo-bookings-v2")))
    .toBe("synthetic-booking");
});
