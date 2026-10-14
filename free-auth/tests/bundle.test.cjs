"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../dist");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

test("free Workers bundle contains only LABDAM and LabInsight protected assets", () => {
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

test("protected LABDAM portal links into LabInsight but not to a protected Caffeine Atlas copy", () => {
  const portal = read("index.html");
  assert.match(portal, /href="\/labinsight\/"/);
  assert.match(portal, /href="\/account.html"/);
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

test("private LabInsight HTML retains all original medical functionality and one account UI", () => {
  for (const file of ["index.html", "checkup.html", "report.html", "hospitals.html"]) {
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
