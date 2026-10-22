"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("assets/portal-redesign.css", "utf8");

test("redesign preserves LABDAM single portal and exactly two products", () => {
  assert.match(html, /Personal Health Atlas 통합 포털/);
  assert.match(html, /id="services"/);
  assert.equal((html.match(/class="service-card"/g)||[]).length, 2);
  assert.match(html, /REPODAM 이용하기/);
  assert.match(html, /Caffeine Atlas 이용하기/);
  assert.match(html, /href="https:\/\/haru-today.github.io\/labinsight\/"/);
  assert.match(html, /href="https:\/\/haru-today.github.io\/caffeine-atlas\/"/);
});
test("redesign remains accessible and responsive", () => {
  assert.match(html, /href="#main"/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /aria-labelledby="main-title"/);
  assert.match(html, /aria-label="주요 메뉴"/);
  assert.match(html, /role="img" aria-label=/);
  assert.match(css, /@media\(max-width:660px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.topnav a\{min-height:44px\}/);
});
test("redesign does not invent medical or legal certification", () => {
  assert.match(html, /의료 진단을 대체하지 않습니다/);
  assert.match(html, /안전 섭취량을 확정하지 않습니다/);
  assert.match(html, /민감정보/);
  assert.doesNotMatch(html, /임상적 효능 입증 완료|법적 준수 인증 완료|FDA 인증 완료/);
});
test("redesign retains SEO, privacy and feedback routes", () => {
  assert.match(html, /name="google-site-verification"/);
  assert.match(html, /name="naver-site-verification"/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /href="\/assets\/portal-redesign.css\?v=service-paths-20261014"/);
  assert.match(html, /href="\/privacy.html"/);
  assert.match(html, /href="\/terms.html"/);
  assert.match(html, /github.com\/Haru-today\/haru-today.github.io\/issues\/new/);
});

test("home offers two clear service starts while keeping symposium demo public", () => {
  assert.match(html, /aria-label="두 서비스 바로 시작"/);
  const start = html.slice(html.indexOf('<nav class="hero-quick-entry"'), html.indexOf('</nav>', html.indexOf('<nav class="hero-quick-entry"')));
  assert.match(start, /href="https:\/\/haru-today\.github\.io\/labinsight\/"/);
  assert.match(start, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/"/);
  assert.match(start, /건강검진 결과 입력/);
  assert.match(start, /로그인 없이 공개 체험/);
  assert.equal((start.match(/<a /g) || []).length, 2);
  assert.match(html, /회원가입 없이 4개 SNP/);
  assert.match(html, /실제 결과지를 보며 수치를 입력/);
  assert.match(css, /\.hero-quick-entry/);
  assert.match(css, /@media\(max-width:350px\)/);
});
