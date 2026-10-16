"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ROOT = "https://haru-today.github.io";
const WORKER = "https://labdam-free-approval.jleegenomics.workers.dev";
async function load() { return import("../scripts/check-public-root-handoff.mjs"); }
function fakeFetch(changes = {}) {
  return async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "manual");
    if (changes[url]) return changes[url];
    const u = new URL(url);
    if (u.origin === ROOT && u.pathname === "/") {
      return new Response('<meta name="robots" content="noindex,nofollow">' +
        '<meta http-equiv="refresh" content="0;url=' + WORKER + '/">' +
        '<a href="' + WORKER + '/labinsight/">LabInsight</a>' +
        '<a href="' + ROOT + '/caffeine-atlas/">Caffeine</a>', { status: 200 });
    }
    if (u.origin === ROOT && u.pathname === "/labinsight/") {
      return new Response('<meta name="robots" content="noindex,nofollow">' +
        '<a href="' + WORKER + '/labinsight/">LabInsight</a>', { status: 200 });
    }
    if (u.origin === ROOT && u.pathname === "/labinsight/app.js") return new Response(null, { status: 404 });
    if (u.origin === ROOT && u.pathname.startsWith("/caffeine-atlas/")) return new Response("", { status: 200 });
    if (u.origin === WORKER && u.pathname === "/") return new Response(null, { status: 303,
      headers: { Location: WORKER + "/login.html?next=%2F", "Cache-Control": "no-store" }
    });
    if (u.origin === WORKER && u.pathname === "/labinsight/app.js") return new Response("", {
      status: 401, headers: { "Cache-Control": "private, no-store" }
    });
    if (u.origin === WORKER && u.pathname === "/login.html") return new Response("", { status: 200 });
    throw Error("Unexpected route");
  };
}
test("root handoff, private Worker and Caffeine public demo all pass anonymous checks", async () => {
  const { inspectPublicEntry, CHECKS } = await load();
  assert.equal(CHECKS.length, 8);
  const a = await inspectPublicEntry(fakeFetch());
  assert.equal(a.ok, true, JSON.stringify(a.results.filter(x => !x.ok)));
});
test("old public LABDAM portal is explicitly detected, even if Worker itself is secure", async () => {
  const { inspectPublicEntry } = await load();
  const a = await inspectPublicEntry(fakeFetch({
    [ROOT + "/"]: new Response('<main>old portal</main>', { status: 200 })
  }));
  assert.equal(a.ok, false);
  assert.equal(a.results[0].detail, "public-root-still-serves-legacy-portal");
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
