"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "dist");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("protected bundle is only LABDAM root and LabInsight, never Caffeine Atlas", () => {
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "account.html", "assets", "favicon.svg", "index.html",
    "labinsight", "privacy.html", "robots.txt", "terms.html"
  ]);
  assert.ok(fs.existsSync(path.join(root, "labinsight", "index.html")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "checkup.html")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "report.html")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "account.html")));
  assert.equal(fs.existsSync(path.join(root, "caffeine-atlas")), false);
  assert.equal(fs.existsSync(path.join(root, "api")), false);
});

test("LABDAM home remains an independently accessible HTML page behind authentication", () => {
  const html = read("index.html");
  assert.match(html, /<title>LABDAM/);
  assert.match(html, /aria-label="두 서비스 바로 시작"/);
  assert.match(html, /href="\/labinsight\/"/);
  assert.match(html, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/"/);
  assert.match(html, /href="\/account.html">내 계정/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.doesNotMatch(html, /href="https:\/\/haru-today\.github\.io\/labinsight\//);
  assert.ok(fs.existsSync(path.join(root, "assets", "portal-redesign.css")));
  assert.ok(fs.existsSync(path.join(root, "favicon.svg")));
});

test("protected LABDAM policy pages preserve external public Caffeine Atlas links", () => {
  for (const file of ["privacy.html", "terms.html"]) {
    const html = read(file);
    assert.match(html, /name="robots" content="noindex,nofollow"/, file);
    assert.match(html, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/"/, file);
    assert.match(html, /href="\/labinsight\/"/, file);
    assert.doesNotMatch(html, /href="\/caffeine-atlas\/"/, file);
  }
});

test("all protected HTML prevents indexing and robot policy blocks indexing", () => {
  const pages = [
    "index.html", "account.html", "privacy.html", "terms.html",
    "labinsight/index.html", "labinsight/checkup.html",
    "labinsight/report.html", "labinsight/hospitals.html",
    "labinsight/account.html"
  ];
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /name="robots" content="noindex,nofollow"/, file);
    assert.equal((html.match(/name="robots"/g) || []).length, 1, file);
  }
  assert.match(read("robots.txt"), /Disallow: \//);
});

test("LABDAM and LabInsight navigation share the private root and account", () => {
  const portal = read("index.html");
  const lab = read("labinsight/index.html");
  assert.match(portal, /href="\/labinsight\/"/);
  assert.match(portal, /href="\/account.html"/);
  assert.doesNotMatch(lab, /https:\/\/haru-today\.github\.io\/labinsight\//);
  assert.match(lab, /href="\.\/account.html"/);
  for (const page of ["index.html", "checkup.html", "report.html", "hospitals.html"]) {
    assert.match(read("labinsight/" + page), /href="\.\/account.html"/);
  }
});

test("the account page shows only authenticated identity, not Caffeine or Sheets access", () => {
  const account = read("account.html");
  assert.match(account, /fetch\("\/api\/session"/);
  assert.match(account, /href="\/logout"/);
  assert.match(account, /href="\/labinsight\/"/);
  assert.match(account, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/"/);
  assert.match(account, /href="\/">LABDAM\./);
  assert.doesNotMatch(account, /type="password"|Prototype UI|회원 화면 예시/);
  assert.doesNotMatch(account, /storageAllowed|storage-permission|Google Sheets|연구 데이터 저장 권한/);
  assert.equal(read("labinsight/account.html"), account);
});

test("Caffeine Atlas QR destination is never replaced with a protected URL", () => {
  for (const file of ["index.html", "account.html", "labinsight/index.html",
                      "privacy.html", "terms.html"]) {
    const html = read(file);
    assert.doesNotMatch(html, /href="\/caffeine-atlas\//, file);
    assert.doesNotMatch(html, /href="https:\/\/services\.labdam\.example\/caffeine-atlas\//, file);
  }
  const portal = read("index.html");
  assert.match(portal, /https:\/\/haru-today\.github\.io\/caffeine-atlas\//);
});

test("only approved static asset files are shipped, no server or research records", () => {
  for (const rel of [
    "README.md", "sitemap.xml", "package.json", ".github",
    "auth-gateway", "sources",
    "labinsight/server.js", "labinsight/data",
    "caffeine-atlas", "api/caffeine-atlas", "google-apps-script"
  ]) {
    assert.equal(fs.existsSync(path.join(root, rel)), false, rel);
  }
});

test("LabInsight medical reference logic, OCR consent and mobile report retain entry points", () => {
  const lab = read("labinsight/index.html");
  const checkup = read("labinsight/checkup.html");
  const report = read("labinsight/report.html");
  assert.match(lab, /건강검진/);
  assert.match(lab, /의료진/);
  assert.match(checkup, /openReferenceSettingsBtn/);
  assert.match(checkup, /openOcrSectionBtn/);
  assert.match(checkup, /entryProgress/);
  assert.match(report, /검사결과/);
  assert.ok(fs.existsSync(path.join(root, "labinsight", "reference-ranges.js")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "ocr-review.js")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "app.js")));
});

test("protected LabInsight has a non-caching service worker so logout cannot reveal cached pages", () => {
  const sw = read("labinsight/service-worker.js");
  assert.doesNotMatch(sw, /caches\.open|CacheStorage|cache\.put|fetch\(/);
  assert.match(sw, /skipWaiting/);
});
