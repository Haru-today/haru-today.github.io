"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");

test("the root is the LABDAM one-page homepage, not a redirect", () => {
  assert.match(html, /검진 결과, 내 결과지 기준으로 보세요/);
  assert.match(html, /임상병리학 전공자가 만듭니다/);
  assert.match(html, /랩담의 첫 서비스입니다/);
  assert.match(html, /출시 준비 중/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.doesNotMatch(html, /class="hero-grid"|class="service-card"|id="services"|class="atlas-board"/);
});

test("homepage copy follows the LABDAM wording rules", () => {
  assert.doesNotMatch(html, /임상병리사가|곧 출시|최초|혁신적인|완치|정상이에요|위험해요/);
  assert.doesNotMatch(html, /Labdam|LabDam|랩 담|랩담앱|LabInsight/);
  assert.doesNotMatch(html, /임상적 효능 입증 완료|법적 준수 인증 완료|FDA 인증 완료/);
  assert.match(html, /의료 진단을 대신하지 않습니다/);
});

test("homepage supports small screens, dark mode, accessible focus and reduced motion", () => {
  assert.match(html, /max-width:480px/);
  assert.match(html, /@media\(prefers-color-scheme:dark\)/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /lang="ko"/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<img class="logo" src="\/assets\/labdam-logo\.svg" alt="LABDAM"/);
});

test("brand fonts are self-hosted subsets, no third-party font requests", () => {
  const faces = [...html.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
  assert.equal(faces.length, 4);
  for (const face of faces) {
    assert.match(face, /^\/assets\/fonts\/[\w-]+-home\.woff2$/);
    const size = fs.statSync(face.slice(1)).size;
    assert.ok(size < 80000, face + " should stay a page subset");
  }
  assert.doesNotMatch(html, /fonts\.googleapis|jsdelivr|unpkg|cdnjs/);
});
