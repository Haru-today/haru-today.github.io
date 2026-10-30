"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

test("every protected page navigation points to a bundled file or an intentional public URL", () => {
  for(const file of ["index.html","checkup.html","report.html","hospitals.html","carepath.html","account.html"]){
    const html=read("labinsight/"+file);
    for(const [,href] of html.matchAll(/href="([^"]+)"/g)){
      if(href.startsWith('#')||href.startsWith('mailto:'))continue;
      const u=new URL(href,"https://worker.invalid/labinsight/"+file);
      if(u.origin!=="https://worker.invalid")continue;
      const target=path.join(root,decodeURIComponent(u.pathname));
      assert.ok(fs.existsSync(target),file+": missing navigation "+u.pathname);
    }
    assert.match(html,/href="https:\/\/haru-today\.github\.io\/"/);
  }
});

test("free Workers bundle contains only LABDAM and REPODAM protected assets", () => {
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "account.html", "admin.html", "assets", "favicon.svg", "index.html",
    "labinsight", "login.html", "membership-privacy.html", "pending.html", "privacy.html",
    "robots.txt", "terms.html"
  ]);
  for (const disallowed of ["caffeine-atlas", "free-auth", "auth-gateway",
    "sources", "app.js", "node_modules", "google-apps-script", ".github"]) {
    assert.equal(fs.existsSync(path.join(root, disallowed)), false, disallowed);
  }
});

test("public LABDAM portal links into protected REPODAM but not to a protected Caffeine Atlas copy", () => {
  const portal = read("index.html");
  assert.match(portal, /href="\/labinsight\/"/);
  assert.match(portal, /id="portalAccountLink" href="#login"/);
  assert.match(portal, /id="portalGoogleStart"/);
  assert.match(read("assets/portal-session.js"), /\/api\/session-status/);
  assert.doesNotMatch(portal, /id="healthForm"|<input\b|labinsight\/app\.js/);
  assert.match(portal, /https:\/\/haru-today\.github\.io\/caffeine-atlas\//);
  assert.match(portal, /name="robots" content="noindex,nofollow"/);
  assert.doesNotMatch(portal, /href="\/caffeine-atlas\//);
});

test("protected privacy and terms disclose Google approval processing accurately", () => {
  const privacy = read("privacy.html");
  const terms = read("terms.html");
  assert.match(privacy, /회원가입·로그인 정보 처리/);
  assert.match(privacy, /Google 계정 식별자/);
  assert.match(privacy, /승인제 회원가입 과정에서 이메일·이름/);
  assert.match(privacy, /href="\/membership-privacy\.html"/);
  const membership = read("membership-privacy.html");
  const controller = membership.match(/name="policy-controller" content="([^"]+)"/)?.[1];
  const contact = membership.match(/href="mailto:([^"]+)"/)?.[1];
  assert.ok(controller && contact);
  assert.ok(privacy.includes("<strong>" + controller + "</strong>"));
  assert.ok(privacy.includes('href="mailto:' + contact + '"'));
  assert.doesNotMatch(privacy, /현재 서비스 전용 개인정보 담당자, 연락 수단 및 실명 확인 절차는 확정되지 않았습니다/);
  assert.doesNotMatch(privacy, /포털에는 이름·검사값 입력란이 없습니다/);
  assert.match(terms, /LABDAM 회원 승인 방식/);
  assert.match(terms, /Caffeine Atlas는 이 로그인 정책과 무관/);
  assert.match(terms, /href="\/membership-privacy\.html"/);
});

test("public login and approval-waiting pages are present as real self-service UI", () => {
  const login = read("login.html"), pending = read("pending.html");
  assert.match(login, /Google 계정으로 가입 신청/);
  assert.match(login, /href="\/auth\/start"/);
  assert.match(login, /href="\/membership-privacy\.html"/);
  assert.match(login, /승인 전에는 건강검진 결과 조회 페이지에 접근/);
  assert.match(pending, /\/api\/me/);
  assert.match(pending, /\/api\/application/);
  assert.match(pending, /id="purpose"/);
  assert.match(pending, /\/auth\/logout/);
  assert.match(read("membership-privacy.html"), /회원가입 개인정보 처리 안내/);
  assert.doesNotMatch(login + pending, /type="password"/);
});

test("admin dashboard offers approval, denial and revocation without hidden fake security", () => {
  const admin = read("admin.html"), account = read("account.html"), pending = read("pending.html");
  assert.match(admin, /\/api\/admin\/applications/);
  assert.match(admin, /\/api\/admin\/review/);
  assert.match(admin, /"approved"/);
  assert.match(admin, /"rejected"/);
  assert.match(admin, /"pending"/);
  assert.match(admin, /textContent=m\.email/);
  assert.doesNotMatch(admin, /innerHTML\s*=/);
  assert.match(account, /\/api\/me/);
  assert.match(account, /\/labinsight\//);
  assert.match(account, /\/api\/account\/delete/);
  assert.match(pending, /\/api\/account\/delete/);
  assert.match(account, /https:\/\/haru-today\.github\.io\/caffeine-atlas\//);
});

test("private REPODAM HTML retains all original medical functionality and one account UI", () => {
  for (const file of ["index.html", "checkup.html", "report.html", "hospitals.html", "carepath.html"]) {
    const html = read("labinsight/" + file);
    assert.match(html, /href="\.\/account.html"/);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.doesNotMatch(html, /https:\/\/haru-today\.github\.io\/labinsight\//);
  }
  assert.match(read("labinsight/checkup.html"), /openReferenceSettingsBtn/);
  assert.match(read("labinsight/report.html"), /검사결과/);
  assert.ok(fs.existsSync(path.join(root, "labinsight", "reference-ranges.js")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "ocr-review.js")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "icons", "icon.svg")));
  assert.equal(read("labinsight/account.html"), read("account.html"));
});

test("every local script referenced by protected REPODAM pages is bundled", () => {
  for (const file of ["index.html", "checkup.html", "report.html", "hospitals.html", "carepath.html"]) {
    const page = path.join("labinsight", file);
    for (const match of read(page).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const src = match[1].split(/[?#]/)[0];
      if (/^(?:https?:)?\/\//i.test(src)) continue;
      const target = src.startsWith("/")
        ? path.resolve(root, "." + src)
        : path.resolve(root, path.dirname(page), src);
      assert.ok(target.startsWith(root + path.sep), `${page}: unsafe script path`);
      assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `${page}: missing ${src}`);
    }
  }
});

test("private legal documents preserve accessible public Caffeine Atlas destination", () => {
  for (const file of ["privacy.html", "terms.html"]) {
    const s = read(file);
    assert.match(s, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/"/);
    assert.match(s, /name="robots" content="noindex,nofollow"/);
    assert.doesNotMatch(s, /href="\/caffeine-atlas\//);
  }
  assert.match(read("robots.txt"), /Disallow: \//);
});

test("no privileged service-worker cache or legacy cloud access script in static bundle", () => {
  const sw = read("labinsight/service-worker.js");
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /caches\.keys\(\)/);
  assert.match(sw, /caches\.delete\(key\)/);
  assert.doesNotMatch(sw, /caches\.open|cache\.put|CacheStorage/);
  for (const rel of ["auth-gateway/worker.mjs", "free-auth/worker.mjs",
                     "google-apps-script/Code.gs", "secrets", ".dev.vars"]) {
    assert.equal(fs.existsSync(path.join(root, rel)), false);
  }
});

test("protected build preserves reviewed interpretation, OCR and PDF scripts", () => {
  const source = process.env.LABINSIGHT_SOURCE || [
    path.resolve(__dirname, "../../sources/labinsight"),
    path.resolve(__dirname, "../../../labinsight")
  ].find(p => fs.existsSync(path.join(p, "app.js")));
  assert.ok(source, "Reviewed REPODAM checkout is required");
  for (const file of ["ocr-review.js", "reference-ranges.js", "hospital-data.js", "runtime-config.js", "app.js", "carepath-data.js", "carepath.js"]) {
    let expected = fs.readFileSync(path.join(source, file), "utf8")
      .replaceAll("https://haru-today.github.io/labinsight/", "/labinsight/")
      .replace(/https:\/\/haru-today\.github\.io\/(?!caffeine-atlas\/)/g, "/")
      .replace(/(href|src)=(["'])\/caffeine-atlas\//g,
        '$1=$2https://haru-today.github.io/caffeine-atlas/');
    if (file === "app.js") expected = expected
      .replace('if (cache) cache.textContent = "오프라인 준비 완료";',
        'if (cache) cache.textContent = "승인 확인을 위해 온라인 연결 필요";')
      .replace('if (cache) cache.textContent = "오프라인 캐시 대기";',
        'if (cache) cache.textContent = "온라인 연결 상태를 확인해 주세요";');
    if (file === "runtime-config.js") expected += "\nwindow.LABDAM_PROTECTED_DEVICE_STORE = true;\n";
    assert.equal(read("labinsight/" + file), expected, file);
  }
});

test("protected REPODAM links to the current protected privacy notice and scopes device storage", () => {
  assert.match(read("labinsight/checkup.html"), /href="\/privacy\.html"/);
  assert.match(read("labinsight/report.html"), /href="\/privacy\.html"/);
  assert.match(read("labinsight/runtime-config.js"), /window\.LABDAM_PROTECTED_DEVICE_STORE = true/);
  assert.match(read("privacy.html"), /승인 계정을 구분/);
});

test("CarePath timeline is fully inside private assets and never saves a health record to a server", () => {
  const page = read("labinsight/carepath.html");
  const client = read("labinsight/carepath.js");
  const data = read("labinsight/carepath-data.js");
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /href="\.\/account\.html"/);
  assert.match(page, /sessionStorage/);
  assert.match(client, /sessionStorage/);
  assert.match(data, /labinsight-carepath-session-v1/);
  assert.doesNotMatch(client + data, /localStorage|\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.doesNotMatch(page, /https:\/\/haru-today\.github\.io\/labinsight\//);
  for (const type of ["account.html","login.html","pending.html"]) {
    assert.match(read(type), /labinsight-carepath-session-v1/, type);
  }
});


test("reviewed CarePath validation blocks mismatched imported units and ambiguous same-day trends", () => {
  const vm = require("node:vm");
  const win = {};
  vm.runInNewContext(read("labinsight/carepath-data.js"), { window: win, Date });
  const api = win.LABINSIGHT_CAREPATH;
  assert.ok(api, "CarePath model must be in protected Worker assets");
  const date = "2025-01-02", today = "2026-10-16";
  assert.throws(() => api.createRecord({
    glucose: 5.2, referenceRanges: { glucose: { min: 3.9, max: 6.1, unit: "mmol/L" } }
  }, date, "합성 검사기관", "", true, today), /원본 단위|단위가 입력 단위/);
  const first = api.createRecord({ ast: 24 }, date, "가상 기관 A", "", true, today);
  const second = api.createRecord({ ast: 36 }, date, "가상 기관 B", "", true, today);
  const comparison = api.compare([first, second], "ast");
  assert.equal(comparison.status, "ambiguous-dates");
  assert.equal(comparison.difference, undefined);
  assert.equal(api.createRecord({ ast: 24 }, date, "가상 기관 A", "", true, today).values.ast.range, null);
  assert.throws(() => api.createRecord({ ast: 24, provenance: "sample" }, date, "가상 기관 A", "", true, today), /가상 예시/);
});
