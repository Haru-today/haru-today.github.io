"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Real local Git repositories; no GitHub, credentials, or user workspace writes.
const names = ["labdam", "labinsight", "caffeine-atlas"];
const repositories = ["haru-today.github.io.git", "repodam.git", "caffeine-atlas.git"];
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
    return r.stdout.trim();
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
  return { temp, sources, run, git };
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

test("canonical app source is cloned while legacy origins and dirty app files remain unchanged", t => {
  const { temp, run, git } = fixture(t);
  const root = path.join(temp, "app rename");
  assert.equal(run(root).status, 0);
  const app = path.join(root, "labinsight");
  assert.equal(git("-C", app, "config", "--get", "remote.origin.url"), "https://github.com/Haru-today/repodam.git");
  const sentinel = path.join(app, "uncommitted.txt");
  fs.writeFileSync(sentinel, "preserve app work\n");
  for (const origin of ["https://github.com/Haru-today/labinsight.git", "git@github.com:Haru-today/labinsight.git", "ssh://git@github.com/HARU-TODAY/REPODAM.git"]) {
    git("-C", app, "remote", "set-url", "origin", origin);
    assert.equal(run(root).status, 0);
    assert.equal(git("-C", app, "config", "--get", "remote.origin.url"), origin);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve app work\n");
  }
  git("-C", app, "remote", "set-url", "origin", "https://github.com/unrelated/repodam.git");
  assert.notEqual(run(root).status, 0);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve app work\n");
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
  const repeat = run(root, { LABDAM_AUTH_REPO_URL: path.join(sources, repositories[0]) });
  assert.equal(repeat.status, 0, repeat.stderr || String(repeat.error));
});

test("linked worktree is recognized and preserves its branch and uncommitted work", t => {
  const { temp, run, git } = fixture(t);
  const root = path.join(temp, "linked workspace");
  const seed = path.join(temp, "seed");
  const dest = path.join(root, "labdam");
  git("clone", "https://github.com/Haru-today/haru-today.github.io.git", seed);
  git("-C", seed, "-c", "user.name=Workspace test", "-c", "user.email=workspace@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  git("-C", seed, "worktree", "add", "-b", "fixture-linked", dest);
  const head = git("-C", dest, "rev-parse", "HEAD");
  const marker = fs.readFileSync(path.join(dest, ".git"));
  const sentinel = path.join(dest, "uncommitted.txt");
  fs.writeFileSync(sentinel, "preserve linked work\n");
  const result = run(root);
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.deepEqual(fs.readFileSync(path.join(dest, ".git")), marker);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve linked work\n");
  assert.equal(git("-C", dest, "rev-parse", "HEAD"), head);
  assert.equal(git("-C", dest, "branch", "--show-current"), "fixture-linked");
});

test("unexpected origin stops without disclosing URL credentials or touching later repositories", t => {
  const { temp, run, git } = fixture(t);
  const root = path.join(temp, "wrong origin");
  const dest = path.join(root, "labdam");
  git("init", dest);
  const credential = "fixture-secret-not-real";
  const origin = `https://${credential}@github.com/unexpected/project.git`;
  git("-C", dest, "remote", "add", "origin", origin);
  const sentinel = path.join(dest, "uncommitted.txt");
  fs.writeFileSync(sentinel, "preserve");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");
  assert.equal(git("-C", dest, "config", "--get", "remote.origin.url"), origin);
  assert.ok(!fs.existsSync(path.join(root, "labinsight")));
  assert.ok(!(result.stdout + result.stderr).includes(credential));
  assert.ok(!(result.stdout + result.stderr).includes(origin));
});

test("equivalent GitHub SSH and HTTPS origins preserve existing repositories", t => {
  const { temp, run, git } = fixture(t);
  const origins = [
    "git@github.com:Haru-today/haru-today.github.io.git",
    "ssh://git@github.com/Haru-today/haru-today.github.io",
    "ssh://git@github.com:22/haru-today/haru-today.github.io.git",
    "https://fixture-secret-not-real@github.com/HARU-TODAY/haru-today.github.io.git/",
  ];
  for (const [index, origin] of origins.entries()) {
    const root = path.join(temp, `equivalent ${index}`);
    const dest = path.join(root, "labdam");
    git("init", dest);
    git("-C", dest, "remote", "add", "origin", origin);
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(git("-C", dest, "config", "--get", "remote.origin.url"), origin);
    assert.ok(!(result.stdout + result.stderr).includes("fixture-secret-not-real"));
  }
});

test("missing or ambiguous origin stops before cloning later repositories", t => {
  const { temp, run, git } = fixture(t);
  for (const ambiguous of [false, true]) {
    const root = path.join(temp, ambiguous ? "multiple origins" : "no origin");
    const dest = path.join(root, "labdam");
    git("init", dest);
    if (ambiguous) {
      git("-C", dest, "remote", "add", "origin", "https://github.com/Haru-today/haru-today.github.io.git");
      git("-C", dest, "config", "--add", "remote.origin.url", "https://github.com/other/project.git");
    }
    assert.notEqual(run(root).status, 0);
    assert.ok(!fs.existsSync(path.join(root, "labinsight")));
  }
});

test("failed optional auth clone does not disclose credentials from its URL", t => {
  const { temp, sources, run, git } = fixture(t);
  const credential = "fixture-secret-not-real";
  const prefix = `https://${credential}@github.com/Haru-today/`;
  const fileUrl = require("node:url").pathToFileURL(sources + path.sep).href;
  git("config", "--global", "--add", `url.${fileUrl}.insteadOf`, prefix);
  const result = run(path.join(temp, "auth clone failure"), { LABDAM_AUTH_REPO_URL: prefix + "missing.git" });
  assert.notEqual(result.status, 0);
  assert.ok(!(result.stdout + result.stderr).includes(credential));
  assert.ok(!(result.stdout + result.stderr).includes(prefix));
});
