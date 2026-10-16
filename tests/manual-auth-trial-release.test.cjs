"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const yaml = fs.readFileSync(path.join(__dirname, "../.github/workflows/manual-auth-trial-release.yml"), "utf8");

test("trial release is explicitly manual, not a push/PR/scheduled deployment", () => {
  assert.match(yaml, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /^  (push|pull_request|schedule|repository_dispatch):/m);
  assert.match(yaml, /confirmation == 'DEPLOY-LABDAM-TRIAL'/);
  assert.match(yaml, /environment: labdam-trial/);
  assert.match(yaml, /permissions:\n  contents: read/);
});

test("trial release bundles only reviewed immutable commits with fixed worker config", () => {
  assert.match(yaml, /ref: b7f6847e38bb6695299182652f67abd59713e6ca/);
  assert.match(yaml, /ref: 7388d1a3884e06c7765d01260f5645c2f3e20b58/);
  assert.match(yaml, /node free-auth\/build\.mjs/);
  assert.match(yaml, /node free-auth\/scripts\/preflight-static\.mjs --require-real-d1/);
  assert.match(yaml, /wrangler@4\.151\.0 deploy --config free-auth\/wrangler\.jsonc/);
  assert.doesNotMatch(yaml, /d1 migrations apply|route:|zone_id:/);
});

test("Cloudflare token is injected only as a GitHub Secret and no real identity is printed", () => {
  assert.match(yaml, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(yaml, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(yaml, /[A-Z0-9_]+=(?:sk-|eyJ|cf_api_)/);
  assert.match(yaml, /Read-only anonymous HTTP checks/);
  assert.match(yaml, /TRIAL_ORIGIN: https:\/\/labdam-free-approval\.jleegenomics\.workers\.dev/);
  assert.match(yaml, /test "\$gate" = 401/);
  assert.match(yaml, /test "\$redirect" = 303/);
});

test("release cannot accidentally bundle protected Caffeine Atlas assets", () => {
  assert.match(yaml, /test ! -e free-auth\/dist\/caffeine-atlas/);
  assert.match(yaml, /node --test free-auth\/tests\/bundle\.test\.cjs/);
  assert.match(yaml, /npm test --prefix free-auth\/tests\/runtime/);
});

test("remote D1 schema is read-only checked before deployment and without access to rows", () => {
  const schema = yaml.indexOf("Verify remote D1 has the expected schema");
  const deploy = yaml.indexOf("Deploy to named free test Worker");
  assert.ok(schema !== -1 && deploy !== -1 && schema < deploy);
  assert.ok(yaml.includes("wrangler@4.151.0 d1 execute labdam-membership"));
  assert.ok(yaml.includes("--config free-auth/wrangler.jsonc --remote"));
  assert.ok(yaml.includes("--command \"SELECT m.status, s.token_hash, o.nonce, t.attempts FROM members m, sessions s, oauth_states o, login_throttle t WHERE 0 LIMIT 0\""));
  assert.doesNotMatch(yaml, /d1 migrations apply/);
});

test("full post-deploy read-only protected route and Caffeine QR probe is required", () => {
  assert.ok(yaml.includes('node free-auth/scripts/probe-trial-worker.mjs --origin "$TRIAL_ORIGIN"'));
});

test("trial release checks the healthy bound-service response, not just HTTP 200", () => {
  assert.ok(yaml.includes(`grep -q '"readiness":"bindings-present"'`));
});
