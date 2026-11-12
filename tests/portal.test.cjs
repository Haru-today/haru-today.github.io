'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const html = fs.readFileSync('index.html', 'utf8');
const worker = 'https://repodam.labdam.kr/labinsight/';

test('homepage keeps service links and search verification', () => {
  for (const href of [worker, 'https://prodam.labdam.kr/', 'https://haru-today.github.io/caffeine-atlas/', 'https://labdam.site.aiapp.help/guide', 'mailto:jleegenomics@gmail.com']) assert.ok(html.includes('href="' + href + '"'), href);
  for (const value of ['b91d0554dc2db700b9e1128063dc6e5255500209','0f44c35ebff0b9388c37a766a57761ba04ae667e','f8IRcs_BDrorzy2olPv6CSuczflLcqPE7jSaMZ_Q1dQ','F5N4YM7fMZamidp9YHlqnddNVQ5JsWWjJSiJeX_D-G8']) assert.ok(html.includes(value));
  assert.match(html, /rel="canonical" href="https:\/\/labdam\.kr\/"/);
  assert.match(fs.readFileSync('sitemap.xml','utf8'), /caffeine-atlas\/caffeine-sensitivity-app\/index\.html/);
  assert.doesNotMatch(fs.readFileSync('sitemap.xml','utf8'), /labinsight|workers\.dev/);
  assert.deepEqual([...new Set([...html.matchAll(/mailto:([^"\s]+)/g)].map(match=>match[1]))], ['jleegenomics@gmail.com']);
  assert.ok(fs.existsSync('privacy.html') && fs.existsSync('terms.html'));
});

test('homepage has no data entry and the single presentation script is integrity-pinned', () => {
  assert.doesNotMatch(html, /<(?:form|input|textarea|select|iframe|object|embed|base)\b/i);
  assert.doesNotMatch(html, /[\s"'\/]on[a-z]+\s*=|javascript\s*:/i);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'/);
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(x=>x[0]);
  assert.equal(scripts.length,2);
  assert.equal(scripts.filter(x=>x === '<script type="application/ld+json">').length,1);
  const code = fs.readFileSync('assets/aiapp-exact/home.js');
  const digest=crypto.createHash('sha256').update(code).digest('base64');
  assert.ok(scripts.includes('<script src="/assets/aiapp-exact/home.js" integrity="sha256-'+digest+'" defer>'));
  assert.doesNotMatch(code.toString(), /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|eval|localStorage|sessionStorage|postMessage)\b|document\.cookie|innerHTML|\bimport\s*\(/);
  assert.doesNotMatch(html, /<link\b[^>]*rel="stylesheet"[^>]*href="https?:|<img\b[^>]*src="https?:/i);
});
