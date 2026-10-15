"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { handleRequest, safeNext, purgeExpiredRecords } = require("../free-auth/worker.mjs");

const ORIGIN = "https://labdam-test.workers.dev";
const CLIENT = "1234567890-verified-web-client.apps.googleusercontent.com";
const NOW = Math.floor(Date.now() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "google-test-kid-001", alg: "RS256", use: "sig" };
const hash = value => createHash("sha256").update(value).digest("hex");
const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function signedIdToken(claims = {}) {
  const header = base64({ alg: "RS256", kid: JWK.kid, typ: "JWT" });
  const payload = base64({
    iss: "https://accounts.google.com", aud: CLIENT, sub: "123456789012345678901",
    email: "student@example.com", email_verified: true, nonce: claims.nonce,
    name: "Test Applicant", iat: NOW - 60, exp: NOW + 3600, ...claims
  });
  const data = header + "." + payload;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}
function fakeDb() {
  const members = new Map(), states = new Map(), sessions = new Map(), throttles = new Map();
  return {
    members, states, sessions, throttles,
    prepare(sql) {
      let args;
      return {
        bind(...a) { args = a; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO login_throttle")) {
            const [id, time] = args, prev = throttles.get(id);
            throttles.set(id, { window_start: time,
              attempts: prev && prev.window_start === time ? prev.attempts + 1 : 1 });
          } else if (sql.startsWith("INSERT INTO oauth_states")) {
            const [id, code_verifier, nonce, next_path, expires_at] = args;
            states.set(id, { code_verifier, nonce, next_path, expires_at });
          } else if (sql.startsWith("INSERT INTO members")) {
            const [google_sub, email, display_name, status, role, created_at, updated_at] = args;
            const previous = members.get(google_sub);
            members.set(google_sub, previous
              ? { ...previous, email, display_name, updated_at }
              : { google_sub, email, display_name, status, role, purpose: "", created_at, updated_at, reviewed_at: null });
          } else if (sql.startsWith("INSERT INTO sessions")) {
            const [token_hash, google_sub, csrf_token, expires_at, created_at] = args;
            sessions.set(token_hash, { token_hash, google_sub, csrf_token, expires_at, created_at });
          } else if (sql.startsWith("UPDATE members SET purpose")) {
            const [purpose, updated_at, google_sub] = args;
            const m = members.get(google_sub);
            if (m && m.status === "pending") Object.assign(m, { purpose, updated_at });
          } else if (sql.startsWith("DELETE FROM sessions WHERE google_sub=? AND EXISTS")) {
            const [sub, memberSub, nextStatus] = args, m = members.get(memberSub);
            if (sub === memberSub && m?.role === "member" &&
                (m.status === "rejected" || nextStatus !== "approved")) {
              for (const [key, session] of sessions) {
                if (session.google_sub === sub) sessions.delete(key);
              }
            }
          } else if (sql.startsWith("DELETE FROM sessions WHERE token_hash")) {
            sessions.delete(args[0]);
          } else if (sql.startsWith("DELETE FROM oauth_states WHERE expires_at")) {
            for (const [key, value] of states) if (value.expires_at <= args[0]) states.delete(key);
          } else if (sql.startsWith("DELETE FROM sessions WHERE expires_at")) {
            for (const [key, value] of sessions) if (value.expires_at <= args[0]) sessions.delete(key);
          } else if (sql.startsWith("DELETE FROM login_throttle WHERE window_start")) {
            for (const [key, value] of throttles) if (value.window_start < args[0]) throttles.delete(key);
          } else throw Error("Unhandled D1 run statement: " + sql);
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (sql.startsWith("SELECT attempts FROM login_throttle")) {
            return throttles.get(args[0]) || null;
          }
          if (sql.startsWith("DELETE FROM oauth_states")) {
            const [id, now] = args, data = states.get(id);
            if (!data || data.expires_at <= now) return null;
            states.delete(id);
            return data;
          }
          if (sql.startsWith("SELECT google_sub,email,display_name,status,role FROM members")) {
            return members.get(args[0]) || null;
          }
          if (sql.startsWith("SELECT s.csrf_token")) {
            const [id, now] = args, s = sessions.get(id);
            if (!s || s.expires_at <= now) return null;
            const m = members.get(s.google_sub);
            return m ? { ...m, csrf_token: s.csrf_token, expires_at: s.expires_at } : null;
          }
          if (sql.startsWith("DELETE FROM members WHERE google_sub")) {
            const record = members.get(args[0]);
            if (!record || record.role !== "member") return null;
            members.delete(args[0]);
            for (const [key, session] of sessions) {
              if (session.google_sub === args[0]) sessions.delete(key);
            }
            return { google_sub: args[0] };
          }
          if (sql.startsWith("UPDATE members SET status")) {
            const [status, updated_at, reviewed_at, reviewed_by, sub] = args;
            const m = members.get(sub);
            if (!m || m.role !== "member") return null;
            Object.assign(m, { status, updated_at, reviewed_at, reviewed_by });
            return { google_sub: sub };
          }
          throw Error("Unhandled D1 first statement: " + sql);
        },
        async all() {
          if (sql.startsWith("SELECT google_sub,email,display_name,status,role,purpose")) {
            return { results: [...members.values()].filter(m => m.role === "member") };
          }
          throw Error("Unhandled D1 all statement: " + sql);
        }
      };
    }
  };
}
function fixture() {
  const DB = fakeDb();
  const env = {
    AUTH_ORIGIN: ORIGIN, GOOGLE_CLIENT_ID: CLIENT,
    GOOGLE_CLIENT_SECRET: "fake-long-secret-for-test-only",
    RATE_LIMIT_SECRET: "a-long-secret-over-32-characters-test",
    BOOTSTRAP_ADMIN_EMAIL: "owner@example.com", DB,
    ASSETS: {
      fetch: async request => new Response("private static file: " + new URL(request.url).pathname,
        { status: 200, headers: { "Content-Type": "text/plain" } })
    }
  };
  const opts = { now: NOW, googleFetch: async url => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const onlyState = [...DB.states.values()][0];
      // The consumed state has already been deleted by this point. Tests
      // override the token fetcher before Google exchange.
      return new Response(JSON.stringify({ id_token: signedIdToken({ nonce: onlyState?.nonce || "INVALID" }) }));
    }
    throw Error("Unexpected outgoing request");
  } };
  return { env, opts, DB };
}
function req(path, { method = "GET", cookie = "", origin = "", csrf = "", body = undefined, ip = "192.0.2.1" } = {}) {
  const headers = { "CF-Connecting-IP": ip };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function seedMember(f, { sub = "123456789012345678901", email = "student@example.com", status = "approved", role = "member" } = {}) {
  const token = sub === "123456789012345678901" ? "a".repeat(64) : sub.padEnd(64, "a");
  const csrf = sub === "123456789012345678901" ? "c".repeat(64) : sub.padEnd(64, "c");
  f.DB.members.set(sub, {
    google_sub: sub, email, display_name: "Test", role, status, purpose: "",
    created_at: NOW - 500, updated_at: NOW - 500
  });
  f.DB.sessions.set(hash(token), {
    token_hash: hash(token), google_sub: sub, csrf_token: csrf,
    expires_at: NOW + 3600, created_at: NOW
  });
  return { token, csrf, cookie: "__Host-labdam_session=" + token };
}
function googleExchange(f, claims = {}, { requestedNext = "/labinsight/" } = {}) {
  let nonce;
  f.opts.googleFetch = async (url, request) => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(request.body);
      assert.equal(params.get("grant_type"), "authorization_code");
      assert.equal(params.get("client_id"), CLIENT);
      assert.equal(params.get("redirect_uri"), ORIGIN + "/auth/callback");
      assert.equal(params.get("code_verifier").length, 80);
      return new Response(JSON.stringify({ id_token: signedIdToken({ ...claims, nonce }) }), { status: 200 });
    }
    throw Error("Unexpected external request " + url);
  };
  return async () => {
    const start = await handleRequest(req("/auth/start?next=" + encodeURIComponent(requestedNext)), f.env, f.opts);
    assert.equal(start.status, 302);
    const oauthUrl = new URL(start.headers.get("location"));
    const state = oauthUrl.searchParams.get("state");
    const verifier = f.DB.states.get(hash(state));
    nonce = verifier?.nonce;
    assert.equal(oauthUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(oauthUrl.searchParams.get("scope"), "openid email profile");
    const callback = "/auth/callback?code=VALID_TEST_CODE&state=" + state;
    const browserCookie = "__Host-labdam_oauth_state=" + state;
    const result = await handleRequest(req(callback, { cookie: browserCookie }), f.env, f.opts);
    return { start, callback, browserCookie, result };
  };
}
test("anonymous visitor sees Google request page but not protected homepage, CSS or LabInsight", async () => {
  const f = fixture();
  for (const path of ["/", "/labinsight/", "/labinsight/report.html"]) {
    const res = await handleRequest(req(path), f.env, f.opts);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /\/login\.html\?next=/);
  }
  for (const path of ["/assets/portal-redesign.css", "/labinsight/app.js", "/account.html?file=x"]) {
    const res = await handleRequest(req(path), f.env, f.opts);
    if (path.startsWith("/account")) assert.equal(res.status, 303);
    else assert.equal(res.status, 401);
  }
  assert.equal((await handleRequest(req("/login.html"), f.env, f.opts)).status, 200);
  assert.equal((await handleRequest(req("/pending.html"), f.env, f.opts)).status, 200);
  assert.equal((await handleRequest(req("/membership-privacy.html"), f.env, f.opts)).status, 200);
  assert.equal((await handleRequest(req("/caffeine-atlas/"), f.env, f.opts)).status, 404);
  assert.equal((await handleRequest(req("/api/admin/applications"), f.env, f.opts)).status, 401);
});
test("approved Google member can open LABDAM homepage and LabInsight without signing in twice", async () => {
  const f = fixture(), member = seedMember(f);
  for (const path of ["/", "/index.html", "/labinsight/", "/labinsight/app.js",
    "/labinsight/report.html", "/assets/portal-redesign.css"]) {
    const res = await handleRequest(req(path, { cookie: member.cookie }), f.env, f.opts);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, max-age=0");
    assert.match(await res.text(), /private static file/);
  }
  const me = await handleRequest(req("/api/me", { cookie: member.cookie }), f.env, f.opts);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), {
    authenticated: true, email: "student@example.com", name: "Test",
    status: "approved", role: "member", csrf: "c".repeat(64)
  });
});
test("pending and rejected applicants never receive protected content, even with session", async () => {
  for (const status of ["pending", "rejected"]) {
    const f = fixture(), user = seedMember(f, { status });
    assert.equal((await handleRequest(req("/", { cookie: user.cookie }), f.env, f.opts)).status, 303);
    assert.equal((await handleRequest(req("/labinsight/app.js", { cookie: user.cookie }), f.env, f.opts)).status, 403);
    assert.equal((await handleRequest(req("/labinsight/report.html", { cookie: user.cookie }), f.env, f.opts)).status, 303);
    assert.equal((await handleRequest(req("/api/admin/applications", { cookie: user.cookie }), f.env, f.opts)).status, 403);
  }
});
test("pending applicant can submit only short optional use purpose with CSRF", async () => {
  const f = fixture(), user = seedMember(f, { status: "pending" });
  const path = "/api/application";
  assert.equal((await handleRequest(req(path, { method: "POST", cookie: user.cookie,
    origin: "https://attacker.example", csrf: user.csrf, body: { purpose: "연구" } }), f.env, f.opts)).status, 403);
  assert.equal((await handleRequest(req(path, { method: "POST", cookie: user.cookie,
    origin: ORIGIN, csrf: "f".repeat(64), body: { purpose: "연구" } }), f.env, f.opts)).status, 403);
  assert.equal((await handleRequest(req(path, { method: "POST", cookie: user.cookie,
    origin: ORIGIN, csrf: user.csrf, body: { purpose: "x".repeat(241) } }), f.env, f.opts)).status, 400);
  assert.equal((await handleRequest(req(path, { method: "POST", cookie: user.cookie,
    origin: ORIGIN, csrf: user.csrf, body: { purpose: "학부 연구 프로젝트" } }), f.env, f.opts)).status, 200);
  assert.equal(f.DB.members.get("123456789012345678901").purpose, "학부 연구 프로젝트");
});
test("only admin can review and revocation is effective on the very next request", async () => {
  const f = fixture(), admin = seedMember(f, { sub: "1111111111111111111", email: "owner@example.com", role: "admin" });
  const candidate = seedMember(f, { sub: "2222222222222222222", email: "guest@example.com", status: "pending" });
  const path = "/api/admin/review", body = { google_sub: "2222222222222222222", status: "approved" };
  assert.equal((await handleRequest(req(path, { cookie: candidate.cookie, method: "POST",
    origin: ORIGIN, csrf: candidate.csrf, body }), f.env, f.opts)).status, 403);
  const result = await handleRequest(req(path, { cookie: admin.cookie, method: "POST",
    origin: ORIGIN, csrf: admin.csrf, body }), f.env, f.opts);
  assert.equal(result.status, 200);
  assert.equal(f.DB.members.get(body.google_sub).status, "approved");
  // The same pending cookie now receives access, because the member is
  // approved in the authoritative database; no duplicate sign-in required.
  assert.equal((await handleRequest(req("/labinsight/", { cookie: candidate.cookie }), f.env, f.opts)).status, 200);
  const revoke = await handleRequest(req(path, { cookie: admin.cookie, method: "POST",
    origin: ORIGIN, csrf: admin.csrf, body: { google_sub: body.google_sub, status: "rejected" } }), f.env, f.opts);
  assert.equal(revoke.status, 200);
  assert.equal(f.DB.sessions.has(hash(candidate.token)), false);
  assert.equal((await handleRequest(req("/labinsight/app.js", { cookie: candidate.cookie }), f.env, f.opts)).status, 401);
  assert.equal((await handleRequest(req("/labinsight/", { cookie: candidate.cookie }), f.env, f.opts)).status, 303);
  const reapprove = await handleRequest(req(path, { cookie: admin.cookie, method: "POST",
    origin: ORIGIN, csrf: admin.csrf, body: { google_sub: body.google_sub, status: "approved" } }), f.env, f.opts);
  assert.equal(reapprove.status, 200);
  assert.equal((await handleRequest(req("/labinsight/app.js", { cookie: candidate.cookie }), f.env, f.opts)).status, 401);
});
test("rejected re-approval clears freshly issued rejected sessions; pending review revokes all sessions", async () => {
  const f = fixture(), admin = seedMember(f, { sub: "1111111111111111111", role: "admin" });
  const sub = "2222222222222222222";
  const rejected = seedMember(f, { sub, status: "rejected" });
  const secondToken = "f".repeat(64);
  f.DB.sessions.set(hash(secondToken), { token_hash: hash(secondToken),
    google_sub: sub, csrf_token: "e".repeat(64), expires_at: NOW + 3600, created_at: NOW });
  const path = "/api/admin/review";
  async function review(status) {
    return handleRequest(req(path, { method: "POST", cookie: admin.cookie,
      origin: ORIGIN, csrf: admin.csrf, body: { google_sub: sub, status } }), f.env, f.opts);
  }
  assert.equal((await handleRequest(req("/api/me", { cookie: rejected.cookie }), f.env, f.opts)).status, 200);
  assert.equal((await review("approved")).status, 200);
  assert.equal(f.DB.sessions.has(hash(rejected.token)), false);
  assert.equal(f.DB.sessions.has(hash(secondToken)), false);
  assert.equal((await handleRequest(req("/labinsight/app.js", { cookie: rejected.cookie }), f.env, f.opts)).status, 401);
  const approved = seedMember(f, { sub, status: "approved" });
  assert.equal((await review("pending")).status, 200);
  assert.equal(f.DB.sessions.has(hash(approved.token)), false);
  assert.equal((await handleRequest(req("/labinsight/app.js", { cookie: approved.cookie }), f.env, f.opts)).status, 401);
  const pending = seedMember(f, { sub, status: "pending" });
  assert.equal((await review("approved")).status, 200);
  assert.equal((await handleRequest(req("/labinsight/", { cookie: pending.cookie }), f.env, f.opts)).status, 200);
});
test("admin lists applications; cannot elevate or remove an existing admin through review API", async () => {
  const f = fixture(), admin = seedMember(f, { sub: "1111111111111111111", email: "owner@example.com", role: "admin" });
  const res = await handleRequest(req("/api/admin/applications", { cookie: admin.cookie }), f.env, f.opts);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).members, []);
  const attempted = await handleRequest(req("/api/admin/review", { method: "POST", cookie: admin.cookie,
    origin: ORIGIN, csrf: admin.csrf, body: { google_sub: "1111111111111111111", status: "rejected" } }), f.env, f.opts);
  assert.equal(attempted.status, 404);
  assert.equal(f.DB.members.get("1111111111111111111").role, "admin");
});
test("logout requires CSRF and revokes stored session, not merely the browser cookie", async () => {
  const f = fixture(), admin = seedMember(f);
  const denied = await handleRequest(req("/auth/logout", { cookie: admin.cookie, method: "POST",
    origin: "https://evil.example", csrf: admin.csrf }), f.env, f.opts);
  assert.equal(denied.status, 403);
  const out = await handleRequest(req("/auth/logout", { cookie: admin.cookie, method: "POST",
    origin: ORIGIN, csrf: admin.csrf }), f.env, f.opts);
  assert.equal(out.status, 303);
  assert.match(out.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await handleRequest(req("/api/me", { cookie: admin.cookie }), f.env, f.opts)).status, 401);
});
test("Google OAuth PKCE verifies an actual signed OIDC token and registers a pending member", async () => {
  const f = fixture();
  const { callback, browserCookie, result } = await googleExchange(f)();
  assert.equal(result.status, 303);
  assert.equal(result.headers.get("location"), ORIGIN + "/pending.html");
  assert.equal(f.DB.members.get("123456789012345678901").status, "pending");
  assert.equal(f.DB.members.get("123456789012345678901").role, "member");
  assert.equal(f.DB.sessions.size, 1);
  assert.equal((await handleRequest(req(callback, { cookie: browserCookie }), f.env, f.opts)).status, 400);
});
test("verified bootstrap administrator is approved; a different verified Google account remains pending", async () => {
  const f = fixture();
  const boot = await googleExchange(f, { email: "owner@example.com", hd: "example.com", sub: "333333333333333333333" })();
  assert.equal(boot.result.status, 303);
  assert.equal(boot.result.headers.get("location"), ORIGIN + "/labinsight/");
  assert.equal(f.DB.members.get("333333333333333333333").role, "admin");
  assert.equal(f.DB.members.get("333333333333333333333").status, "approved");
});
test("bootstrap requires Google authority, while external email applicants remain pending", async () => {
  for (const claims of [
    { email: "owner@example.com" },
    { email: "owner@example.com", hd: "another.example" },
    { email: "owner@example.com", hd: true }
  ]) {
    const f = fixture();
    const { result } = await googleExchange(f, claims)();
    assert.equal(result.status, 303);
    const member = f.DB.members.get("123456789012345678901");
    assert.equal(member.role, "member");
    assert.equal(member.status, "pending");
  }
  const f = fixture();
  f.env.BOOTSTRAP_ADMIN_EMAIL = "owner@gmail.com";
  const { result } = await googleExchange(f, { email: "owner@gmail.com" })();
  assert.equal(result.status, 303);
  assert.equal(f.DB.members.get("123456789012345678901").role, "admin");
});

test("mutation endpoints reject JSON primitives and arrays as client errors", async () => {
  const f = fixture(), user = seedMember(f, { status: "pending" });
  for (const body of [null, [], "purpose", 42, true]) {
    const response = await handleRequest(req("/api/application", {
      method: "POST", cookie: user.cookie, origin: ORIGIN, csrf: user.csrf, body
    }), f.env, f.opts);
    assert.equal(response.status, 400);
    assert.equal(f.DB.members.get("123456789012345678901").purpose, "");
  }
});

test("JSON byte limit cancels oversized streams without Content-Length", async () => {
  const f = fixture(), user = seedMember(f, { status: "pending" });
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4097)); },
    cancel() { cancelled = true; }
  });
  const request = new Request(ORIGIN + "/api/application", {
    method: "POST", headers: { Cookie: user.cookie, Origin: ORIGIN,
      "X-CSRF-Token": user.csrf, "Content-Type": "application/json" }, body, duplex: "half"
  });
  assert.equal((await handleRequest(request, f.env, f.opts)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(f.DB.members.get("123456789012345678901").purpose, "");
});
test("unverified Google claims and forged ID token fail without creating a member or session", async () => {
  for (const claims of [
    { email_verified: false },
    { aud: "someone-else.apps.googleusercontent.com" },
    { iss: "https://attacker.example" },
    { exp: NOW - 1000 },
    { sub: "" }
  ]) {
    const f = fixture();
    const outcome = await googleExchange(f, claims)();
    assert.equal(outcome.result.status, 401, JSON.stringify(claims));
    assert.equal(f.DB.members.size, 0);
    assert.equal(f.DB.sessions.size, 0);
  }
});
test("missing config, malicious paths and credential-bearing unsupported routes fail closed", async () => {
  const f = fixture();
  assert.equal((await handleRequest(req("/auth/start"), { ...f.env, DB: undefined }, f.opts)).status, 503);
  assert.equal((await handleRequest(req("/auth/start"), { ...f.env, GOOGLE_CLIENT_SECRET: "" }, f.opts)).status, 503);
  const paths = ["/caffeine-atlas/", "/api/caffeine-atlas", "/auth-gateway/worker.mjs",
    "/free-auth/migrations/0001_initial.sql", "/.dev.vars", "/admin/data", "/oauth2/token"];
  for (const path of paths) {
    assert.equal((await handleRequest(req(path), f.env, f.opts)).status, 404, path);
  }
  assert.equal((await handleRequest(req("/auth/start", { method: "POST" }), f.env, f.opts)).status, 404);
  assert.equal((await handleRequest(req("/labinsight/", { method: "POST" }), f.env, f.opts)).status, 401);
  assert.equal(safeNext("//evil.example"), "/");
  assert.equal(safeNext("/caffeine-atlas/"), "/");
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext("/labinsight/report.html?view=1"), "/labinsight/report.html?view=1");
});
test("fixed-duration sessions expire, no CSRF bypass and private admin-only static UI", async () => {
  const f = fixture(), member = seedMember(f);
  assert.equal((await handleRequest(req("/admin.html", { cookie: member.cookie }), f.env, f.opts)).status, 403);
  f.opts.now = NOW + 4000;
  assert.equal((await handleRequest(req("/labinsight/", { cookie: member.cookie }), f.env, f.opts)).status, 303);
  assert.equal((await handleRequest(req("/api/me", { cookie: member.cookie }), f.env, f.opts)).status, 401);
});


test("member may withdraw with CSRF, deleting profile and every active session", async () => {
  const f = fixture(), applicant = seedMember(f, { status: "pending" });
  const uri = "/api/account/delete";
  const forged = await handleRequest(req(uri, { method: "POST", cookie: applicant.cookie,
    origin: "https://attacker.example", csrf: applicant.csrf }), f.env, f.opts);
  assert.equal(forged.status, 403);
  const gone = await handleRequest(req(uri, { method: "POST", cookie: applicant.cookie,
    origin: ORIGIN, csrf: applicant.csrf }), f.env, f.opts);
  assert.equal(gone.status, 200);
  assert.equal((await gone.json()).code, "ACCOUNT_DELETED");
  assert.match(gone.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(f.DB.members.size, 0);
  assert.equal(f.DB.sessions.size, 0);
  assert.equal((await handleRequest(req("/api/me", { cookie: applicant.cookie }), f.env, f.opts)).status, 401);
});

test("bootstrap admin cannot accidentally delete the only administration account", async () => {
  const f = fixture(), admin = seedMember(f, { sub: "1111111111111111111", role: "admin" });
  const res = await handleRequest(req("/api/account/delete", { method: "POST",
    cookie: admin.cookie, origin: ORIGIN, csrf: admin.csrf }), f.env, f.opts);
  assert.equal(res.status, 403);
  assert.equal(f.DB.members.size, 1);
  assert.equal((await handleRequest(req("/", { cookie: admin.cookie }), f.env, f.opts)).status, 200);
});

test("daily free D1 cleanup removes only expired OAuth states, sessions and rate limit records", async () => {
  const f = fixture(), member = seedMember(f);
  f.DB.states.set("old", { expires_at: NOW - 10, nonce: "old" });
  f.DB.states.set("new", { expires_at: NOW + 30, nonce: "new" });
  f.DB.sessions.set("old", { expires_at: NOW - 100, google_sub: "old" });
  f.DB.throttles.set("old", { window_start: NOW - 90000, attempts: 2 });
  f.DB.throttles.set("new", { window_start: NOW - 3500, attempts: 2 });
  await purgeExpiredRecords(f.env, NOW);
  assert.equal(f.DB.states.has("old"), false);
  assert.equal(f.DB.states.has("new"), true);
  assert.equal(f.DB.sessions.has("old"), false);
  assert.equal(f.DB.sessions.has(hash(member.token)), true);
  assert.equal(f.DB.throttles.has("old"), false);
  assert.equal(f.DB.throttles.has("new"), true);
  assert.equal(f.DB.members.size, 1);
});

test("rejected Google token exchange reports only a fixed error category, never secrets", async () => {
  const f = fixture();
  const privateMarker = "DO-NOT-LOG-GOOGLE-SECRET-OR-OAUTH-CODE";
  f.opts.googleFetch = async (url) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    return new Response(JSON.stringify({
      error: "invalid_client", error_description: privateMarker, access_token: privateMarker
    }), { status: 401 });
  };
  const recorded = [], oldWarn = console.warn;
  console.warn = (...args) => recorded.push(args);
  try {
    const start = await handleRequest(req("/auth/start"), f.env, f.opts);
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = "/auth/callback?code=" + privateMarker + "&state=" + state;
    const result = await handleRequest(req(callback, {
      cookie: "__Host-labdam_oauth_state=" + state
    }), f.env, f.opts);
    assert.equal(result.status, 503);
    assert.match(await result.text(), /Google 로그인 연결에 실패했습니다/);
    assert.equal(f.DB.members.size, 0);
    assert.equal(f.DB.sessions.size, 0);
    assert.deepEqual(recorded, [["LABDAM_OAUTH_TOKEN_REJECTED", 401, "invalid_client"]]);
    assert.ok(!JSON.stringify(recorded).includes(privateMarker));
  } finally {
    console.warn = oldWarn;
  }
});

test("unexpected provider error and token network failures reveal no raw response", async () => {
  for (const responseMode of ["unknown", "transport"]) {
    const f = fixture(), recorded = [], oldWarn = console.warn;
    f.opts.googleFetch = async () => {
      if (responseMode === "transport") throw Error("SECRET-MARKER-TRANSPORT");
      return new Response(JSON.stringify({
        error: "SOME_UNBOUNDED_PRIVATE_ERROR", error_description: "SECRET-MARKER-BODY"
      }), { status: 400 });
    };
    console.warn = (...args) => recorded.push(args);
    try {
      const start = await handleRequest(req("/auth/start"), f.env, f.opts);
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      const result = await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {
        cookie: "__Host-labdam_oauth_state=" + state
      }), f.env, f.opts);
      assert.equal(result.status, 503);
      const output = JSON.stringify(recorded);
      assert.ok(!output.includes("SECRET-MARKER"));
      assert.deepEqual(recorded,
        responseMode === "transport"
          ? [["LABDAM_OAUTH_TOKEN_FETCH_FAILURE", "other"]]
          : [["LABDAM_OAUTH_TOKEN_REJECTED", 400, "provider_error"]]);
    } finally {
      console.warn = oldWarn;
    }
  }
});

test("Google success response with invalid JSON is reported without leaking body", async () => {
  const f = fixture(), logged = [], original = console.warn;
  const marker = "PRIVATE-TOKEN-MUST-NOT-PRINT";
  f.opts.googleFetch = async () => new Response("{invalid-json " + marker, { status: 200 });
  console.warn = (...args) => logged.push(args);
  try {
    const start = await handleRequest(req("/auth/start"), f.env, f.opts);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {
      cookie: "__Host-labdam_oauth_state=" + state
    }), f.env, f.opts);
    assert.equal(callback.status, 503);
    assert.deepEqual(logged, [["LABDAM_OAUTH_TOKEN_JSON_FAILURE", 200]]);
    assert.equal(JSON.stringify(logged).includes(marker), false);
    assert.equal(f.DB.members.size, 0);
    assert.equal(f.DB.sessions.size, 0);
  } finally {
    console.warn = original;
  }
});

test("fetch TypeError is reported with whitelisted category only", async () => {
  const f = fixture(), logged = [], original = console.warn;
  f.opts.googleFetch = async () => { throw new TypeError("PRIVATE-CODE-MUST-NOT-PRINT"); };
  console.warn = (...args) => logged.push(args);
  try {
    const start = await handleRequest(req("/auth/start"), f.env, f.opts);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {
      cookie: "__Host-labdam_oauth_state=" + state
    }), f.env, f.opts);
    assert.equal(callback.status, 503);
    assert.deepEqual(logged, [["LABDAM_OAUTH_TOKEN_FETCH_FAILURE", "type_error"]]);
    assert.ok(!JSON.stringify(logged).includes("PRIVATE-CODE"));
  } finally {
    console.warn = original;
  }
});
