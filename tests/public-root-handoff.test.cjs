"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ROOT = "https://labdam.kr";
const LEGACY = "https://haru-today.github.io";
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev";
async function load() { return import("../scripts/check-public-root-handoff.mjs"); }
function fakeFetch(changes = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    if (changes[url]) return changes[url];
    const u = new URL(url);
    if (u.origin === LEGACY && ["/", "/caffeine-atlas/"].includes(u.pathname)) {
      return new Response(null, { status: 301, headers: { Location: ROOT + u.pathname } });
    }
    if (u.origin === ROOT && u.pathname === "/") {
      return new Response('<meta name="robots" content="noindex,nofollow">' +
        '<h1>검진 결과, 내 결과지 기준으로 보세요</h1>' +
        '<a href="' + WORKER + '/labinsight/">리포담</a>', { status: 200 });
    }
    if (u.origin === ROOT && u.pathname === "/labinsight/") {
      return new Response('<meta name="robots" content="noindex,nofollow">' +
        '<a href="' + WORKER + '/labinsight/">REPODAM</a>', { status: 200 });
    }
    if (u.origin === ROOT && u.pathname === "/labinsight/app.js") return new Response(null, { status: 404 });
    if (u.origin === ROOT && u.pathname.startsWith("/caffeine-atlas/")) return new Response("", { status: 200 });
    if (u.origin === WORKER && u.pathname === "/") return new Response(null,{status:303,headers:{Location:WORKER+'/login.html?next=%2Flabinsight%2F','Cache-Control':'no-store'}});
    if (u.origin === WORKER && u.pathname === "/labinsight/") return new Response(null, { status: 303,
      headers: { Location: WORKER + "/login.html?next=%2Flabinsight%2F", "Cache-Control": "no-store" }
    });
    if (u.origin === WORKER && u.pathname === "/labinsight/app.js") return new Response("", {
      status: 401, headers: { "Cache-Control": "private, no-store" }
    });
    if (u.origin === WORKER && u.pathname === "/login.html") return new Response("", { status: 200 });
    throw Error("Unexpected route");
  };
}
test("root homepage, private Worker and Caffeine public demo all pass anonymous checks", async () => {
  const { inspectPublicEntry, CHECKS } = await load();
  assert.equal(CHECKS.length, 11);
  const a = await inspectPublicEntry(fakeFetch());
  assert.equal(a.ok, true, JSON.stringify(a.results.filter(x => !x.ok)));
});
test("a root that is not the LABDAM homepage is detected, even if Worker itself is secure", async () => {
  const { inspectPublicEntry } = await load();
  const a = await inspectPublicEntry(fakeFetch({
    [ROOT + "/"]: new Response('<main>old portal</main>', { status: 200 })
  }));
  assert.equal(a.ok, false);
  assert.equal(a.results[0].detail, "public-root-home-mismatch");
});
test("an old QR redirect to the wrong destination fails", async () => {
  const { inspectPublicEntry } = await load();
  const a = await inspectPublicEntry(fakeFetch({
    [LEGACY + "/caffeine-atlas/"]: new Response(null, { status: 301, headers: { Location: ROOT + "/" } })
  }));
  assert.equal(a.ok, false);
  assert.equal(a.results.find(x => x.origin === "legacy" && x.path === "/caffeine-atlas/").detail, "legacy-redirect-mismatch");
});
test("private file exposure and Caffeine QR regression fail independently", async () => {
  const { inspectPublicEntry } = await load();
  const a = await inspectPublicEntry(fakeFetch({
    [WORKER + "/labinsight/app.js"]: new Response("leak", { status: 200 }),
    [ROOT + "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html"]: new Response(null, { status: 404 })
  }));
  assert.equal(a.ok, false);
  assert.equal(a.results.filter(x => !x.ok).length, 2);
  assert.doesNotMatch(JSON.stringify(a), /leak/);
});


test("scheduled public-root guard runs daily without credentials, writes or deployments", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(".github/workflows/public-root-handoff-audit.yml", "utf8");
  assert.match(src, /schedule:\s*\n\s*- cron: '17 23 \* \* \*'/);
  assert.match(src, /workflow_dispatch:/);
  assert.match(src, /contents: read/);
  assert.match(src, /run: node scripts\/check-public-root-handoff\.mjs/);
  assert.doesNotMatch(src, /wrangler|CLOUDFLARE_API_TOKEN|secrets\.|(?:POST|PUT|DELETE) /);
});
