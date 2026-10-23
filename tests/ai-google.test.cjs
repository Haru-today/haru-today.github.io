const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const googleModule = import('../developer/ai-google.mjs');
const SECRET = 'PRIVATE_ACCOUNT_TOKEN_MUST_NOT_ESCAPE';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'google-config-test-'));
  const put = (path, value) => {
    const target = join(home, path);
    mkdirSync(require('node:path').dirname(target), { recursive: true });
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { home, put, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

async function streamScenario({ tools, agent, mode = 'request-review', onPrompt,
  noInit = false, initCwd, tail = false, exitCode = 0, error, timeoutMs = 1000 } = {}) {
  const { runGoogleStream, GOOGLE_AGENT, GOOGLE_TOOL_CATALOG } = await googleModule;
  tools ??= [...GOOGLE_TOOL_CATALOG];
  let sent = '', killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const emit = (value) => child.stdout.write(`${JSON.stringify(value)}\n`);
  child.stdin = new Writable({ write(chunk, encoding, done) { sent += chunk.toString(); done(); } });
  child.stdin.on('finish', () => {
    if (onPrompt) onPrompt({ child, emit });
    else {
      const value = { event: 'result', result: { status: 'SUCCESS', num_turns: 1, response: '{"findings":[]}' } };
      if (tail) child.stdout.write(JSON.stringify(value)); else emit(value);
      setImmediate(() => child.emit('close', exitCode, null));
    }
  });
  child.kill = () => { killed = true; setImmediate(() => child.emit('close', null, 'SIGKILL')); };
  const result = await runGoogleStream({ command: '/synthetic/cli', args: [],
    options: { cwd: '/isolated/review', env: {} }, prompt: 'public review packet', timeoutMs,
    spawnProcess: (command, args, options) => {
      assert.equal(options.shell, false); assert.equal(options.detached, true);
      queueMicrotask(() => {
        child.stderr.write(SECRET);
        if (error) { child.emit('error', new Error(SECRET)); return; }
        if (!noInit) emit({ event: 'init', init: { cwd: initCwd ?? '/isolated/review', tools,
          agent: agent ?? GOOGLE_AGENT, permission_mode: mode } });
      });
      return child;
    } });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  return { result, sent, killed };
}

test('configuration preserves sparse credit-off defaults and accepts an empty installed MCP file', async () => {
  const { inspectGoogleConfiguration } = await googleModule;
  const f = fixture();
  try {
    f.put('.gemini/antigravity-cli/settings.json', { trustedWorkspaces: ['/synthetic'] });
    f.put('.gemini/config/mcp_config.json', '');
    assert.equal(inspectGoogleConfiguration(f.home), null);
    f.put('.gemini/antigravity-cli/settings.json', { useG1Credits: false, modelProvider: '' });
    assert.equal(inspectGoogleConfiguration(f.home), null);
  } finally { f.cleanup(); }
});

test('credits, API/cloud routes, executable customizations, and malformed settings block safely', async () => {
  const { inspectGoogleConfiguration } = await googleModule;
  for (const settings of [{ useG1Credits: true }, { useG1Credits: 'false' },
    { modelProvider: 'gemini' }, { gcp: { project: SECRET } },
    { customModelsConfig: { customModels: [SECRET] } }, { apiKey: SECRET },
    { enableAdc: true }, { permissions: { allow: ['command(*)'] } },
    { userSettings: { enableAdc: true } }, { userSettings: { permissions: { allow: ['read_file(*)'] } } },
    { allowNonWorkspaceAccess: true }, { agentMode: 'auto' },
    { statusLine: { command: SECRET } }, { model: `gemini-api://${SECRET}` }, '[']) {
    const f = fixture();
    try {
      f.put('.gemini/antigravity-cli/settings.json', settings);
      const reason = inspectGoogleConfiguration(f.home);
      assert.equal(typeof reason, 'string'); assert.equal(reason.includes(SECRET), false);
    } finally { f.cleanup(); }
  }
});

test('global hooks, plugin files, sidecars, and nonempty MCP configurations are never silently ignored', async () => {
  const { inspectGoogleConfiguration } = await googleModule;
  for (const [path, value] of [['.gemini/config/hooks.json', {}], ['.gemini/config/sidecars.json', {}],
    ['.gemini/config/plugins/plugin/plugin.json', {}], ['.gemini/config/mcp_config.json', { mcpServers: { example: { command: SECRET } } }]]) {
    const f = fixture();
    try { f.put(path, value); assert.equal(inspectGoogleConfiguration(f.home), 'global_customization_present'); }
    finally { f.cleanup(); }
  }
});

test('provider environment is blocked without reading or returning values', async () => {
  const { googleProviderEnvironment } = await googleModule;
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'CLOUDSDK_AUTH_ACCESS_TOKEN', 'AGY_API_KEY', 'JETSKI_OAUTH_TOKEN', 'ANTIGRAVITY_CONFIG', 'DYLD_INSERT_LIBRARIES']) {
    assert.equal(googleProviderEnvironment({ [key]: SECRET }), true);
  }
  assert.equal(googleProviderEnvironment({ HOME: '/synthetic', PATH: '/usr/bin', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }), false);
});

test('OS policy blocks checkout reads and writes, Documents writes, and settings mutation', async () => {
  const { googleSandboxProfile } = await googleModule;
  const home = join(tmpdir(), 'example-home'), cwd = join(home, 'Documents', 'code');
  const temporary = join(tmpdir(), 'review');
  const profile = googleSandboxProfile({ cwd, home, temporary, cli: join(tmpdir(), 'tools', 'agy') });
  const quoted = JSON.stringify;
  assert.ok(profile.includes(`(deny file-read* (subpath ${quoted(cwd)}))`));
  assert.ok(profile.includes(`(deny file-write* (subpath ${quoted(join(home, 'Documents'))}))`));
  assert.ok(profile.includes(`(deny file-write* (literal ${quoted(join(home, '.gemini/antigravity-cli/settings.json'))}))`));
  assert.ok(profile.includes(`(deny file-write* (subpath ${quoted(join(temporary, '.agents'))}))`));
  assert.ok(profile.includes(`(deny file-read-data (require-all (subpath ${quoted(home)})`));
  assert.ok(profile.includes('(deny process-exec (require-all'));
  assert.ok(profile.includes('(require-not (literal "/usr/bin/security"))'));
  assert.ok(profile.includes(`(require-not (subpath ${quoted(join(home, 'Library/Keychains'))}))`));
  assert.equal(profile.includes('(allow file-write'), false);
});

test('writable runtime cannot gain hooks, MCP servers, plugins or other customizations', async () => {
  const { googleSandboxProfile } = await googleModule;
  const home = join(tmpdir(), 'example-home'), runtime = join(home, '.gemini/antigravity-cli');
  const profile = googleSandboxProfile({ cwd: join(home, 'Documents/code'), home,
    temporary: join(tmpdir(), 'review'), cli: join(tmpdir(), 'tools/agy') });
  for (const [kind, names] of [['literal', ['mcp_config.json', 'hooks.json', 'sidecars.json', 'plugins.json', 'agents.json']],
    ['subpath', ['hooks', 'sidecars', 'plugins', 'agents', 'skills', 'rules']]]) {
    for (const name of names) for (const operation of ['file-read*', 'file-write*']) {
      assert.ok(profile.includes(`(deny ${operation} (${kind} ${JSON.stringify(join(runtime, name))}))`));
    }
  }
});

test('one prompt is sent only after the known catalog, selected agent, permission mode and cwd are verified', async () => {
  const { result, sent } = await streamScenario();
  assert.equal(result.state, 'completed'); assert.equal(result.requestAttempted, true);
  assert.equal(result.response, '{"findings":[]}');
  assert.deepEqual(JSON.parse(sent), { event: 'user', message: { content: 'public review packet' } });
});

test('unknown tools, default agent, bypass permissions, and wrong cwd prevent prompt disclosure', async () => {
  for (const [options, reason] of [[{ tools: ['run_command'] }, 'tool_catalog_unverified'],
    [{ tools: [] }, 'tool_catalog_unverified'],
    [{ agent: 'default' }, 'agent_selection_unverified'],
    [{ mode: 'always-proceed' }, 'permission_mode_unverified'],
    [{ initCwd: '/private/source' }, 'runtime_directory_unverified']]) {
    const { result, sent, killed } = await streamScenario(options);
    assert.equal(result.state, 'failed'); assert.equal(result.reason, reason);
    assert.equal(result.requestAttempted, false); assert.equal(sent, ''); assert.equal(killed, true);
  }
});

test('a tool or subagent event fails the run even after valid initialization', async () => {
  for (const step of [{ step_type: 'tool' }, { step_type: 'other', tool_info: {} }, { subagent_info: {} }]) {
    const { result, killed } = await streamScenario({ onPrompt: ({ emit }) => emit({ event: 'step_update', step_update: step }) });
    assert.equal(result.state, 'failed'); assert.equal(result.reason, 'unexpected_tool_use');
    assert.equal(result.requestAttempted, true); assert.equal(killed, true);
    assert.equal(Object.hasOwn(result, 'response'), false);
  }
});

test('successful-looking result with nonzero exit, invalid status, or multiple turns is rejected', async () => {
  assert.equal((await streamScenario({ exitCode: 1 })).result.state, 'failed');
  for (const result of [{ status: 'ERROR', num_turns: 1, response: SECRET },
    { status: 'SUCCESS', num_turns: 2, response: SECRET }]) {
    const scenario = await streamScenario({ onPrompt: ({ emit }) => emit({ event: 'result', result }) });
    assert.equal(scenario.result.reason, 'invalid_result');
  }
});

test('missing init, invalid JSON, excessive output, and process failure never expose diagnostics', async () => {
  assert.equal((await streamScenario({ noInit: true, timeoutMs: 10 })).result.reason, 'initialization_timeout');
  assert.equal((await streamScenario({ error: true })).result.reason, 'process_error');
  const invalid = await streamScenario({ onPrompt: ({ child }) => child.stdout.write(`${SECRET}\n`) });
  assert.equal(invalid.result.reason, 'invalid_stream');
  const large = await streamScenario({ onPrompt: ({ child }) => child.stdout.write('x'.repeat(600 * 1024)) });
  assert.equal(large.result.reason, 'output_limit');
});

test('last JSON line need not end with a newline', async () => {
  assert.equal((await streamScenario({ tail: true })).result.state, 'completed');
});

test('UTF-8 response text survives chunks split inside a Korean character', async () => {
  const { result } = await streamScenario({ onPrompt: ({ child }) => {
    const bytes = Buffer.from(JSON.stringify({ event: 'result', result: {
      status: 'SUCCESS', num_turns: 1, response: '검토 완료' } }) + '\n');
    const split = bytes.indexOf(Buffer.from('검')) + 1;
    child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split));
    setImmediate(() => child.emit('close', 0, null));
  } });
  assert.equal(result.response, '검토 완료');
});

test('public request blocks provider credentials before any executable or authentication lookup', async () => {
  const { requestGoogle } = await googleModule;
  const result = await requestGoogle({ prompt: 'synthetic', env: { GEMINI_API_KEY: SECRET } });
  assert.equal(result.state, 'blocked'); assert.equal(result.requestAttempted, false);
  assert.equal(result.reason, process.platform === 'darwin' ? 'provider_environment' : 'macos_sandbox_required');
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('effective permissions must have exactly all three scopes with no grants and no model usage', async () => {
  const { noGooglePermissionGrants } = await googleModule;
  const value = { status: 'SUCCESS', usage: { total_tokens: 0 },
    command: { name: 'permissions', data: { permissions: ['project', 'shared', 'global'].map((scope) => ({ scope })) } } };
  assert.equal(noGooglePermissionGrants(value), true);
  for (const mutate of [
    (v) => { v.usage.total_tokens = 1; },
    (v) => { v.command.data.permissions[0].allow = ['command(*)']; },
    (v) => { v.command.data.permissions.pop(); },
    (v) => { v.command.data.permissions[0] = null; },
    (v) => { v.command.name = 'other'; },
  ]) {
    const copy = structuredClone(value); mutate(copy); assert.equal(noGooglePermissionGrants(copy), false);
  }
});

test('proof profile changes only the executable allowance, retaining every filesystem denial', async () => {
  const { googleSandboxProfile } = await googleModule;
  const options = { cwd: '/source', home: '/Users/example', temporary: '/private/tmp/review', cli: '/tools/agy' };
  const runtime = googleSandboxProfile(options), proof = googleSandboxProfile({ ...options, proofExecutable: '/usr/local/bin/node' });
  const fileDenials = (text) => text.split('\n').filter((line) => line.startsWith('(deny file-') && !line.includes('file-read-data (require-all'));
  assert.deepEqual(fileDenials(runtime), fileDenials(proof));
  assert.equal(runtime.includes('/usr/local/bin/node'), false);
  assert.equal(proof.includes('(require-not (literal "/usr/local/bin/node"))'), true);
});
