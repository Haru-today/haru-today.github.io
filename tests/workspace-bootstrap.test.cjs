"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Real local Git repositories; no GitHub, credentials, or user workspace writes.
const names = ["labdam", "labinsight", "caffeine-atlas"];
const repositories = ["haru-today.github.io.git", "labinsight.git", "caffeine-atlas.git"];
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "labdam-setup-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sources = path.join(temp, "sources");
  fs.mkdirSync(sources);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(temp, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  delete env.LABDAM_AUTH_REPO_URL;
  const git = (...args) => {
    const r = spawnSync("git", args, { env, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr || String(r.error));
  };
  for (const repo of repositories) git("init", "--bare", path.join(sources, repo));
  const fileUrl = require("node:url").pathToFileURL(sources + path.sep).href;
  git("config", "--global", `url.${fileUrl}.insteadOf`, "https://github.com/Haru-today/");
  const run = (root, extra = {}) => {
    const windows = process.platform === "win32";
    const script = path.resolve(__dirname, "../developer", windows ? "setup-windows.ps1" : "setup-macos.sh");
    const args = windows ? ["-NoProfile", "-File", script, "-Root", root] : [script, root];
    return spawnSync(windows ? "pwsh" : "bash", args, { env: { ...env, ...extra }, encoding: "utf8", timeout: 30000 });
  };
  return { temp, sources, run };
}

test("workspace setup creates three repos in a spaced path and preserves uncommitted work on repeat", t => {
  const { temp, run } = fixture(t);
  const root = path.join(temp, "workspace with spaces");
  const first = run(root);
  assert.equal(first.status, 0, first.stderr || String(first.error));
  for (const name of names) assert.ok(fs.statSync(path.join(root, name, ".git")).isDirectory());
  assert.ok(!fs.existsSync(path.join(root, "labdam-auth")));
  const sentinel = path.join(root, "labinsight", "uncommitted.txt");
  fs.writeFileSync(sentinel, "preserve local work\n");
  const config = fs.readFileSync(path.join(root, "labinsight", ".git", "config"));
  const second = run(root);
  assert.equal(second.status, 0, second.stderr || String(second.error));
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve local work\n");
  assert.deepEqual(fs.readFileSync(path.join(root, "labinsight", ".git", "config")), config);
});

test("nonrepository collision stops without overwriting files or creating later repos", t => {
  const { temp, run } = fixture(t);
  const root = path.join(temp, "collision");
  fs.mkdirSync(path.join(root, "labdam"), { recursive: true });
  const sentinel = path.join(root, "labdam", "existing.txt");
  fs.writeFileSync(sentinel, "preserve");
  assert.notEqual(run(root).status, 0);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
  assert.ok(!fs.existsSync(path.join(root, "labinsight")));
});

test("clone failure stops before subsequent repositories", t => {
  const { temp, sources, run } = fixture(t);
  fs.rmSync(path.join(sources, repositories[0]), { recursive: true });
  const root = path.join(temp, "failure");
  assert.notEqual(run(root).status, 0);
  assert.ok(!fs.existsSync(path.join(root, "labinsight")));
});

test("explicit auth source is optional and cloned only when supplied", t => {
  const { temp, sources, run } = fixture(t);
  const root = path.join(temp, "optional auth");
  const r = run(root, { LABDAM_AUTH_REPO_URL: path.join(sources, repositories[0]) });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  assert.ok(fs.statSync(path.join(root, "labdam-auth", ".git")).isDirectory());
});
