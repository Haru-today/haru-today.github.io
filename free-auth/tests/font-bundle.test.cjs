const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const vm = require("node:vm");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const realPins = {
  "inference.onnx": "92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08",
  "dictionary.json": "83c2b25b578830f02edef419c43d4bcf9c6115cb0e43c3e6737b737e0a5551b9",
  "ort.min.js": "2b864e555e4fe52cb1ea761e4e979a46cd5ea2587dcefeed63436a349dc24180",
  "ort-wasm-simd-threaded.mjs": "90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e",
  "ort-wasm-simd-threaded.wasm": "45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15",
  "paddle-cell-worker.js": "a432ada8f179bfd07341f9a9f192c56e6a63a78e70d61b39977afaed4875f305",
  "paddle-ocr-core.js": "ce5e274723653c90dd9d0f0324e4c17bb430cb390ba0fe016eb14d39764f1834",
  "LICENSE-PADDLE-APACHE-2.0.txt": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  "LICENSE-ONNXRUNTIME.txt": "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
  "THIRD-PARTY-ONNXRUNTIME.txt": "e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc"
};
const assetNames = Object.keys(realPins).slice(0, 5);
function cleanup(root) {
  // Only remove this test's resolved, immediate child of the OS temp directory.
  const tmp = fs.realpathSync(os.tmpdir());
  const actual = fs.realpathSync(root);
  if (path.dirname(actual) !== tmp || !path.basename(actual).startsWith("labdam-font-test-")) throw Error("Unsafe temporary cleanup path");
  fs.rmSync(actual, { recursive: true, force: true });
}

// Only synthetic source files are used; each invocation gets its own dist.
function buildFixture(fontFiles, paddle = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "labdam-font-test-"));
  const auth = path.join(root, "free-auth");
  const portal = path.join(root, "portal");
  const lab = path.join(root, "lab");
  fs.mkdirSync(auth); fs.mkdirSync(path.join(portal, "assets"), { recursive: true });
  fs.mkdirSync(path.join(lab, "icons"), { recursive: true });
  let build = fs.readFileSync(path.join(__dirname, "../build.mjs"), "utf8");
  const synthetic = Object.fromEntries(Object.keys(realPins).map(name => [name, `synthetic-${name}`]));
  // Inject synthetic test pins into the copied builder only; production pins never change.
  for (const [name, original] of Object.entries(realPins)) build = build.replace(original, hash(synthetic[name]));
  fs.writeFileSync(path.join(auth, "build.mjs"), build);
  for (const file of ["portal-session.js", "login.html", "pending.html", "account.html", "admin.html", "membership-privacy.html", "handoff.js", "handoff.html"]) fs.writeFileSync(path.join(auth, file), "synthetic");
  fs.writeFileSync(path.join(portal, "index.html"), '<head></head><a id="portalAccountLink"></a><a id="portalGoogleStart"></a>');
  fs.writeFileSync(path.join(portal, "privacy.html"), '<head></head><main class="shell">포털에는 이름·검사값 입력란이 없습니다.');
  fs.writeFileSync(path.join(portal, "terms.html"), '<head></head><main class="shell">');
  fs.writeFileSync(path.join(portal, "favicon.svg"), "synthetic");
  fs.writeFileSync(path.join(portal, "assets/portal-redesign.css"), "synthetic");
  for (const file of ["index.html", "checkup.html", "report.html", "hospitals.html", "carepath.html"]) fs.writeFileSync(path.join(lab, file), '<head></head><a class="nav-cta">');
  for (const file of ["styles.css", "carepath.js", "carepath-data.js", "ocr-review.js", "reference-ranges.js", "hospital-data.js", "runtime-config.js", "manifest.webmanifest"]) fs.writeFileSync(path.join(lab, file), "synthetic");
  fs.writeFileSync(path.join(lab, "runtime-config.js"), 'window.LABINSIGHT_CONFIG = Object.freeze({apiBaseUrl: "", paddleCellEnabled: true});');
  fs.writeFileSync(path.join(lab, "app.js"), 'if (cache) cache.textContent = "오프라인 준비 완료";\nif (cache) cache.textContent = "오프라인 캐시 대기";');
  fs.writeFileSync(path.join(lab, "icons/icon.svg"), "synthetic");
  if (fontFiles) {
    fs.mkdirSync(path.join(lab, "fonts"));
    for (const [name, data] of Object.entries(fontFiles)) fs.writeFileSync(path.join(lab, "fonts", name), data);
  }
  fs.mkdirSync(path.join(lab, "vendor", "paddle"), { recursive: true });
  fs.mkdirSync(path.join(auth, "licenses"));
  for (const [name, value] of Object.entries(synthetic)) {
    const dir = assetNames.includes(name) ? path.join(lab, "vendor", "paddle") : name.endsWith(".txt") ? path.join(auth, "licenses") : lab;
    fs.writeFileSync(path.join(dir, name), value);
  }
  const manifest = Object.fromEntries(assetNames.map(name => [name, hash(synthetic[name])]));
  if (paddle.bad === "manifest") manifest[assetNames[0]] = "0".repeat(64);
  fs.writeFileSync(path.join(lab, "paddle-assets.json"), JSON.stringify({ sha256: manifest }));
  if (paddle.bad === "asset") fs.writeFileSync(path.join(lab, "vendor/paddle/inference.onnx"), "changed");
  if (paddle.bad === "worker") fs.writeFileSync(path.join(lab, "paddle-cell-worker.js"), "changed");
  if (paddle.bad === "core") fs.writeFileSync(path.join(lab, "paddle-ocr-core.js"), "changed");
  if (paddle.bad === "license") fs.writeFileSync(path.join(auth, "licenses/LICENSE-ONNXRUNTIME.txt"), "changed");
  if (paddle.bad === "missing") fs.unlinkSync(path.join(lab, "vendor/paddle/dictionary.json"));
  const env = { ...process.env, LABDAM_SOURCE: portal, LABINSIGHT_SOURCE: lab };
  delete env.LABDAM_INCLUDE_PADDLE;
  if (paddle.enabled) env.LABDAM_INCLUDE_PADDLE = "1";
  const result = spawnSync(process.execPath, [path.join(auth, "build.mjs")], { encoding: "utf8", env });
  return { root, output: path.join(auth, "dist", "labinsight", "fonts"), bundle: path.join(auth, "dist", "labinsight"), result, synthetic };
}

test("protected bundle copies only approved synthetic fonts and their exact licenses", () => {
  const files = { "Pretendard-Regular.subset.woff2": "pretendard", "WantedSans-Bold.subset.woff2": "wanted", "LICENSE-Pretendard.txt": "pretendard license", "OFL-WantedSans.txt": "wanted license", "unrelated.txt": "private" };
  const fixture = buildFixture(files);
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    for (const name of Object.keys(files).filter(name => name !== "unrelated.txt")) assert.equal(fs.readFileSync(path.join(fixture.output, name), "utf8"), files[name]);
    assert.equal(fs.existsSync(path.join(fixture.output, "unrelated.txt")), false);
  } finally { cleanup(fixture.root); }
});

test("font without corresponding license fails closed", () => {
  for (const name of ["Pretendard-Regular.subset.woff2", "WantedSans-Bold.subset.woff2"]) {
    const fixture = buildFixture({ [name]: "synthetic" });
    try { assert.notEqual(fixture.result.status, 0); assert.match(fixture.result.stderr, /Missing font license/); }
    finally { cleanup(fixture.root); }
  }
});

test("older reviewed sources without a fonts directory still build", () => {
  const fixture = buildFixture(null);
  try { assert.equal(fixture.result.status, 0, fixture.result.stderr); assert.equal(fs.existsSync(fixture.output), false); }
  finally { cleanup(fixture.root); }
});

test("Paddle is disabled by default and no Paddle files are copied", () => {
  const fixture = buildFixture(null);
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(fixture.bundle, "runtime-config.js"), "utf8"), context);
    assert.equal(context.window.LABINSIGHT_CONFIG.paddleCellEnabled, false);
    assert.equal(context.window.LABINSIGHT_CONFIG.ocrCandidatesApplyDisabled, true);
    assert.equal(fs.existsSync(path.join(fixture.bundle, "paddle-cell-worker.js")), false);
    assert.equal(fs.existsSync(path.join(fixture.bundle, "vendor/paddle")), false);
  } finally { cleanup(fixture.root); }
});

test("opt-in packages only pinned synthetic assets, code and licenses and enables the setting", () => {
  const fixture = buildFixture(null, { enabled: true });
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(fixture.bundle, "runtime-config.js"), "utf8"), context);
    assert.equal(context.window.LABINSIGHT_CONFIG.paddleCellEnabled, true);
    assert.equal(context.window.LABINSIGHT_CONFIG.ocrCandidatesApplyDisabled, true);
    for (const [name, value] of Object.entries(fixture.synthetic)) {
      const subdir = name.startsWith("paddle-") ? "" : "vendor/paddle";
      assert.equal(fs.readFileSync(path.join(fixture.bundle, subdir, name), "utf8"), value);
    }
    assert.equal(fs.readdirSync(path.join(fixture.bundle, "vendor/paddle")).length, 8);
  } finally { cleanup(fixture.root); }
});

test("opt-in rejects a changed manifest, asset, worker, core or license, and missing assets before creating a bundle", () => {
  for (const bad of ["manifest", "asset", "worker", "core", "license", "missing"]) {
    const fixture = buildFixture(null, { enabled: true, bad });
    try { assert.notEqual(fixture.result.status, 0, bad); assert.equal(fs.existsSync(fixture.bundle), false, bad); }
    finally { cleanup(fixture.root); }
  }
});
