"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { handleRequest, googleIdentity, safeNext, purgeExpiredRecords } = require("../free-auth/worker.mjs");

const ORIGIN = "https://labdam-test.workers.dev";
const CLIENT = "1234567890-verified-web-client.apps.googleusercontent.com";
const NOW = Math.floor(Date.now() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "google-test-kid-001", alg: "RS256", use: "sig" };
const hash = value => createHash("sha256").update(value).digest("hex");
const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
test("OIDC null, array and primitive header/payload are authentication errors", async () => {
  const f = fixture();
  for (const invalid of [null, [], "invalid", 1]) {
    for (const [header, payload] of [[invalid, {}], [{ alg: "RS256", kid: JWK.kid }, invalid]]) {
      await assert.rejects(googleIdentity(base64(header) + "." + base64(payload) + ".c2ln", "nonce", f.env, f.opts),
        error => error.status === 401);
    }
  }
});
test("provider timeout is bounded, consumes state and clears the browser OAuth cookie", async () => {
  const f = fixture(), logs = [], original = console.warn;
  f.opts.googleFetch = async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    throw new DOMException("synthetic-sensitive-message", "TimeoutError");
  };
  console.warn = (...args) => logs.push(args.join(" "));
  try {
    const start = await handleRequest(req("/auth/start"), f.env, f.opts);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const request = req("/auth/callback?code=SYNTHETIC_CODE&state=" + state, { cookie: "__Host-labdam_oauth_state=" + state });
    const response = await handleRequest(request, f.env, f.opts);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("set-cookie"), /__Host-labdam_oauth_state=;.*Max-Age=0/);
    assert.equal(f.DB.states.size, 0);
    assert.equal(f.DB.sessions.size, 0);
    assert.deepEqual(logs, ["LABDAM_OAUTH_TOKEN_FETCH_FAILURE other"]);
    assert.equal((await handleRequest(request, f.env, f.opts)).status, 400);
  } finally { console.warn = original; }
});
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
    async batch(statements) {
      const snapshots = [members, states, sessions, throttles].map(m => structuredClone(m));
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        return results;
      } catch (error) {
        [members, states, sessions, throttles].forEach((m, i) => {
          m.clear(); for (const [k, v] of snapshots[i]) m.set(k, v);
        });
        throw error;
      }
    },
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
          } else if (sql.startsWith("UPDATE members SET status='approved',role='admin'")) {
            const [updated_at, google_sub] = args;
            const m = members.get(google_sub);
            const hasAdmin = [...members.values()].some(x => x.role === "admin" && x.status === "approved");
            if (m && !hasAdmin && m.role === "member" && m.status === "pending") {
              Object.assign(m, { status: "approved", role: "admin", updated_at });
            }
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
          if (sql.startsWith("DELETE FROM sessions") || sql.startsWith("INSERT INTO") ||
              sql.startsWith("UPDATE members SET status='approved',role='admin'")) {
            await this.run(); return { success: true, results: [] };
          }
          if (sql.startsWith("UPDATE members SET status") || sql.startsWith("SELECT google_sub,email,display_name,status,role FROM members")) {
            const row = await this.first(); return { success: true, results: row ? [row] : [] };
          }
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
test("device storage identity is stable, distinct, private and available only to approved accounts", async () => {
  const f = fixture(), a = seedMember(f), b = seedMember(f, {sub:"234567890123456789012", email:"other@example.invalid"});
  const get = cookie => handleRequest(req("/api/device-store-identity", {cookie}), f.env, f.opts);
  assert.equal((await get(undefined)).status, 401);
  const first = await get(a.cookie), second = await get(b.cookie);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.match(first.headers.get("cache-control"), /no-store/);
  const identityA = await first.json(), identityB = await second.json();
  assert.match(identityA.id, /^[a-f0-9]{64}$/);
  assert.notEqual(identityA.id, identityB.id);
  f.DB.members.get("123456789012345678901").email = "changed@example.invalid";
  assert.deepEqual(await (await get(a.cookie)).json(), identityA);
  f.DB.members.get("123456789012345678901").status = "pending";
  assert.equal((await get(a.cookie)).status, 403);
});
function googleExchange(f, claims = {}, { requestedNext = "/labinsight/" } = {}) {
  let nonce;
  f.opts.googleFetch = async (url, request) => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      assert.equal(request.redirect, "manual");
      return new Response(JSON.stringify({ keys: [JWK] }), { status: 200 });
    }
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(request.redirect, "manual");
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
test("new hostname preserves the old gate and rejects unknown hosts and cross-host CSRF", async () => {
  const f = fixture(), approved = seedMember(f), neo = "https://repodam.labdam.kr";
  assert.equal((await handleRequest(new Request(neo + "/labinsight/"), f.env, f.opts)).status, 503);
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  assert.equal((await handleRequest(new Request(neo + "/healthz"), {...f.env, AUTH_ORIGIN: neo}, f.opts)).status, 503);
  for (const host of [ORIGIN, neo]) {
    const root = await handleRequest(new Request(host + "/labinsight/"), f.env, f.opts);
    assert.equal(root.status, 303);
    assert.equal(new URL(root.headers.get("location")).origin, host);
    const js = await handleRequest(new Request(host + "/labinsight/app.js"), f.env, f.opts);
    assert.equal(js.status, 401);
  }
  for (const host of ["https://repodam.labdam.kr.evil.invalid", "http://repodam.labdam.kr", "https://repodam.labdam.kr:8443", "https://foo.repodam.labdam.kr", "https://www.labdam.kr", "https://evil.invalid"]) {
    assert.equal((await handleRequest(new Request(host + "/labinsight/"), f.env, f.opts)).status, 503);
  }
  // Legacy tokens do not authenticate on the custom host, even if presented manually.
  assert.equal((await handleRequest(new Request(neo + "/api/me", {headers:{Cookie:approved.cookie}}), f.env, f.opts)).status, 401);
  const injected = "__Host-labdam_session=repodam-origin-v1:" + neo + ":" + approved.token;
  assert.equal((await handleRequest(req("/api/me", {cookie:injected}), f.env, f.opts)).status, 401);
  f.DB.sessions.set(hash("repodam-origin-v1:" + neo + ":" + approved.token), f.DB.sessions.get(hash(approved.token)));
  const wrongOrigin = new Request(neo + "/api/application", {
    method: "POST", headers: { Cookie: approved.cookie, Origin: ORIGIN,
      "X-CSRF-Token": approved.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "synthetic" })
  });
  assert.equal((await handleRequest(wrongOrigin, f.env, f.opts)).status, 403);
});

test("new hostname signs in the same approved member using an origin-bound callback", async () => {
  const f = fixture(), approved = seedMember(f), neo = "https://repodam.labdam.kr";
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  let nonce;
  f.opts.googleFetch = async (url, options) => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return new Response(JSON.stringify({keys:[JWK]}));
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(new URLSearchParams(options.body).get("redirect_uri"), neo + "/auth/callback");
      return new Response(JSON.stringify({id_token:signedIdToken({nonce})}));
    }
    throw Error("Unexpected external request");
  };
  const start = await handleRequest(new Request(neo + "/auth/start"), f.env, f.opts);
  assert.equal(start.status, 302);
  const oauth = new URL(start.headers.get("location"));
  assert.equal(oauth.searchParams.get("redirect_uri"), neo + "/auth/callback");
  const state = oauth.searchParams.get("state");
  nonce = f.DB.states.get(hash("repodam-origin-v1:" + neo + ":" + state)).nonce;
  const cookie = "__Host-labdam_oauth_state=" + state;
  const injectedState = "repodam-origin-v1:" + neo + ":" + state;
  assert.equal((await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + encodeURIComponent(injectedState), {cookie:"__Host-labdam_oauth_state=" + injectedState}), f.env, f.opts)).status, 400);
  // A state initiated on the custom host cannot be consumed on the old host.
  assert.equal((await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {cookie}), f.env, f.opts)).status, 400);
  const callback = await handleRequest(new Request(neo + "/auth/callback?code=VALID_TEST_CODE&state=" + state, {
    headers:{Cookie:cookie}
  }), f.env, f.opts);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get("location"), neo + "/labinsight/");
  assert.equal(f.DB.members.size, 1);
  assert.equal(f.DB.members.get("123456789012345678901").status, "approved");
  assert.equal(f.DB.sessions.size, 2);
  assert.equal((await handleRequest(req("/labinsight/", {cookie:approved.cookie}), f.env, f.opts)).status, 200);
});
test("migration identity reveals only a challenge-scoped account match", async () => {
  const f = fixture(), approved = seedMember(f), neo = "https://repodam.labdam.kr", nonce = "1".repeat(64);
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  f.DB.sessions.set(hash("repodam-origin-v1:" + neo + ":" + approved.token), f.DB.sessions.get(hash(approved.token)));
  const a = await handleRequest(req("/api/migration-identity?nonce=" + nonce, {cookie:approved.cookie}), f.env, f.opts);
  const b = await handleRequest(new Request(neo + "/api/migration-identity?nonce=" + nonce, {headers:{Cookie:approved.cookie}}), f.env, f.opts);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(await a.json(), await b.json());
  const invalid = await handleRequest(req("/api/migration-identity?nonce=x", {cookie:approved.cookie}), f.env, f.opts);
  assert.equal(invalid.status, 400);
  const noLogin = await handleRequest(req("/api/migration-identity?nonce=" + nonce), f.env, f.opts);
  assert.equal(noLogin.status, 401);
  f.DB.members.get("123456789012345678901").status = "pending";
  assert.equal((await handleRequest(req("/api/migration-identity?nonce=" + nonce, {cookie:approved.cookie}), f.env, f.opts)).status, 403);
});
test("only the empty handoff shell is public on the enabled custom host", async () => {
  const f = fixture(), neo = "https://repodam.labdam.kr";
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  for (const path of ["/labinsight/handoff.html", "/labinsight/handoff.js"]) {
    assert.equal((await handleRequest(new Request(neo + path), f.env, f.opts)).status, 200);
    assert.equal((await handleRequest(req(path), f.env, f.opts)).status, path.endsWith(".html") ? 303 : 401);
    assert.equal((await handleRequest(new Request(neo + path, {method:"POST"}), f.env, f.opts)).status, 405);
  }
  assert.equal((await handleRequest(new Request(neo + "/labinsight/app.js"), f.env, f.opts)).status, 401);
});
test("account deletion revokes sessions on both hosts", async () => {
  const f = fixture(), approved = seedMember(f), neo = "https://repodam.labdam.kr";
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  f.DB.sessions.set(hash("repodam-origin-v1:" + neo + ":" + approved.token), f.DB.sessions.get(hash(approved.token)));
  const removed = await handleRequest(req("/api/account/delete", {method:"POST", cookie:approved.cookie, origin:ORIGIN, csrf:approved.csrf}), f.env, f.opts);
  assert.equal(removed.status, 200);
  assert.equal(f.DB.sessions.size, 0);
  assert.equal((await handleRequest(new Request(neo + "/api/me", {headers:{Cookie:approved.cookie}}), f.env, f.opts)).status, 401);
});
test("custom-host logout revokes only its origin-bound session", async () => {
  const f = fixture(), user = seedMember(f), neo = "https://repodam.labdam.kr";
  f.env.REPODAM_CUSTOM_DOMAIN = "enabled";
  f.DB.sessions.set(hash("repodam-origin-v1:" + neo + ":" + user.token), f.DB.sessions.get(hash(user.token)));
  const res = await handleRequest(new Request(neo + "/auth/logout", {
    method:"POST", headers:{Cookie:user.cookie, Origin:neo, "X-CSRF-Token":user.csrf}
  }), f.env, f.opts);
  assert.equal(res.status, 303);
  assert.equal((await handleRequest(new Request(neo + "/api/me", {headers:{Cookie:user.cookie}}), f.env, f.opts)).status, 401);
  assert.equal((await handleRequest(req("/api/me", {cookie:user.cookie}), f.env, f.opts)).status, 200);
});
test("legacy service roots go to REPODAM login and cannot redirect off-site", async () => {
  const f=fixture();
  for(const path of ["/", "/index.html", "/login", "/?next=https://evil.invalid", "/?next=%2Flogin.html"]){
    const r=await handleRequest(req(path), {...f.env, DB:undefined}, f.opts);
    assert.equal(r.status,303);
    const target=new URL(r.headers.get("Location"));
    assert.equal(target.origin,ORIGIN);
    assert.equal(target.pathname,"/login.html");
    assert.equal(target.searchParams.get("next"),"/labinsight/");
    assert.match(r.headers.get("Cache-Control"),/no-store/);
  }
  for(const value of ["//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/labinsight/%0d%0aLocation:evil", "/login.html", "/auth/start", "/labinsight/../login.html"])
    assert.equal(safeNext(value),"/labinsight/",value);
});

test("anonymous visitor uses dedicated login while REPODAM and account data remain protected", async () => {
  const f = fixture();
  for (const path of ["/labinsight/", "/labinsight/report.html"]) {
    const res = await handleRequest(req(path), f.env, f.opts);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /\/login\.html\?next=/);
  }
  for (const path of ["/labinsight/app.js",
    "/labinsight/supplement-guidance.js", "/account.html?file=x"]) {
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

test("the public brand exact allowlist works without OAuth or D1 and rejects writes or unrelated assets", async () => {
  const f = fixture(), env = { ...f.env, DB: undefined, GOOGLE_CLIENT_SECRET: "" };
  for (const path of ["/", "/index.html", "/favicon.svg", "/assets/portal-redesign.css",
    "/assets/portal-session.js", "/privacy.html", "/terms.html"]) {
    const response = await handleRequest(req(path), env, f.opts);
    assert.equal(response.status, ["/", "/index.html"].includes(path) ? 303 : 200, path);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.equal((await handleRequest(req(path, { method: "POST" }), env, f.opts)).status, 405);
  }
  for (const path of ["/assets/worker.mjs", "/assets/admin.html", "/free-auth/portal-session.js"])
    assert.equal((await handleRequest(req(path), env, f.opts)).status, 404);
  const status = await handleRequest(req("/api/session-status"), env, f.opts);
  assert.deepEqual(await status.json(), { authenticated: false });
});

test("public session status reveals only the current session approval state, never profile or CSRF", async () => {
  for (const status of ["approved", "pending", "rejected"]) {
    const f = fixture(), member = seedMember(f, { status });
    const login = await handleRequest(req("/login.html?next=%2Flabinsight%2Freport.html", {cookie:member.cookie}), f.env, f.opts);
    assert.equal(login.status,303);
    assert.equal(new URL(login.headers.get("Location")).pathname,status==="approved"?"/labinsight/report.html":"/pending.html");
    assert.equal((await handleRequest(req("/login.html?switch=1",{cookie:member.cookie}),f.env,f.opts)).status,200);
    const response = await handleRequest(req("/api/session-status", { cookie: member.cookie }), f.env, f.opts);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Vary"), "Cookie");
    assert.deepEqual(await response.json(), { authenticated: true, status });
    f.opts.now = NOW + 4000;
    const expired = await handleRequest(req("/api/session-status", { cookie: member.cookie }), f.env, f.opts);
    assert.deepEqual(await expired.json(), { authenticated: false });
  }
});

test("anonymous service entry returns to the brand login section with the original safe destination", async () => {
  const f = fixture();
  const response = await handleRequest(req("/labinsight/report.html?view=sample"), f.env, f.opts);
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("Location"));
  assert.equal(location.origin, ORIGIN);
  assert.equal(location.pathname, "/login.html");
  assert.equal(location.hash, "");
  assert.equal(location.searchParams.get("next"), "/labinsight/report.html?view=sample");
});
test("approved Google member can open LABDAM homepage and REPODAM without signing in twice", async () => {
  const f = fixture(), member = seedMember(f);
  for (const path of ["/labinsight/", "/labinsight/app.js", "/labinsight/supplement-guidance.js",
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
    assert.equal((await handleRequest(req("/labinsight/supplement-guidance.js", { cookie: user.cookie }), f.env, f.opts)).status, 403);
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

test("pending operator is recoverable after bootstrap secret is configured, without changing a rejected member", async () => {
  const f = fixture();
  const sub = "123456789012345678901";
  f.env.BOOTSTRAP_ADMIN_EMAIL = "";
  const initial = await googleExchange(f, { email: "owner@gmail.com" })();
  assert.equal(initial.result.status, 303);
  assert.equal(f.DB.members.get(sub).status, "pending");
  f.env.BOOTSTRAP_ADMIN_EMAIL = "owner@gmail.com";
  const recovered = await googleExchange(f, { email: "owner@gmail.com" })();
  assert.equal(recovered.result.status, 303);
  assert.equal(recovered.result.headers.get("location"), ORIGIN + "/labinsight/");
  assert.equal(f.DB.members.get(sub).role, "admin");
  assert.equal(f.DB.members.get(sub).status, "approved");

  const rejected = fixture();
  rejected.env.BOOTSTRAP_ADMIN_EMAIL = "owner@gmail.com";
  seedMember(rejected, { email: "owner@gmail.com", status: "rejected" });
  const denied = await googleExchange(rejected, { email: "owner@gmail.com" })();
  assert.equal(denied.result.status, 303);
  assert.equal(rejected.DB.members.get(sub).role, "member");
  assert.equal(rejected.DB.members.get(sub).status, "rejected");
});

test("first-admin recovery cannot create a second admin when one already exists", async () => {
  const f = fixture(), sub = "123456789012345678901";
  f.env.BOOTSTRAP_ADMIN_EMAIL = "owner@gmail.com";
  seedMember(f, { sub: "888888888888888888888", status: "approved", role: "admin" });
  const login = await googleExchange(f, { email: "owner@gmail.com" })();
  assert.equal(login.result.status, 303);
  assert.equal(f.DB.members.get(sub).status, "pending");
  assert.equal(f.DB.members.get(sub).role, "member");
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
test("healthz reports readiness only when auth configuration and private assets are bound", async () => {
  const f = fixture();
  const healthy = await handleRequest(req("/healthz"), f.env, f.opts);
  assert.equal(healthy.status, 200);
  assert.match(healthy.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await healthy.json(), { service: "labdam-free-auth", readiness: "bindings-present", release: "repodam-auth-20261028-handoff" });
  for (const overrides of [
    { GOOGLE_CLIENT_SECRET: undefined },
    { GOOGLE_CLIENT_ID: "" },
    { RATE_LIMIT_SECRET: "weak" },
    { DB: undefined },
    { ASSETS: undefined },
    { AUTH_ORIGIN: "http://not-https.example" }
  ]) {
    const reply = await handleRequest(req("/healthz"), { ...f.env, ...overrides }, f.opts);
    assert.equal(reply.status, 503, JSON.stringify(Object.keys(overrides)));
    const body = await reply.text();
    assert.doesNotMatch(body, /fake-long-secret|a-long-secret|owner@example.com/);
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
  assert.equal(safeNext("//evil.example"), "/labinsight/");
  assert.equal(safeNext("/caffeine-atlas/"), "/labinsight/");
  assert.equal(safeNext("https://evil.example"), "/labinsight/");
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
  assert.equal((await handleRequest(req("/", { cookie: admin.cookie }), f.env, f.opts)).status, 303);
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

test("workerd-supported manual redirect mode rejects external token endpoint redirects", async () => {
  const f = fixture(), logged = [], oldWarn = console.warn;
  f.opts.googleFetch = async (url, init) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302, headers: { Location: "https://attacker.invalid/collect-code" }
    });
  };
  console.warn = (...args) => logged.push(args);
  try {
    const start = await handleRequest(req("/auth/start"), f.env, f.opts);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const result = await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {
      cookie: "__Host-labdam_oauth_state=" + state
    }), f.env, f.opts);
    assert.equal(result.status, 503);
    assert.equal(f.DB.members.size, 0);
    assert.equal(f.DB.sessions.size, 0);
    assert.deepEqual(logged, [["LABDAM_OAUTH_TOKEN_REJECTED", 302, "redirect_blocked"]]);
  } finally {
    console.warn = oldWarn;
  }
});

test("Google JWKS redirect cannot be followed or accepted as a signing key source", async () => {
  const f = fixture();
  let nonce;
  f.opts.googleFetch = async (url, init) => {
    assert.equal(init.redirect, "manual");
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({
        id_token: signedIdToken({ nonce })
      }), { status: 200 });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(null, {
        status: 302, headers: { Location: "https://attacker.invalid/fake-jwks" }
      });
    }
    throw Error("Unexpected provider URL");
  };
  const start = await handleRequest(req("/auth/start"), f.env, f.opts);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  nonce = f.DB.states.get(hash(state)).nonce;
  const callback = await handleRequest(req("/auth/callback?code=VALID_TEST_CODE&state=" + state, {
    cookie: "__Host-labdam_oauth_state=" + state
  }), f.env, f.opts);
  assert.equal(callback.status, 503);
  assert.match(await callback.text(), /Google 인증 키를 확인할 수 없습니다/);
  assert.equal(f.DB.members.size, 0);
  assert.equal(f.DB.sessions.size, 0);
});

test("Worker source rejects unsupported workerd redirect:error compatibility regression", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const source = readFileSync(join(__dirname, "..", "free-auth", "worker.mjs"), "utf8");
  assert.doesNotMatch(source, /redirect\s*:\s*["']error["']/);
});
