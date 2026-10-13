"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign, createHmac } = require("node:crypto");
const { handleRequest } = require("../auth-gateway/worker.mjs");

const TEAM = "https://labdam-example.cloudflareaccess.com";
const AUD = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const NOW = Math.floor(Date.now() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-signing-key-001", alg: "RS256", use: "sig" };

function encoded(object) {
  return Buffer.from(JSON.stringify(object)).toString("base64url");
}

function signedToken(claims = {}, options = {}) {
  const header = { alg: "RS256", kid: publicJwk.kid, ...(options.header || {}) };
  const payload = {
    aud: [AUD], iss: TEAM, type: "app", sub: "account-user-id",
    iat: NOW - 60, exp: NOW + 3600,
    ...claims
  };
  const body = encoded(header) + "." + encoded(payload);
  return body + "." + sign("RSA-SHA256", Buffer.from(body), options.privateKey || privateKey)
    .toString("base64url");
}

function mocks({ presentAssets = true, certificatesAvailable = true } = {}) {
  const metrics = { assets: 0, jwks: 0 };
  const env = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  if (presentAssets) env.ASSETS = {
    fetch: async request => {
      metrics.assets += 1;
      return new Response("private test fixture: " + new URL(request.url).pathname, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
  };
  const options = {
    nowSeconds: NOW,
    fetcher: async url => {
      metrics.jwks += 1;
      assert.equal(url, TEAM + "/cdn-cgi/access/certs");
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: certificatesAvailable ? 200 : 503,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
  return { env, options, metrics };
}

function request(path, token, method = "GET") {
  const headers = token ? { "Cf-Access-Jwt-Assertion": token } : {};
  return new Request("https://services.labdam.example" + path, { method, headers });
}

test("no JWT: both service home pages are unavailable", async () => {
  const x = mocks();
  for (const path of ["/labinsight/", "/caffeine-atlas/", "/labinsight/checkup.html",
                      "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html"]) {
    const response = await handleRequest(request(path), x.env, x.options);
    assert.equal(response.status, 401, path);
    assert.match(await response.text(), /로그인/);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
  assert.equal(x.metrics.assets, 0);
  assert.equal(x.metrics.jwks, 0);
});

test("fake identity header or fake session cookie cannot bypass auth", async () => {
  const x = mocks();
  const forged = new Request("https://services.labdam.example/labinsight/", {
    headers: { "Cf-Access-Authenticated-User-Email": "someone@example.com",
               "Cookie": "CF_Authorization=unverified" }
  });
  assert.equal((await handleRequest(forged, x.env, x.options)).status, 401);
  assert.equal(x.metrics.assets, 0);
});

test("valid signed Access account can open assets in BOTH services", async () => {
  const x = mocks();
  const token = signedToken();
  const paths = [
    "/labinsight/index.html", "/labinsight/app.js",
    "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html",
    "/caffeine-atlas/caffeine-sensitivity-app/styles.css"
  ];
  for (const path of paths) {
    const response = await handleRequest(request(path, token), x.env, x.options);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /private test fixture/);
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
  assert.equal(x.metrics.assets, paths.length);
  assert.equal(x.metrics.jwks, paths.length);
});

test("valid tokens can use HEAD and directory canonical redirects", async () => {
  const x = mocks();
  const token = signedToken();
  assert.equal((await handleRequest(request("/labinsight/index.html", token, "HEAD"), x.env, x.options)).status, 200);
  const redirect = await handleRequest(request("/caffeine-atlas", token), x.env, x.options);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "https://services.labdam.example/caffeine-atlas/");
});

test("tampered signature cannot open either app", async () => {
  const x = mocks();
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const response = await handleRequest(request("/labinsight/", signedToken({}, { privateKey: otherKey })), x.env, x.options);
  assert.equal(response.status, 401);
  assert.equal(x.metrics.assets, 0);
});

test("wrong issuer, audience, expired or not-yet-valid tokens fail closed", async () => {
  const tokenVariants = [
    { iss: "https://attacker.cloudflareaccess.com" },
    { aud: ["00000000000000000000000000000000"] },
    { exp: NOW },
    { exp: NOW - 10 },
    { nbf: NOW + 30 },
    { iat: NOW + 120 },
    { sub: "" },
    { type: "org" },
    { exp: "2030-01-01" }
  ];
  for (const claims of tokenVariants) {
    const x = mocks();
    const response = await handleRequest(request("/caffeine-atlas/", signedToken(claims)), x.env, x.options);
    assert.equal(response.status, 401, JSON.stringify(claims));
    assert.equal(x.metrics.assets, 0);
  }
});

test("service tokens with no human subject cannot unlock medical tools", async () => {
  const x = mocks();
  const response = await handleRequest(request("/caffeine-atlas/", signedToken({ sub: "" })), x.env, x.options);
  assert.equal(response.status, 401);
  assert.equal(x.metrics.assets, 0);
});

test("JWT algorithm confusion fails closed", async () => {
  const x = mocks();
  for (const alg of ["none", "HS256", "ES256"]) {
    const response = await handleRequest(request("/labinsight/", signedToken({}, { header: { alg } })), x.env, x.options);
    assert.equal(response.status, 401);
    assert.equal(x.metrics.assets, 0);
  }
});

test("missing or invalid Access configuration NEVER serves assets", async () => {
  for (const envChange of [
    { TEAM_DOMAIN: "http://labdam-example.cloudflareaccess.com" },
    { TEAM_DOMAIN: "https://attacker.invalid" },
    { ACCESS_AUD: "" },
    { ACCESS_AUD: "not-a-real-audience" }
  ]) {
    const x = mocks();
    const response = await handleRequest(request("/labinsight/", signedToken()),
      { ...x.env, ...envChange }, x.options);
    assert.equal(response.status, 503, JSON.stringify(envChange));
    assert.equal(x.metrics.assets, 0);
  }
});

test("JWKS provider outage denies access without serving content", async () => {
  const x = mocks({ certificatesAvailable: false });
  const response = await handleRequest(request("/labinsight/", signedToken()), x.env, x.options);
  assert.equal(response.status, 503);
  assert.equal(x.metrics.assets, 0);
});

test("missing protected assets binding denies access", async () => {
  const x = mocks({ presentAssets: false });
  const response = await handleRequest(request("/labinsight/", signedToken()), x.env, x.options);
  assert.equal(response.status, 503);
});

test("unknown routes and write methods never reach the protected assets", async () => {
  const x = mocks();
  assert.equal((await handleRequest(request("/admin/", signedToken()), x.env, x.options)).status, 404);
  assert.equal((await handleRequest(request("/labinsight/", signedToken(), "POST"), x.env, x.options)).status, 405);
  assert.equal((await handleRequest(request("/caffeine-atlas/", signedToken(), "DELETE"), x.env, x.options)).status, 405);
  assert.equal(x.metrics.assets, 0);
});

test("logout uses Cloudflare Access and never invents local auth state", async () => {
  const x = mocks();
  const r = await handleRequest(request("/logout"), x.env, x.options);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), TEAM + "/cdn-cgi/access/logout");
  assert.equal(x.metrics.assets, 0);
});

test("public LABDAM portal stays separate from protected services", async () => {
  const x = mocks();
  const r = await handleRequest(request("/"), x.env, x.options);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://haru-today.github.io/");
  assert.equal(x.metrics.assets, 0);
});


const STORAGE_KEY = "TEST-ONLY-HMAC-GATEWAY-KEY-AT-LEAST-32-CHARS";
const STORAGE_ENDPOINT = "https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyzABCDEF1234/exec";

function gatewayApi({ response = { ok: true, state: "saved", savedCount: 1 }, backendFail = false } = {}) {
  const x = mocks();
  const metrics = { calls: 0, verified: false, outbound: null };
  x.env.CAFFEINE_APPS_SCRIPT_URL = STORAGE_ENDPOINT;
  x.env.CAFFEINE_ATLAS_WRITE_HMAC_KEY = STORAGE_KEY;
  x.options.apiFetch = async (url, init) => {
    metrics.calls++;
    metrics.outbound = { url, init };
    const query = new URL(url).searchParams;
    let textToSign, stamp, nonce, signature;
    if (init.method === "POST") {
      const envelope = JSON.parse(init.body);
      stamp = envelope.auth.timestamp;
      nonce = envelope.auth.nonce;
      signature = envelope.auth.signature;
      textToSign = JSON.stringify(envelope.payload);
    } else {
      stamp = Number(query.get("timestamp"));
      nonce = query.get("nonce");
      signature = query.get("signature");
      textToSign = JSON.stringify("GET:" + query.get("action") + ":" + (query.get("requestId") || ""));
    }
    const expected = createHmac("sha256", STORAGE_KEY)
      .update(String(stamp) + "." + nonce + "." + textToSign).digest("hex");
    assert.equal(signature, expected, "Only server-side Cloudflare secret may sign the request.");
    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.ok(Math.abs(stamp - Math.floor(Date.now() / 1000)) < 60);
    metrics.verified = true;
    return new Response(JSON.stringify(response), { status: backendFail ? 503 : 200 });
  };
  return { ...x, metrics };
}

function apiRequest(path, token, method, body, origin = "https://services.labdam.example") {
  const headers = {};
  if (token) headers["Cf-Access-Jwt-Assertion"] = token;
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    if (origin) headers.Origin = origin;
  }
  return new Request("https://services.labdam.example" + path, {
    method, headers, body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("Sheets API requires signed-in Access account for GET, status and POST", async () => {
  const x = gatewayApi();
  const paths = ["/api/caffeine-atlas", "/api/caffeine-atlas?action=saveStatus&requestId=" + "a".repeat(32)];
  for (const path of paths) {
    assert.equal((await handleRequest(apiRequest(path, null, "GET"), x.env, x.options)).status, 401);
  }
  assert.equal((await handleRequest(apiRequest(paths[0], null, "POST", { requestId: "a".repeat(32), consent: true }),
    x.env, x.options)).status, 401);
  assert.equal(x.metrics.calls, 0);
});

test("valid account can read signed capabilities without exposing sheet IDs", async () => {
  const x = gatewayApi({ response: { ok: true, version: "v-test", capabilities: { batchSave: true }, spreadsheetId: "DO-NOT-EXPOSE" } });
  const res = await handleRequest(apiRequest("/api/caffeine-atlas?action=capabilities", signedToken(), "GET"), x.env, x.options);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).capabilities.batchSave, true);
  assert.ok(x.metrics.verified);
  assert.equal(x.metrics.outbound.init.method, "GET");
  assert.equal(x.metrics.outbound.url.startsWith(STORAGE_ENDPOINT + "?"), true);
});

test("valid login signs and submits only consented JSON from same origin", async () => {
  const x = gatewayApi();
  const payload = { requestId: "b".repeat(32), consent: true, sampleId: "SAMPLE-NONIDENTIFIABLE",
    rs6968865: "AT", score: 50 };
  const res = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "POST", payload), x.env, x.options);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).savedCount, 1);
  assert.equal(x.metrics.outbound.init.method, "POST");
  assert.ok(x.metrics.verified);
  const requestBody = JSON.parse(x.metrics.outbound.init.body);
  assert.deepEqual(requestBody.payload, payload);
  assert.equal(requestBody.auth.signature.length, 64);
  assert.ok(!x.metrics.outbound.init.body.includes("STORAGE_KEY"));
});

test("browser CSRF attempt with wrong or missing origin is rejected", async () => {
  const x = gatewayApi();
  const p = { requestId: "c".repeat(32), consent: true };
  const wrong = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "POST",
    p, "https://attacker.example"), x.env, x.options);
  const absent = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "POST",
    p, null), x.env, x.options);
  assert.equal(wrong.status, 403);
  assert.equal(absent.status, 403);
  assert.equal(x.metrics.calls, 0);
});

test("forged admin command and unsigned consent are blocked before contacting Sheets", async () => {
  const x = gatewayApi();
  for (const payload of [
    { action: "setupTemplate", requestId: "d".repeat(32), consent: true },
    { action: "batchSave", requestId: "d".repeat(32), rows: [] },
    { requestId: "d".repeat(32), consent: false }
  ]) {
    const res = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "POST", payload),
      x.env, x.options);
    assert.equal(res.status, 400);
  }
  assert.equal(x.metrics.calls, 0);
});

test("missing or malicious Sheets settings are fail closed", async () => {
  const x = gatewayApi();
  for (const settings of [
    { CAFFEINE_APPS_SCRIPT_URL: "" },
    { CAFFEINE_APPS_SCRIPT_URL: "https://attacker.invalid/api" },
    { CAFFEINE_ATLAS_WRITE_HMAC_KEY: "" }
  ]) {
    const res = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "GET"),
      { ...x.env, ...settings }, x.options);
    assert.equal(res.status, 503);
  }
  assert.equal(x.metrics.calls, 0);
});

test("invalid receipt action and storage failures do not leak internal errors", async () => {
  const x = gatewayApi({ backendFail: true });
  const bad = await handleRequest(apiRequest("/api/caffeine-atlas?action=saveStatus&requestId=bad", signedToken(), "GET"),
    x.env, x.options);
  assert.equal(bad.status, 400);
  assert.equal(x.metrics.calls, 0);
  const outage = await handleRequest(apiRequest("/api/caffeine-atlas", signedToken(), "GET"), x.env, x.options);
  assert.equal(outage.status, 502);
  assert.deepEqual(await outage.json(), { ok: false, code: "STORAGE_UNAVAILABLE" });
});
