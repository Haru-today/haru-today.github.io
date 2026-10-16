"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev/";
const LAB = WORKER + "labinsight/";
const CAFFEINE = "https://haru-today.github.io/caffeine-atlas/";

test("public root only hands visitors to the actual approval-gated Worker", () => {
  assert.match(html, /LABDAM/);
  assert.match(html, /Google 로그인 및 관리자 승인/);
  assert.ok(html.includes('http-equiv="refresh" content="0;url=' + WORKER + '"'));
  assert.ok(html.includes('href="' + WORKER + '"'));
  assert.ok(html.includes('href="' + LAB + '"'));
  assert.ok(html.includes('name="robots" content="noindex,nofollow"'));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.doesNotMatch(html, /href="https:\/\/haru-today\.github\.io\/labinsight\//);
});

test("no health form or private portal content remains on publicly readable index", () => {
  assert.doesNotMatch(html, /<(?:form|input|script)\b/i);
  assert.doesNotMatch(html, /class="service-card"|id="services"|id="about"|id="technology"/);
  assert.doesNotMatch(html, /검사값 정리 미리보기|결과 리포트 해석|가상 예시 리포트/);
  assert.ok(Buffer.byteLength(html, "utf8") < 8000);
});

test("Caffeine Atlas remains public and search rules do not block its QR", () => {
  assert.ok(html.includes('href="' + CAFFEINE + '"'));
  const robots = fs.readFileSync("robots.txt", "utf8");
  const map = fs.readFileSync("sitemap.xml", "utf8");
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Sitemap:/);
  assert.match(map, /caffeine-atlas\/caffeine-sensitivity-app\/index\.html/);
  assert.doesNotMatch(map, /<loc>https:\/\/haru-today\.github\.io\/<\/loc>/);
  assert.doesNotMatch(map, /labinsight|workers\.dev/);
});

test("public privacy pages and verification metadata remain available", () => {
  assert.match(html, /name="naver-site-verification"/);
  assert.match(html, /name="google-site-verification"/);
  assert.match(html, /href="\/privacy\.html"/);
  assert.match(html, /href="\/terms\.html"/);
  const privacy = fs.readFileSync("privacy.html", "utf8");
  const terms = fs.readFileSync("terms.html", "utf8");
  assert.match(privacy, /Google Apps Script/);
  assert.match(privacy, /Google Sheets/);
  assert.match(privacy, /보유기간/);
  assert.match(terms, /의료.*한계|의료.*진단|의료.*유전자/);
});

test("new gateway remains keyboard and mobile accessible", () => {
  assert.match(html, /href="#main"/);
  assert.match(html, /id="main"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media\(max-width:440px\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /이미 로그인한 경우 별도 인증 없이/);
});
