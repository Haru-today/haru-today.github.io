"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");

test("the old public landing is replaced by the explicit Google approval gateway", () => {
  assert.match(html, /랩담 홈페이지로 이동합니다/);
  assert.match(html, /관리자 승인 후 이용/);
  assert.match(html, /http-equiv="refresh" content="0;url=https:\/\/labdam-free-approval\.jleegenomics\.workers\.dev\/"/);
  assert.doesNotMatch(html, /class="hero-grid"|class="service-card"|id="services"|class="atlas-board"/);
});

test("public gateway visually supports small screens, accessible focus and reduced motion", () => {
  assert.match(html, /width:min\(560px,calc\(100% - 32px\)\)/);
  assert.match(html, /@media\(max-width:440px\)/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /lang="ko"/);
  assert.match(html, /<main id="main">/);
});

test("no login bypass is advertised and Caffeine remains an explicit public exception", () => {
  assert.match(html, /LABDAM 홈페이지 열기/);
  assert.match(html, /REPODAM 바로가기/);
  assert.match(html, /Caffeine Atlas는/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(links.includes("https://haru-today.github.io/caffeine-atlas/"));
  assert.doesNotMatch(html, /임상적 효능 입증 완료|법적 준수 인증 완료|FDA 인증 완료/);
});
