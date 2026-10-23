const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const implementationModule = import('../developer/ai-implement.mjs');
const reviewModule = import('../developer/ai-review.mjs');
const HASH = (text) => createHash('sha256').update(text).digest('hex');
const TASK = 'Synthetic task: change the answer to two.';
const SECRET = 'ghp_' + 'A'.repeat(36);
const SCRIPT = resolve(__dirname, '../developer/ai-implement.mjs');

function git(root, args, input) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=' + join(root, 'no-hooks'), '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', input, timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' } });
  assert.equal(result.status, 0, 'Synthetic repository operation failed');
  return result.stdout;
}

function fixture() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'labdam-implementation-test-')));
  const root = join(directory, 'source'), output = join(directory, 'output');
  mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(output);
  writeFileSync(join(root, 'src/app.js'), 'export const answer = 1;\n');
  writeFileSync(join(root, 'README.md'), 'Synthetic repository.\n');
  git(root, ['init', '-q']);
  git(root, ['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'add', 'src/app.js', 'README.md']);
  git(root, ['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic baseline']);
  return { root, output, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

const response = (content = 'export const answer = 2;\n') => JSON.stringify({ summary: 'Update the synthetic answer.',
  changes: [{ file: 'src/app.js', content, reason: 'Implements the supplied synthetic task.' }] });
const completed = (text) => ({ state: 'completed', requestAttempted: true, response: text,
  version: '2.1.309', models: ['claude-test-model'], authentication: { method: 'claude.ai', subscription: 'pro' } });

test('prepare snapshots explicit dirty source without contacting Claude or disclosing task text', async () => {
  const { runImplementation } = await implementationModule; const f = fixture();
  try {
    const dirty = 'export const answer = 1;\n// existing uncommitted work\n';
    writeFileSync(join(f.root, 'src/app.js'), dirty);
    const result = await runImplementation({ cwd: f.root, files: ['src/app.js'], taskText: TASK,
      request: () => { throw new Error('Must not be invoked'); } });
    assert.equal(result.state, 'prepared'); assert.equal(result.requestAttempted, false);
    assert.equal(result.manifest.files[0].sha256, HASH(dirty));
    assert.equal(result.manifest.task.sha256, HASH(TASK));
    assert.equal(result.sourceUnchanged, true); assert.equal(result.applied, false);
    assert.equal(JSON.stringify(result).includes(TASK), false);
    assert.equal(readFileSync(join(f.root, 'src/app.js'), 'utf8'), dirty);
  } finally { f.cleanup(); }
});

test('send validates file proposals, retains exact base hashes, and never applies proposed code or commands', async () => {
  const { runImplementation } = await implementationModule; const f = fixture();
  try {
    let calls = 0;
    const result = await runImplementation({ cwd: f.root, files: ['src/app.js'], taskText: TASK, send: true,
      request: async ({ prompt, cwd }) => {
        calls++; assert.equal(cwd, f.root); assert.ok(prompt.includes(JSON.stringify(TASK)));
        assert.ok(prompt.includes('Do not use tools')); return completed(response());
      } });
    assert.equal(calls, 1); assert.equal(result.state, 'completed'); assert.equal(result.requestAttempted, true);
    const change = result.proposal.changes[0];
    assert.equal(change.baseSha256, HASH('export const answer = 1;\n'));
    assert.equal(change.contentSha256, HASH('export const answer = 2;\n'));
    assert.equal(result.applied, false); assert.equal(result.sourceUnchanged, true);
    assert.equal(readFileSync(join(f.root, 'src/app.js'), 'utf8'), 'export const answer = 1;\n');
    git(f.root, ['apply', '--check', '--whitespace=nowarn', '-'], result.diff);
  } finally { f.cleanup(); }
});

test('response rejects out-of-snapshot paths, duplicates, no-ops, control text, unexpected keys and secrets', async () => {
  const { validateImplementation, MAX_CHANGED_BYTES } = await implementationModule;
  const { prepareReview } = await reviewModule; const f = fixture();
  try {
    const bundle = prepareReview({ cwd: f.root, files: ['src/app.js'] });
    for (const mutate of [
      (v) => { v.changes[0].file = '../escape.js'; },
      (v) => { v.changes[0].file = 'README.md'; },
      (v) => { v.changes.push({ ...v.changes[0] }); },
      (v) => { v.changes[0].content = bundle.snapshots[0].text; },
      (v) => { v.changes[0].content = 'x\0y'; },
      (v) => { v.changes[0].content = '\ud800'; },
      (v) => { v.changes[0].content = 'x'.repeat(MAX_CHANGED_BYTES + 1); },
      (v) => { v.changes[0].content = SECRET; },
      (v) => { v.changes[0].reason = ''; },
      (v) => { v.command = 'do not execute'; },
      (v) => { v.changes[0].baseSha256 = 'invented'; },
    ]) {
      const value = JSON.parse(response()); mutate(value);
      assert.throws(() => validateImplementation(JSON.stringify(value), bundle));
    }
    const escaped = response().replace('export const answer = 2;\\n', Array.from(SECRET).map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
    assert.throws(() => validateImplementation(escaped, bundle));
    assert.deepEqual(validateImplementation('{"summary":"No safe change in this scope.","changes":[]}', bundle).changes, []);
  } finally { f.cleanup(); }
});

test('a source change while waiting makes the proposal stale and removes its code and diff', async () => {
  const { runImplementation } = await implementationModule; const f = fixture();
  try {
    const result = await runImplementation({ cwd: f.root, files: ['src/app.js'], taskText: TASK, send: true,
      request: async () => { writeFileSync(join(f.root, 'src/app.js'), '// independent change\n'); return completed(response()); } });
    assert.equal(result.state, 'stale'); assert.equal(result.reason, 'source_changed');
    assert.equal(result.proposal, null); assert.equal(result.diff, undefined); assert.equal(result.requestAttempted, true);
    assert.equal(readFileSync(join(f.root, 'src/app.js'), 'utf8'), '// independent change\n');
  } finally { f.cleanup(); }
});

test('only one explicit task source is accepted; external task files are bounded and validated', async () => {
  const { runImplementation, MAX_TASK_BYTES } = await implementationModule; const f = fixture();
  try {
    const taskFile = join(f.output, 'task.txt'); writeFileSync(taskFile, TASK);
    const base = { cwd: f.root, files: ['src/app.js'], request: () => { throw new Error('No provider request'); } };
    const valid = await runImplementation({ ...base, taskFile });
    assert.equal(valid.state, 'prepared'); assert.equal(valid.manifest.task.source, 'external_file');
    for (const options of [{}, { taskText: TASK, taskFile }, { taskFile: join(f.root, 'README.md') },
      { taskText: SECRET }, { taskText: 'x'.repeat(MAX_TASK_BYTES + 1) }, { taskText: 'a\0b' }]) {
      const result = await runImplementation({ ...base, ...options });
      assert.equal(result.state, 'blocked'); assert.equal(result.requestAttempted, false);
      assert.equal(JSON.stringify(result).includes(SECRET), false);
    }
  } finally { f.cleanup(); }
});

test('source and external task symlinks are rejected', async (t) => {
  const { runImplementation } = await implementationModule; const f = fixture();
  try {
    try { symlinkSync(join(f.root, 'src/app.js'), join(f.root, 'src/link.js')); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('OS does not permit fixture symlinks'); return; } throw error; }
    const source = await runImplementation({ cwd: f.root, files: ['src/link.js'], taskText: TASK });
    assert.equal(source.state, 'blocked');
    const taskLink = join(f.output, 'task-link.txt'); symlinkSync(join(f.root, 'README.md'), taskLink);
    const task = await runImplementation({ cwd: f.root, files: ['src/app.js'], taskFile: taskLink });
    assert.equal(task.state, 'blocked');
  } finally { f.cleanup(); }
});

test('provider errors and arbitrary provider metadata cannot leak into saved reports', async () => {
  const { runImplementation } = await implementationModule; const f = fixture();
  try {
    for (const request of [async () => { throw new Error(SECRET); },
      async () => ({ ...completed(response()), requestAttempted: false, account: SECRET }),
      async () => ({ state: 'failed', requestAttempted: true, reason: SECRET, stderr: SECRET }),
      async () => ({ ...completed('invalid ' + SECRET), account: SECRET, models: [SECRET] })]) {
      const result = await runImplementation({ cwd: f.root, files: ['src/app.js'], taskText: TASK, send: true, request });
      assert.equal(result.exitCode, 1); assert.equal(result.proposal, null);
      assert.equal(JSON.stringify(result).includes(SECRET), false);
    }
  } finally { f.cleanup(); }
});

test('unified diffs preserve insertion, removal, CRLF, empty files and missing final newlines', async () => {
  const { validateImplementation, implementationDiff } = await implementationModule;
  const { prepareReview } = await reviewModule; const f = fixture();
  try {
    for (const [before, after] of [['', 'new\n'], ['old\n', ''], ['one', 'two'], ['one', 'one\n'],
      ['one\r\ntwo\r\n', 'one\r\nchanged\r\n'], ['a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nnew\nd\ne\nf\ng\nlast\n']]) {
      writeFileSync(join(f.root, 'src/app.js'), before);
      const bundle = prepareReview({ cwd: f.root, files: ['src/app.js'] });
      const proposal = validateImplementation(response(after), bundle);
      const diff = implementationDiff(proposal, bundle);
      git(f.root, ['apply', '--whitespace=nowarn', '-'], diff);
      assert.equal(readFileSync(join(f.root, 'src/app.js'), 'utf8'), after);
      assert.throws(() => implementationDiff({ ...proposal, changes: [{ ...proposal.changes[0], baseSha256: 'wrong' }] }, bundle));
    }
  } finally { f.cleanup(); }
});

test('artifacts require new outside-repository files and reservation failure cleans only owned empty files', async () => {
  const { reserveImplementationOutputs, releaseImplementationOutputs } = await implementationModule; const f = fixture();
  try {
    assert.throws(() => reserveImplementationOutputs({ root: f.root, output: join(f.root, 'inside.json') }));
    const output = join(f.output, 'proposal.json'), diffOutput = join(f.output, 'existing.patch');
    writeFileSync(diffOutput, 'preserve');
    assert.throws(() => reserveImplementationOutputs({ root: f.root, output, diffOutput }));
    assert.equal(existsSync(output), false); assert.equal(readFileSync(diffOutput, 'utf8'), 'preserve');
    const files = reserveImplementationOutputs({ root: f.root, output });
    assert.equal(files.length, 2); releaseImplementationOutputs(files, true);
    assert.equal(existsSync(output), false); assert.equal(existsSync(output + '.patch'), false);
  } finally { f.cleanup(); }
});

test('CLI defaults to prepare, requires output before send, and offers no automatic apply command', () => {
  const f = fixture();
  try {
    const invoke = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: f.root,
      env: { ...process.env, ANTHROPIC_API_KEY: SECRET }, encoding: 'utf8', timeout: 20000 });
    const prepared = invoke(['--file', 'src/app.js', '--task', TASK]);
    assert.equal(prepared.status, 0); assert.equal(JSON.parse(prepared.stdout).state, 'prepared');
    assert.equal(prepared.stdout.includes(TASK), false);
    const savedPath = join(f.output, 'prepared.json');
    const saved = invoke(['--file', 'src/app.js', '--task', TASK, '--output', savedPath]);
    assert.equal(saved.status, 0); assert.equal(JSON.parse(saved.stdout).requestAttempted, false);
    assert.equal(JSON.parse(readFileSync(savedPath, 'utf8')).state, 'prepared');
    assert.ok(readFileSync(savedPath + '.patch', 'utf8').length > 0);
    assert.equal(readFileSync(savedPath, 'utf8').includes(TASK), false);
    for (const args of [['--file', 'src/app.js', '--task', TASK, '--send'], ['apply', 'anything.json']]) {
      const result = invoke(args); assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).requestAttempted, false);
      assert.equal(result.stdout.includes(SECRET), false);
    }
    assert.equal(readFileSync(join(f.root, 'src/app.js'), 'utf8'), 'export const answer = 1;\n');
  } finally { f.cleanup(); }
});
