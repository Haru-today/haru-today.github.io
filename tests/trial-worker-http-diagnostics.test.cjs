"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function load() { return import("../scripts/trial-worker-http-diagnostics.mjs"); }
const COOKIE_POLICY = { "Cache-Control": "private, no-store" };
function responses(override = {}) {
  return async (url, request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "manual");
    assert.equal(request.headers["Cache-Control"], "no-cache");
    const path = new URL(url).pathname;
    const opts = override[path];
    if (opts === "NETWORK") throw Error("Synthetic network failure");
    if (opts) return opts;
    if (path === "/healthz") return new Response(JSON.stringify({
      service: "labdam-free-auth", readiness: "bindings-present"
    }), { status: 200, headers: { ...COOKIE_POLICY, "Content-Type": "application/json" } });
    if (path.startsWith("/caffeine-atlas/") || ["/", "/login.html", "/pending.html"].includes(path)) {
      return new Response(null, { status: 200 });
    }
    if (["/labinsight/", "/labinsight/report.html"].includes(path)) {
      return new Response(null, { status: 303, headers: { ...COOKIE_POLICY,
        "Location": "https://labdam-free-approval.jleegenomics.workers.dev/?next=%2Flabinsight%2F#login" } });
    }
    return new Response(null, { status: 401, headers: COOKIE_POLICY });
  };
}

test("anonymous diagnostics prove readiness, protected routes and poster URLs without authentication", async () => {
  const { auditTrialAnonymous, CASES } = await load();
  assert.equal(CASES.length, 12);
  const report = await auditTrialAnonymous(responses());
  assert.equal(report.ok, true);
  assert.equal(report.results.length, CASES.length);
  assert.equal(report.results.filter(x => !x.ok).length, 0);
});

test("health failure is surfaced without printing credentials or reading member records", async () => {
  const { auditTrialAnonymous } = await load();
  const down = await auditTrialAnonymous(responses({"/healthz": new Response(null,{status:503})}));
  assert.equal(down.ok, false);
  assert.deepEqual(down.results[0].actual, 503);
  assert.equal(down.results[0].detail, "not-ready");

  const stale = await auditTrialAnonymous(responses({"/healthz": new Response(
    JSON.stringify({service:"labdam-free-auth",deployment:"configured-externally"}),
    {status:200,headers:COOKIE_POLICY})}));
  assert.equal(stale.ok,false);
  assert.equal(stale.results[0].detail,"readiness-marker-missing");
  assert.equal(JSON.stringify(stale).includes("configured-externally"),false);
});

test("misrouted private pages, blocked public QR and network errors fail separately", async () => {
  const { auditTrialAnonymous } = await load();
  const bad = await auditTrialAnonymous(responses({
    "/labinsight/": new Response(null,{status:200}),
    "/caffeine-atlas/": new Response(null,{status:404}),
    "/api/me": "NETWORK"
  }));
  assert.equal(bad.ok,false);
  assert.equal(bad.results.find(x => x.path === "/labinsight/").ok,false);
  assert.equal(bad.results.find(x => x.path === "/caffeine-atlas/").ok,false);
  assert.equal(bad.results.find(x => x.path === "/api/me").detail,"network-error");
});
