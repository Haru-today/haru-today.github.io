"use strict";
// Synthetic local D1 and a temporary copy of a local reviewed static build only.
// No Cloudflare account, real member, real OAuth exchange, or deployment.
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), { createHash } = require("node:crypto");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const authRoot = path.resolve(__dirname, "../.."), source = process.env.LABDAM_PRODAM_REVIEW_SOURCE;
const origin = "https://labdam-test.workers.dev";
test("real local asset binding gates PRODAM files and rechecks revocation", { skip: !source && "requires the local reviewed PRODAM dist", timeout: 120000 }, async t => {
  const tempRoot = path.resolve(os.tmpdir()), temporary = fs.mkdtempSync(path.join(tempRoot, "prodam-auth-synthetic-"));
  let mf, off;
  t.after(async () => {
    if (mf) await mf.dispose();
    if (off) await off.dispose();
    // Only the exact empty-or-created fixture under the OS temp directory is removed.
    if (path.dirname(temporary) !== tempRoot || !path.basename(temporary).startsWith("prodam-auth-synthetic-")) throw Error("unsafe fixture cleanup");
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const resolvedSource = path.resolve(source);
  assert.ok(fs.statSync(path.join(resolvedSource, "index.html")).isFile());
  fs.cpSync(resolvedSource, path.join(temporary, "prodam"), { recursive: true, errorOnExist: true, force: false });
  fs.copyFileSync(path.join(authRoot, "login.html"), path.join(temporary, "login.html"));
  mf = new Miniflare(convertV4MiniflareOptions({ name: "prodam-synthetic", modules: true, modulesRoot: authRoot,
    scriptPath: path.join(authRoot, "worker.mjs"), compatibilityDate: "2026-10-14", host: "127.0.0.1",
    bindings: { AUTH_ORIGIN: origin, PRODAM_REVIEW_ONLY: "1", PRODAM_REVIEW_ORIGIN: origin,
      GOOGLE_CLIENT_ID: "123456789-test.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "synthetic-secret-never-a-real-client", RATE_LIMIT_SECRET: "local-synthetic-rate-limit-secret-32-characters" },
    d1Databases: { DB: "synthetic-prodam-only" }, outboundService: () => { throw Error("outbound disabled"); },
    assets: { directory: temporary, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } }
  }));
  const db = await mf.getD1Database("DB"), sql = fs.readFileSync(path.join(authRoot, "migrations/0001_initial.sql"), "utf8").replace(/--[^\n]*/g, "");
  for (const statement of sql.split(";").filter(s => s.trim())) await db.prepare(statement).run();
  const request = (url, cookie = "", method = "GET") => mf.dispatchFetch(origin + url, { method, headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  const collect = (dir, prefix = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const rel = prefix ? prefix + "/" + entry.name : entry.name, full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error("review fixture contains a symlink");
    return entry.isDirectory() ? collect(full, rel) : entry.isFile() ? ["/prodam/" + rel] : [];
  });
  const files = ["/prodam/", ...collect(path.join(temporary, "prodam"))];
  assert.ok(files.includes("/prodam/index.html") && files.some(file => file.endsWith(".wasm")));
  assert.ok(files.every(file => /^[A-Za-z0-9._/-]+$/.test(file)), "all filenames must be accepted by the review gate");
  off = new Miniflare(convertV4MiniflareOptions({ name: "prodam-flag-off", modules: true, modulesRoot: authRoot,
    scriptPath: path.join(authRoot, "worker.mjs"), compatibilityDate: "2026-10-14", host: "127.0.0.1",
    bindings: { AUTH_ORIGIN: origin }, d1Databases: { DB: "synthetic-prodam-off" },
    outboundService: () => { throw Error("outbound disabled"); },
    assets: { directory: temporary, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } }
  }));
  for (const file of files) {
    for (const cookie of ["", "__Host-labdam_session=" + "a".repeat(64)]) {
      const response = await off.dispatchFetch(origin + file, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
      assert.equal(response.status, 404, "flag off: " + file);
    }
  }
  for (const file of files) { const response = await request(file); assert.equal(response.status, file.endsWith("/") || file.endsWith(".html") ? 303 : 401, file); assert.match(response.headers.get("cache-control"), /no-store/); }
  const now = Math.floor(Date.now()/1000), sub = "synthetic-prodam-user", token = "a".repeat(64), tokenHash = createHash("sha256").update(token).digest("hex");
  await db.prepare("INSERT INTO members(google_sub,email,display_name,status,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(sub, "synthetic@example.invalid", "Synthetic", "approved", "member", now, now).run();
  await db.prepare("INSERT INTO sessions(token_hash,google_sub,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)").bind(tokenHash, sub, "c".repeat(64), now+3600, now).run();
  const cookie = "__Host-labdam_session=" + token;
  const page = await request("/prodam/", cookie); assert.equal(page.status, 200, "approved navigation must serve the real app, not redirect in a loop"); assert.match(await page.text(), /PRODAM/);
  for (const file of files.filter(file => file !== "/prodam/")) {
    const response = await request(file, cookie);
    if (file === "/prodam/index.html" && response.status === 307) { assert.equal(new URL(response.headers.get("location"), origin).pathname, "/prodam/"); continue; }
    assert.equal(response.status, 200, file); assert.match(response.headers.get("cache-control"), /no-store/, file);
  }
  const wasm = await request("/prodam/vendor/primer3/primer3-core.wasm", cookie); assert.equal(wasm.status, 200); assert.match(wasm.headers.get("content-type"), /application\/wasm/); assert.match(wasm.headers.get("cache-control"), /no-store/); assert.equal(wasm.headers.get("cross-origin-resource-policy"), "same-origin");
  await db.prepare("UPDATE members SET status='rejected' WHERE google_sub=?").bind(sub).run();
  for (const file of files) {
    const response = await request(file, cookie);
    const html = file.endsWith("/") || file.endsWith(".html");
    assert.equal(response.status, html ? 303 : 403, file);
    if (html) assert.equal(new URL(response.headers.get("location"), origin).pathname, "/pending.html");
  }
});
