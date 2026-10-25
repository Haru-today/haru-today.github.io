"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev/";
const EMAIL = "mailto:jleegenomics@gmail.com";

test("public homepage keeps one contact address and the approved users' login entry", () => {
  assert.match(html, /LABDAM/);
  assert.ok(html.includes('href="' + EMAIL + '"'));
  assert.ok(html.includes('href="' + WORKER + 'login.html"'));
  assert.ok(html.includes('name="robots" content="noindex,nofollow"'));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
  assert.doesNotMatch(html, /href="https:\/\/haru-today\.github\.io\/labinsight\//);
  const mails = [...html.matchAll(/mailto:([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(mails)], ["jleegenomics@gmail.com"]);
});

test("no health form, script or private portal content remains on publicly readable index", () => {
  assert.doesNotMatch(html, /<(?:form|input|script)\b/i);
  assert.doesNotMatch(html, /class="service-card"|id="services"|id="technology"/);
  assert.doesNotMatch(html, /검사값 정리 미리보기|결과 리포트 해석|가상 예시 리포트/);
  assert.doesNotMatch(html, /\/labinsight\/app\.js/);
  assert.ok(Buffer.byteLength(html, "utf8") < 20000);
});

test("Caffeine Atlas stays a separate public project and search rules do not block its QR", () => {
  assert.match(html, /href="https:\/\/haru-today\.github\.io\/caffeine-atlas\/caffeine-sensitivity-app\/index\.html"/);
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

test("homepage remains keyboard accessible", () => {
  assert.match(html, /href="#main"/);
  assert.match(html, /id="main"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /min-height:52px/);
});
