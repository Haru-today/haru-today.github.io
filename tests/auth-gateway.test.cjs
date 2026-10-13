"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
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
