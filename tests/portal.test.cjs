"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");

test("LABDAM and Personal Health Atlas are one integrated portal", () => {
  assert.match(html, /LABDAM 랩담 \| 개인 건강 통합 포털/);
  assert.match(html, /LABDAM\(랩담\)은 <strong>Personal Health Atlas 통합 포털<\/strong>/);
  assert.match(html, /LABDAM의 두 가지 서비스/);
  assert.doesNotMatch(html, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/">통합 포털 바로가기/);
});

test("exactly two downstream service sites are linked from the sole portal", () => {
  assert.match(html, /href="https:\/\/haru-today\.github\.io\/labinsight\/">LabInsight 이용하기/);
  assert.match(html, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/">Caffeine Atlas 이용하기/);
  const links = [...html.matchAll(/href="(https:\/\/haru-today\.github\.io\/[^"]+)"/g)].map(x => x[1]);
  assert.ok(links.every(href => href === "https://haru-today.github.io/labinsight/" ||
    href === "https://haru-today.github.io/caffeine-atlas/"));
});

test("canonical and both prior search ownership tags remain valid", () => {
  assert.match(html, /rel="canonical" href="https:\/\/haru-today\.github\.io\/"/);
  assert.match(html, /name="naver-site-verification"/);
  assert.match(html, /name="google-site-verification"/);
  assert.match(fs.readFileSync("robots.txt", "utf8"), /sitemap/i);
  assert.match(fs.readFileSync("sitemap.xml", "utf8"), /haru-today\.github\.io/);
});


test("portal links to privacy and service notices", () => {
  assert.match(html, /href="\/privacy\.html"/);
  assert.match(html, /href="\/terms\.html"/);
  const privacy = fs.readFileSync("privacy.html", "utf8");
  const terms = fs.readFileSync("terms.html", "utf8");
  assert.match(privacy, /Google Apps Script/);
  assert.match(privacy, /Google Sheets/);
  assert.match(privacy, /sessionStorage/);
  assert.match(privacy, /보유기간/);
  assert.match(privacy, /책임자/);
  assert.match(terms, /의료.*한계|의료.*진단|의료.*유전자/);
  assert.match(terms, /개인정보 처리 안내/);
});

test("no false claim of completed legal compliance or automatic cloud deletion", () => {
  const privacy = fs.readFileSync("privacy.html", "utf8");
  assert.match(privacy, /자동 삭제/);
  assert.match(privacy, /확인하지 못했습니다|확인되지 않았습니다|확인이 필요합니다/);
  assert.match(privacy, /미확정|확정되지 않았습니다/);
  assert.doesNotMatch(privacy, /개인정보 안전성 인증 완료/);
});

test("mobile and keyboard navigation remain accessible", () => {
  assert.match(html, /href="#main"/);
  assert.match(html, /id="main"/);
  assert.match(html, /aria-label="주요 메뉴"/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /\.topnav a\{min-height:44px\}/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /건강검진 수치 입력·해석/);
});

test("sitemap lists exactly three canonical service endpoints, excluding redirect and private screens", () => {
  const map = fs.readFileSync("sitemap.xml", "utf8");
  const entries = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(entries, [
    "https://haru-today.github.io/",
    "https://haru-today.github.io/caffeine-atlas/caffeine-sensitivity-app/index.html",
    "https://haru-today.github.io/labinsight/"
  ]);
  assert.doesNotMatch(map, /\/privacy\.html|\/report\.html|\/checkup\.html/);
});
