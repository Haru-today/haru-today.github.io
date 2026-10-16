"use strict";
// Local workerd + real D1 binding. All Google responses and identities are synthetic.
// No cloud credentials, outgoing network, deployment or remote D1 access.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const root = resolve(__dirname, "../..");
const origin = "https://labdam-test.workers.dev";
const client = "123456789-test.apps.googleusercontent.com";
const sub = "123456789012345678901";
const adminSub = "987654321098765432109";
const hash = s => createHash("sha256").update(s).digest("hex");
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "local-google-test", use: "sig", alg: "RS256" };
let mf, db, providerMode, identity, outboundCalls;
const now = () => Math.floor(Date.now() / 1000);
async function outbound(request) {
  const url = new URL(request.url);
  outboundCalls.push(url.origin + url.pathname);
  if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
    if (providerMode === "keys-redirect") return new Response(null, { status: 302, headers: { Location: "https://unexpected.invalid/" } });
    return Response.json({ keys: [jwk] });
  }
  if (url.href !== "https://oauth2.googleapis.com/token") throw Error("Unexpected external destination blocked");
  if (providerMode === "token-redirect") return new Response(null, { status: 307, headers: { Location: "https://unexpected.invalid/" } });
  const params = new URLSearchParams(await request.text());
  assert.equal(params.get("client_id"), client);
  assert.equal(params.get("redirect_uri"), origin + "/auth/callback");
  assert.equal(params.get("grant_type"), "authorization_code");
  assert.equal(createHash("sha256").update(params.get("code_verifier")).digest("base64url"), identity.challenge);
  // oauth_states DELETE RETURNING must consume the state before token exchange.
  assert.equal((await db.prepare("SELECT count(*) AS n FROM oauth_states").first()).n, 0);
  const claims = { iss: "https://accounts.google.com", aud: client, sub: identity.sub,
    email: identity.email, email_verified: true, nonce: identity.nonce,
    iat: now(), exp: now() + 3600, name: "Synthetic local member" };
  const content = b64({ alg: "RS256", kid: jwk.kid }) + "." + b64(claims);
  return Response.json({ id_token: content + "." + sign("RSA-SHA256", Buffer.from(content), privateKey).toString("base64url") });
}
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ name: "labdam", modules: true, modulesRoot: root,
    scriptPath: resolve(root, "worker.mjs"),
    compatibilityDate: "2026-10-14", host: "127.0.0.1",
    bindings: { AUTH_ORIGIN: origin, GOOGLE_CLIENT_ID: client,
      GOOGLE_CLIENT_SECRET: "synthetic-secret-never-a-real-client", RATE_LIMIT_SECRET: "local-synthetic-rate-limit-secret-32-characters",
      BOOTSTRAP_ADMIN_EMAIL: "labdam.synthetic.admin@gmail.com" },
    d1Databases: { DB: "local-only-membership" }, outboundService: outbound,
    assets: { directory: resolve(root, "dist"), binding: "ASSETS", run_worker_first: true,
      routerConfig: { has_user_worker: true } }
  }));
  db = await mf.getD1Database("DB");
  const sql = readFileSync(resolve(root, "migrations/0001_initial.sql"), "utf8").replace(/--[^\n]*/g, "");
  for (const statement of sql.split(";").filter(s => s.trim())) await db.prepare(statement).run();
});
after(async () => { if (mf) await mf.dispose(); });
beforeEach(async () => {
  for (const table of ["sessions", "members", "oauth_states", "login_throttle"]) await db.prepare("DELETE FROM " + table).run();
  providerMode = "ok"; outboundCalls = [];
});
async function request(path, cookie = "", method = "GET", body, csrf) {
  const headers = { Cookie: cookie, "CF-Connecting-IP": "192.0.2.4" };
  if (body !== undefined) Object.assign(headers, { "Content-Type": "application/json", Origin: origin, "X-CSRF-Token": csrf || "" });
  return mf.dispatchFetch(origin + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
}
async function login(admin = false) {
  const start = await request("/auth/start?next=%2Flabinsight%2F");
  assert.equal(start.status, 302, start.status === 302 ? undefined : await start.text());
  const location = new URL(start.headers.get("location"));
  identity = { sub: admin ? adminSub : sub, email: admin ? "labdam.synthetic.admin@gmail.com" : "applicant@example.invalid",
    nonce: location.searchParams.get("nonce"), challenge: location.searchParams.get("code_challenge") };
  const state = location.searchParams.get("state");
  const path = "/auth/callback?code=SYNTHETIC_LOCAL_CODE&state=" + state;
  const oauthCookie = "__Host-labdam_oauth_state=" + state;
  const response = await request(path, oauthCookie);
  const cookies = response.headers.getSetCookie();
  const cookie = cookies.find(c => c.startsWith("__Host-labdam_session="))?.split(";")[0];
  return { response, cookie, path, oauthCookie };
}
async function review(admin, status, candidate = sub) {
  const me = await (await request("/api/me", admin.cookie)).json();
  return request("/api/admin/review", admin.cookie, "POST", { google_sub: candidate, status }, me.csrf);
}
test("real D1 recovers a previously pending verified bootstrap operator", async () => {
  await db.prepare(
    "INSERT INTO members(google_sub,email,display_name,status,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(adminSub, "labdam.synthetic.admin@gmail.com", "Operator awaiting setup",
    "pending", "member", now()-100, now()-100).run();
  const admin = await login(true);
  assert.equal(admin.response.status, 303);
  assert.equal(new URL(admin.response.headers.get("location")).pathname, "/labinsight/");
  const member = await db.prepare("SELECT status,role FROM members WHERE google_sub=?").bind(adminSub).first();
  assert.deepEqual({ status: member.status, role: member.role }, { status: "approved", role: "admin" });
  assert.equal((await request("/admin.html", admin.cookie)).status, 200);
});

test("real D1 prevents bootstrap promotion of a rejected account", async () => {
  await db.prepare(
    "INSERT INTO members(google_sub,email,display_name,status,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(adminSub, "labdam.synthetic.admin@gmail.com", "Rejected synthetic operator",
    "rejected", "member", now()-100, now()-100).run();
  const loginResult = await login(true);
  assert.equal(loginResult.response.status, 303);
  assert.equal(new URL(loginResult.response.headers.get("location")).pathname, "/pending.html");
  const member = await db.prepare("SELECT status,role FROM members WHERE google_sub=?").bind(adminSub).first();
  assert.deepEqual({ status: member.status, role: member.role }, { status: "rejected", role: "member" });
});

test("workerd OAuth + D1: pending, shared approval, revocation, rejection and fresh login", async () => {
  const admin = await login(true);
  assert.equal(admin.response.status, 303);
  const applicant = await login();
  assert.equal(applicant.response.status, 303);
  assert.equal(new URL(applicant.response.headers.get("location")).pathname, "/pending.html");
  assert.equal((await request("/labinsight/app.js", applicant.cookie)).status, 403);
  assert.equal((await request(applicant.path, applicant.oauthCookie)).status, 400);
  assert.equal((await review(admin, "approved")).status, 200);
  for (const path of ["/", "/labinsight/", "/labinsight/app.js", "/labinsight/carepath.html", "/labinsight/carepath.js", "/labinsight/carepath-data.js"]) {
    const response = await request(path, applicant.cookie);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  assert.equal((await review(admin, "pending")).status, 200);
  assert.equal((await request("/labinsight/app.js", applicant.cookie)).status, 401);
  assert.equal((await review(admin, "approved")).status, 200);
  assert.equal((await request("/labinsight/app.js", applicant.cookie)).status, 401);
  const approved = await login();
  assert.equal((await request("/labinsight/app.js", approved.cookie)).status, 200);
  assert.equal((await review(admin, "rejected")).status, 200);
  const rejected = await login();
  assert.equal((await request("/labinsight/app.js", rejected.cookie)).status, 403);
  assert.equal((await review(admin, "approved")).status, 200);
  assert.equal((await request("/labinsight/app.js", rejected.cookie)).status, 401);
  assert.equal((await review(admin, "rejected", adminSub)).status, 404);
  assert.equal((await request("/admin.html", admin.cookie)).status, 200);
});
test("two independent member sessions cannot regain protected CarePath access after revoke and re-approval", async () => {
  const admin = await login(true);
  const first = await login();
  const second = await login();
  assert.ok(first.cookie && second.cookie && first.cookie !== second.cookie,
    "each OAuth login must issue an independent session");
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE google_sub=?").bind(sub).first()).n, 2);

  for (const cookie of [first.cookie, second.cookie]) {
    assert.equal((await request("/labinsight/carepath.html", cookie)).status, 303);
    assert.equal((await request("/labinsight/carepath.js", cookie)).status, 403);
    assert.equal((await request("/api/admin/applications", cookie)).status, 403);
  }
  assert.equal((await review(admin, "approved")).status, 200);

  for (const cookie of [first.cookie, second.cookie]) {
    assert.equal((await request("/labinsight/carepath.html", cookie)).status, 200);
    assert.equal((await request("/labinsight/carepath-data.js", cookie)).status, 200);
    assert.equal((await request("/admin.html", cookie)).status, 403);
    assert.equal((await request("/api/admin/applications", cookie)).status, 403);
    const me = await (await request("/api/me", cookie)).json();
    assert.equal(me.role, "member");
    assert.equal((await request("/api/admin/review", cookie, "POST",
      { google_sub: sub, status: "approved" }, me.csrf)).status, 403);
  }
  // This is the key safety condition: revocation invalidates every outstanding
  // cookie, not just the single tab used for the user's real-account QA.
  assert.equal((await review(admin, "pending")).status, 200);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE google_sub=?").bind(sub).first()).n, 0);
  for (const cookie of [first.cookie, second.cookie]) {
    assert.equal((await request("/api/me", cookie)).status, 401);
    assert.equal((await request("/labinsight/carepath.html", cookie)).status, 303);
    assert.equal((await request("/labinsight/carepath.js", cookie)).status, 401);
  }
  // Re-approval must not resurrect a server session deleted by revocation.
  assert.equal((await review(admin, "approved")).status, 200);
  for (const cookie of [first.cookie, second.cookie]) {
    assert.equal((await request("/api/me", cookie)).status, 401);
    assert.equal((await request("/labinsight/carepath-data.js", cookie)).status, 401);
  }
  const fresh = await login();
  assert.ok(fresh.cookie && ![first.cookie, second.cookie].includes(fresh.cookie));
  assert.equal((await request("/labinsight/carepath.html", fresh.cookie)).status, 200);
  assert.equal((await request("/api/admin/applications", fresh.cookie)).status, 403);
});

test("approved member cannot access administrator routes through GET, HEAD or approval API", async () => {
  const operator = await login(true);
  const applicant = await login();
  assert.equal((await review(operator, "approved")).status, 200);
  assert.equal((await request("/labinsight/", applicant.cookie)).status, 200,
    "approved members should still have access to the requested health-check service");

  for (const target of ["/admin", "/admin.html"]) {
    for (const method of ["GET", "HEAD"]) {
      const result = await request(target, applicant.cookie, method);
      assert.equal(result.status, 403, method + " " + target);
      if (method === "GET") {
        const body = await result.json();
        assert.equal(body.code, "ADMIN_ONLY");
        assert.equal(body.ok, false);
        assert.equal(JSON.stringify(body).includes("members"), false);
      }
    }
  }

  const applications = await request("/api/admin/applications", applicant.cookie);
  assert.equal(applications.status, 403);
  assert.deepEqual(await applications.json(), { ok: false, code: "ADMIN_ONLY" });

  const profile = await (await request("/api/me", applicant.cookie)).json();
  assert.equal(profile.role, "member");
  const forgedReview = await request("/api/admin/review", applicant.cookie, "POST",
    { google_sub: sub, status: "approved" }, profile.csrf);
  assert.equal(forgedReview.status, 403);
  assert.deepEqual(await forgedReview.json(), { ok: false, code: "ADMIN_ONLY" });

  // The approved operator retains access, proving the denial is role-specific,
  // not an outage or a blanket removal of administrator functionality.
  assert.equal((await request("/admin.html", operator.cookie)).status, 200);
  assert.equal((await request("/api/admin/applications", operator.cookie)).status, 200);
});

test("real D1 rolls back session deletion when the membership update fails", async () => {
  const admin = await login(true), applicant = await login();
  await review(admin, "approved");
  await db.prepare("CREATE TRIGGER fail_review BEFORE UPDATE OF status ON members BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run();
  try {
    assert.equal((await review(admin, "rejected")).status, 503);
    assert.equal((await db.prepare("SELECT status FROM members WHERE google_sub=?").bind(sub).first()).status, "approved");
    assert.equal((await request("/labinsight/app.js", applicant.cookie)).status, 200);
  } finally { await db.prepare("DROP TRIGGER fail_review").run(); }
});
test("real D1 rolls back signup when session creation fails", async () => {
  await db.prepare("CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run();
  try {
    const applicant = await login();
    assert.equal(applicant.response.status, 503);
    assert.equal(applicant.cookie, undefined);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM members").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions").first()).n, 0);
    assert.equal((await request(applicant.path, applicant.oauthCookie)).status, 400);
  } finally { await db.prepare("DROP TRIGGER fail_session").run(); }
});
test("concurrent D1 reviews cannot revive a session deleted by a downgrade", async () => {
  const admin = await login(true), applicant = await login();
  await review(admin, "approved");
  const responses = await Promise.all(["pending", "approved", "rejected", "approved"].map(status => review(admin, status)));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE google_sub=?").bind(sub).first()).n, 0);
  assert.equal((await request("/labinsight/app.js", applicant.cookie)).status, 401);
});
test("workerd never follows token or JWKS redirects and clears failed OAuth cookies", async () => {
  for (const mode of ["token-redirect", "keys-redirect"]) {
    providerMode = mode;
    const result = await login();
    assert.equal(result.response.status, 503);
    assert.match(result.response.headers.get("set-cookie"), /__Host-labdam_oauth_state=;.*Max-Age=0/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions").first()).n, 0);
    assert.equal((await request(result.path, result.oauthCookie)).status, 400);
  }
  assert.ok(outboundCalls.every(u => u.startsWith("https://oauth2.googleapis.com/") || u.startsWith("https://www.googleapis.com/")));
});
test("real D1 session expiry, CSRF and account deletion block protected assets", async () => {
  const admin = await login(true), applicant = await login();
  await review(admin, "approved");
  const me = await (await request("/api/me", applicant.cookie)).json();
  assert.equal((await request("/api/admin/review", applicant.cookie, "POST", { google_sub: sub, status: "approved" }, me.csrf)).status, 403);
  assert.equal((await request("/api/account/delete", applicant.cookie, "POST", {}, "bad-csrf")).status, 403);
  await db.prepare("UPDATE sessions SET expires_at=? WHERE google_sub=?").bind(now() - 1, sub).run();
  assert.equal((await request("/api/me", applicant.cookie)).status, 401);
  assert.equal((await request("/", applicant.cookie)).status, 303);
  const fresh = await login();
  const freshMe = await (await request("/api/me", fresh.cookie)).json();
  assert.equal((await request("/auth/logout", fresh.cookie, "POST", {}, freshMe.csrf)).status, 303);
  assert.equal((await request("/labinsight/app.js", fresh.cookie)).status, 401);
  const finalLogin = await login();
  const finalMe = await (await request("/api/me", finalLogin.cookie)).json();
  assert.equal((await request("/api/account/delete", finalLogin.cookie, "POST", {}, finalMe.csrf)).status, 200);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sessions WHERE google_sub=?").bind(sub).first()).n, 0);
  assert.equal((await request("/labinsight/app.js", finalLogin.cookie)).status, 401);
});
test("actual asset binding stays behind the anonymous gate and Caffeine Atlas is excluded", async () => {
  for (const path of ["/", "/labinsight/", "/labinsight/report.html", "/labinsight/carepath.html"]) assert.equal((await request(path)).status, 303);
  for (const path of ["/labinsight/app.js", "/labinsight/carepath.js", "/labinsight/carepath-data.js", "/labinsight/service-worker.js", "/assets/portal-redesign.css"]) assert.equal((await request(path)).status, 401);
  for (const path of ["/login.html", "/pending.html", "/membership-privacy.html"]) assert.equal((await request(path)).status, 200);
  assert.equal((await request("/caffeine-atlas/")).status, 404);
});
