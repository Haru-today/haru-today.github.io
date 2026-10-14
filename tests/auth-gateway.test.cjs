"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { handleRequest } = require("../auth-gateway/worker.mjs");

const TEAM = "https://labdam-example.cloudflareaccess.com";
const AUD = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const NOW = Math.floor(Date.now() / 1000);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-signing-key-001", alg: "RS256", use: "sig"
};

function encoded(object) {
  return Buffer.from(JSON.stringify(object)).toString("base64url");
}
function signedToken(claims = {}, options = {}) {
  const header = { alg: "RS256", kid: publicJwk.kid, ...(options.header || {}) };
  const payload = {
    aud: [AUD], iss: TEAM, type: "app", sub: "account-user-id",
    email: "reviewer@labdam.example", iat: NOW - 60, exp: NOW + 3600,
    ...claims
  };
  const body = encoded(header) + "." + encoded(payload);
  return body + "." + sign("RSA-SHA256", Buffer.from(body), options.privateKey || privateKey)
    .toString("base64url");
}
function mocks({ presentAssets = true, certificatesAvailable = true } = {}) {
  const metrics = { assets: 0, jwks: 0, paths: [] };
  const env = { TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  if (presentAssets) env.ASSETS = {
    fetch: async request => {
      metrics.assets++;
      metrics.paths.push(new URL(request.url).pathname);
      return new Response("protected fixture " + new URL(request.url).pathname, {
        status: 200, headers: { "Content-Type": "text/plain" }
      });
    }
  };
  const options = {
    nowSeconds: NOW,
    fetcher: async url => {
      metrics.jwks++;
      assert.equal(url, TEAM + "/cdn-cgi/access/certs");
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: certificatesAvailable ? 200 : 503,
        headers: { "Content-Type": "application/json" }
      });
    }
  };
  return { env, options, metrics };
}
function request(path, token, method = "GET", headers = {}) {
  return new Request("https://services.labdam.example" + path, {
    method, headers: {
      ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...headers
    }
  });
}

const PRIVATE_PATHS = [
  "/", "/index.html", "/account.html", "/privacy.html", "/terms.html",
  "/favicon.svg", "/assets/portal-redesign.css",
  "/labinsight/", "/labinsight/index.html", "/labinsight/checkup.html",
  "/labinsight/report.html", "/labinsight/app.js", "/labinsight/styles.css",
  "/labinsight/account.html", "/api/session"
];

test("anonymous users cannot access LABDAM or LabInsight content, static files or account details", async () => {
  const x = mocks();
  for (const path of PRIVATE_PATHS) {
    const res = await handleRequest(request(path), x.env, x.options);
    assert.equal(res.status, 401, path);
    assert.match(await res.text(), /로그인/);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
  assert.equal(x.metrics.assets, 0);
  assert.equal(x.metrics.jwks, 0);
});

test("valid Cloudflare identity accesses LABDAM homepage itself, not an old public redirect", async () => {
  const x = mocks();
  const res = await handleRequest(request("/", signedToken()), x.env, x.options);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Location"), null);
  assert.match(await res.text(), /protected fixture \//);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.deepEqual(x.metrics.paths, ["/"]);
});

test("same login protects LABDAM and all LabInsight screens and files", async () => {
  const x = mocks();
  const token = signedToken();
  for (const path of PRIVATE_PATHS.filter(p => p !== "/api/session")) {
    const res = await handleRequest(request(path, token), x.env, x.options);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /protected fixture/);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
  assert.equal(x.metrics.assets, PRIVATE_PATHS.length - 1);
});

test("Caffeine Atlas has no protected login route or Google Sheets proxy in this Worker", async () => {
  const x = mocks();
  for (const path of [
    "/caffeine-atlas/", "/caffeine-atlas/caffeine-sensitivity-app/analyzer.html",
    "/api/caffeine-atlas", "/api/caffeine-atlas?action=capabilities",
    "/caffeine-atlas/caffeine-sensitivity-app/account.html"
  ]) {
    for (const token of [null, signedToken()]) {
      const res = await handleRequest(request(path, token), x.env, x.options);
      assert.equal(res.status, 404, path);
    }
  }
  assert.equal(x.metrics.assets, 0);
  assert.equal(x.metrics.jwks, 0);
});

test("Caffeine storage POST is unavailable even with a valid token", async () => {
  const x = mocks();
  const res = await handleRequest(
    request("/api/caffeine-atlas", signedToken(), "POST",
      { "Content-Type": "application/json" }), x.env, x.options
  );
  assert.equal(res.status, 405);
  assert.equal(x.metrics.assets, 0);
});

test("identity headers or fake CF_Authorization cookie do not bypass Access signatures", async () => {
  const x = mocks();
  const res = await handleRequest(request("/", null, "GET", {
    "Cf-Access-Authenticated-User-Email": "forged@labdam.example",
    "Cookie": "CF_Authorization=unverified"
  }), x.env, x.options);
  assert.equal(res.status, 401);
  assert.equal(x.metrics.assets, 0);
});

test("tampered JWT signature, wrong issuer and audience cannot open homepage", async () => {
  const invalidClaims = [
    { iss: "https://attacker.cloudflareaccess.com" },
    { aud: ["00000000000000000000000000000000"] },
    { exp: NOW }, { exp: NOW - 1 },
    { nbf: NOW + 30 }, { iat: NOW + 120 },
    { sub: "" }, { type: "org" }, { exp: "2030-01-01" }
  ];
  for (const claims of invalidClaims) {
    const x = mocks();
    const res = await handleRequest(request("/", signedToken(claims)), x.env, x.options);
    assert.equal(res.status, 401, JSON.stringify(claims));
    assert.equal(x.metrics.assets, 0);
  }
  const x = mocks();
  const badKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const res = await handleRequest(request("/", signedToken({}, { privateKey: badKey })), x.env, x.options);
  assert.equal(res.status, 401);
  assert.equal(x.metrics.assets, 0);
});

test("algorithm confusion and tokens from automation users cannot open LabInsight", async () => {
  for (const alg of ["none", "HS256", "ES256"]) {
    const x = mocks();
    const res = await handleRequest(request("/labinsight/", signedToken({}, {
      header: { alg }
    })), x.env, x.options);
    assert.equal(res.status, 401);
  }
  const x = mocks();
  const res = await handleRequest(request("/labinsight/", signedToken({
    type: "service_token", sub: ""
  })), x.env, x.options);
  assert.equal(res.status, 401);
});

test("missing or invalid Access configuration and unavailable JWKS fail closed", async () => {
  for (const changes of [
    { TEAM_DOMAIN: "" },
    { TEAM_DOMAIN: "http://labdam-example.cloudflareaccess.com" },
    { TEAM_DOMAIN: "https://attacker.example" },
    { ACCESS_AUD: "" },
    { ACCESS_AUD: "not-a-valid-audience" }
  ]) {
    const x = mocks();
    const res = await handleRequest(request("/", signedToken()), { ...x.env, ...changes }, x.options);
    assert.equal(res.status, 503, JSON.stringify(changes));
    assert.equal(x.metrics.assets, 0);
  }
  const x = mocks({ certificatesAvailable: false });
  const res = await handleRequest(request("/", signedToken()), x.env, x.options);
  assert.equal(res.status, 503);
  assert.equal(x.metrics.assets, 0);
});

test("missing private asset binding never serves public source content", async () => {
  const x = mocks({ presentAssets: false });
  const res = await handleRequest(request("/", signedToken()), x.env, x.options);
  assert.equal(res.status, 503);
});

test("only GET/HEAD are supported, directories canonicalize behind authentication", async () => {
  const x = mocks();
  const token = signedToken();
  assert.equal((await handleRequest(request("/", token, "POST"), x.env, x.options)).status, 405);
  assert.equal((await handleRequest(request("/labinsight/", token, "DELETE"), x.env, x.options)).status, 405);
  assert.equal((await handleRequest(request("/index.html", token, "HEAD"), x.env, x.options)).status, 200);
  const redirect = await handleRequest(request("/labinsight", token), x.env, x.options);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("Location"), "https://services.labdam.example/labinsight/");
});

test("authenticated user can read own session email but not storage permissions", async () => {
  const x = mocks();
  const session = await handleRequest(request("/api/session", signedToken()), x.env, x.options);
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authenticated: true, email: "reviewer@labdam.example"
  });
  assert.equal(session.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal((await handleRequest(request("/api/session", null), x.env, x.options)).status, 401);
  assert.equal((await handleRequest(request("/api/session", signedToken(), "HEAD"), x.env, x.options)).status, 405);
  assert.equal(x.metrics.assets, 0);
});

test("logout delegates to Cloudflare, no homemade credentials or local password", async () => {
  const x = mocks();
  const res = await handleRequest(request("/logout"), x.env, x.options);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), TEAM + "/cdn-cgi/access/logout");
  assert.equal(x.metrics.assets, 0);
});

test("unknown routes, staged secrets and README paths cannot be fetched as assets", async () => {
  const x = mocks();
  for (const path of [
    "/admin/", "/auth-gateway/worker.mjs", "/README.md", "/.github/workflows/auth-gateway-ci.yml",
    "/sitemap.xml", "/caffeine-atlas/", "/api/storage"
  ]) {
    assert.equal((await handleRequest(request(path, signedToken()), x.env, x.options)).status, 404, path);
  }
  assert.equal(x.metrics.assets, 0);
});
