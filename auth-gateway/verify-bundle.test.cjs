"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "dist");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("only the two LABDAM services are prepared for protected hosting", () => {
  assert.ok(fs.existsSync(path.join(root, "labinsight", "index.html")));
  assert.ok(fs.existsSync(path.join(root, "labinsight", "report.html")));
  assert.ok(fs.existsSync(path.join(root, "caffeine-atlas", "index.html")));
  assert.ok(fs.existsSync(path.join(root, "caffeine-atlas", "caffeine-sensitivity-app", "analyzer.html")));
  assert.ok(fs.existsSync(path.join(root, "caffeine-atlas", "caffeine-sensitivity-app", "account.html")));
  assert.equal(fs.readdirSync(root).sort().join(","), "caffeine-atlas,labinsight,robots.txt");
});

test("build excludes local server, booking database, and mock sign-in pages", () => {
  for (const relative of [
    "labinsight/server.js", "labinsight/data",
    "caffeine-atlas/google-apps-script",
    "caffeine-atlas/caffeine-sensitivity-app/board-write-backend.js"
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, relative);
  }
});

test("protected service pages are excluded from indexing", () => {
  for (const file of [
    "labinsight/index.html", "labinsight/checkup.html",
    "labinsight/report.html", "labinsight/hospitals.html",
    "caffeine-atlas/index.html",
    "caffeine-atlas/caffeine-sensitivity-app/index.html",
    "caffeine-atlas/caffeine-sensitivity-app/analyzer.html"
  ]) {
    const html = read(file);
    assert.match(html, /name="robots" content="noindex,nofollow"/, file);
    assert.equal((html.match(/name="robots"/g) || []).length, 1, file);
  }
  assert.match(read("robots.txt"), /Disallow: \//);
});

test("Caffeine Atlas first-party service URLs point to protected routes", () => {
  const html = read("caffeine-atlas/caffeine-sensitivity-app/index.html");
  assert.ok(!html.includes("https://haru-today.github.io/caffeine-atlas/"));
  assert.match(html, /\/caffeine-atlas\/caffeine-sensitivity-app/);
  assert.match(html, /https:\/\/haru-today.github.io\//);
});

test("both applications link to protected service paths rather than legacy public apps", () => {
  const lab = read("labinsight/index.html");
  const caffeine = read("caffeine-atlas/caffeine-sensitivity-app/index.html");
  for (const html of [lab, caffeine]) {
    assert.doesNotMatch(html, /https:\/\/haru-today\.github\.io\/(?:labinsight|caffeine-atlas)\//);
  }
  assert.match(lab, /\/caffeine-atlas\/caffeine-sensitivity-app\/analyzer\.html/);
  assert.match(caffeine, /https:\/\/haru-today\.github\.io\//);
});


test("protected Caffeine Atlas web bundle calls authenticated same-origin Sheets API", () => {
  const app = read("caffeine-atlas/caffeine-sensitivity-app/app.js");
  assert.match(app, /var GOOGLE_SHEETS_ENDPOINT = "\/api\/caffeine-atlas"/);
  assert.doesNotMatch(app, /https:\/\/script\.google\.com\/macros\//);
  assert.doesNotMatch(app, /mode: "no-cors"/);
  assert.doesNotMatch(app, /caffeineBatchCapability_/);
  assert.match(app, /credentials: "same-origin"/);
  assert.match(app, /"Content-Type": "application\/json;charset=utf-8"/);
  assert.match(app, /response\.json\(\)/);
});


test("protected account page is real session readout, never a nonfunctional password mockup", () => {
  const html = read("caffeine-atlas/caffeine-sensitivity-app/account.html");
  assert.match(html, /fetch\("\/api\/session"/);
  assert.match(html, /href="\/logout"/);
  assert.match(html, /id="user-email"/);
  assert.match(html, /data\.storageAllowed/);
  assert.doesNotMatch(html, /type="password"|Prototype UI|회원 화면 예시/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  for (const page of ["index.html", "board.html", "board-write.html"]) {
    const source = read("caffeine-atlas/caffeine-sensitivity-app/" + page);
    assert.match(source, /href="\.\/account\.html"/);
    assert.doesNotMatch(source, /hidden data-disabled-feature="account"/);
  }
});


test("LabInsight protected pages link to shared verified account status and logout", () => {
  const account = read("labinsight/account.html");
  assert.match(account, /fetch\("\/api\/session"/);
  assert.match(account, /href="\/logout"/);
  assert.doesNotMatch(account, /type="password"/);
  for (const page of ["index.html", "checkup.html", "report.html", "hospitals.html"]) {
    const html = read("labinsight/" + page);
    assert.match(html, /href="\.\/account\.html"/);
  }
});

test("protected LabInsight browser shell does not cache unauthenticated HTML", () => {
  const sw = read("labinsight/service-worker.js");
  assert.doesNotMatch(sw, /caches\.open|CacheStorage|cache\.put|fetch\(/);
  assert.match(sw, /skipWaiting/);
});

test("medical warnings and existing user workflows remain in protected bundles", () => {
  const lab = read("labinsight/index.html");
  const caffeine = read("caffeine-atlas/caffeine-sensitivity-app/index.html");
  assert.match(lab, /건강검진/);
  assert.match(lab, /의료진/);
  assert.match(caffeine, /유전자형/);
  assert.match(caffeine, /리포트/);
  assert.ok(fs.existsSync(path.join(root, "labinsight", "ocr-review.js")));
  assert.ok(fs.existsSync(path.join(root, "caffeine-atlas", "caffeine-sensitivity-app", "app.js")));
});
