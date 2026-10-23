const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const doctorModule = import('../developer/ai-doctor.mjs');
const MARKER = 'LABDAM_AI_CHECK_0123456789abcdef0123456789abcdef';
const SECRET = 'DO_NOT_PRINT_account_token_or_path';
const PROJECT = join(tmpdir(), 'labdam-mock-project');
const PROBE = join(tmpdir(), 'labdam-mock-probe');
const ok = (stdout) => ({ status: 0, stdout, error: null });
const json = (value) => ok(JSON.stringify(value));

// Every subprocess is injected. No real git, claude, agy or model call is made.
async function scenario(config = {}) {
  const doctor = await doctorModule;
  const calls = [];
  let created = 0;
  let cleaned = 0;
  const env = config.env ?? {};
  const runner = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const custom = config.override?.(command, args, options);
    if (custom !== undefined) return custom;
    if (command === 'git') {
      const operation = args.slice(3).join(' ');
      const values = {
        'rev-parse --is-inside-work-tree': 'true\n',
        'branch --show-current': 'chore/ai-collaboration-20261023\n',
        'rev-parse HEAD': `${'a'.repeat(40)}\n`,
        'status --porcelain=v1 --untracked-files=normal': '',
        'config --get remote.origin.url': `https://${SECRET}@github.com/Haru-today/haru-today.github.io.git\n`,
        'rev-parse --show-toplevel': `${PROJECT}\n`,
      };
      assert.ok(Object.hasOwn(values, operation), `Unexpected git operation: ${operation}`);
      return ok(values[operation]);
    }
    if (args[0] === '--version') return ok(`${command} 2.1.248 ${SECRET}`);
    if (args[0] === '--help') return ok([...doctor.REQUIRED_FLAGS, '-p', '--help', '--version'].join('\n'));
    if (command === 'claude' && args.join(' ') === 'auth status') {
      return json({ authMethod: 'claude.ai', email: SECRET, configDirectory: SECRET, token: SECRET });
    }
    if (command === 'claude' && args.includes('--print')) {
      return json({ type: 'result', subtype: 'success', is_error: false, result: MARKER });
    }
    throw new Error('Unexpected injected command');
  };
  const result = doctor.runDoctor({
    cwd: PROJECT, env, probeClaude: config.probeClaude ?? true, runner,
    createMarker: () => MARKER,
    createDirectory: () => {
      created += 1;
      if (config.directoryError) throw new Error(SECRET);
      return { cwd: PROBE, cleanup: () => { cleaned += 1; } };
    },
  });
  return { ...result, calls, created, cleaned, env };
}

const requests = (result) => result.calls.filter((call) => call.command === 'claude' && call.args.includes('--print'));

test('default diagnostics never authenticate, create a directory or request a model', async () => {
  const result = await scenario({ probeClaude: false });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.claudeProbe.state, 'not_requested');
  assert.equal(result.report.claudeAuthentication.state, 'not_checked');
  assert.equal(result.report.project.repository, 'Haru-today/haru-today.github.io');
  assert.equal(result.report.tools.agy.authentication, 'not_checked');
  assert.equal(result.report.tools.agy.modelResponse, 'not_run');
  assert.equal(result.created, 0);
  assert.equal(result.calls.some((call) => call.args[0] === 'auth'), false);
  assert.equal(requests(result).length, 0);
  assert.equal(JSON.stringify(result.report).includes(SECRET), false);
});

test('missing CLIs are not mistaken for a working connection', async () => {
  const result = await scenario({ override: (command) => command !== 'git' ? { status: null, stdout: '', error: 'not_found' } : undefined });
  assert.equal(result.report.tools.claude.installation, 'not_found');
  assert.equal(result.report.tools.agy.installation, 'not_found');
  assert.equal(result.report.claudeProbe.reason, 'claude_unavailable');
  assert.equal(result.exitCode, 1);
  assert.equal(result.created, 0);
});

test('provider environment blocks a request without exposing values or changing the environment', async () => {
  const env = Object.freeze({ HOME: SECRET, ANTHROPIC_PROFILE: SECRET, CLAUDE_CODE_USE_VERTEX: SECRET, CLAUDE_CODE_OAUTH_TOKEN: SECRET });
  const result = await scenario({ env });
  assert.equal(result.report.claudeProbe.reason, 'provider_environment');
  assert.equal(result.report.claudeProbe.requestAttempted, false);
  assert.equal(result.created, 0);
  assert.deepEqual(result.report.claudeAuthentication.categories, ['ANTHROPIC_*', 'CLAUDE_CODE_USE_*', 'CLAUDE_CODE_OAUTH_TOKEN']);
  assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  assert.ok(result.calls.every((call) => call.options.env === env));
});

test('an API key or future Anthropic credential is blocked even when subscription login might exist', async () => {
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_FUTURE_CREDENTIAL']) {
    const result = await scenario({ env: { [key]: SECRET } });
    assert.equal(result.report.claudeProbe.reason, 'provider_environment');
    assert.equal(requests(result).length, 0);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  }
});

test('missing ordinary safety options remain unverified; substring lookalikes do not count', async () => {
  const { REQUIRED_FLAGS } = await doctorModule;
  const result = await scenario({ override: (command, args) => command === 'claude' && args[0] === '--help'
    ? ok(REQUIRED_FLAGS.map((flag) => flag === '--tools' ? '--tools-dangerous' : flag).join('\n')) : undefined });
  assert.equal(result.report.claudeProbe.reason, 'capabilities_unverified');
  assert.deepEqual(result.report.tools.claude.unverifiedOptions, ['--tools']);
  assert.equal(result.created, 0);
});

test('documented version can confirm only the two known hidden flags', async () => {
  const { REQUIRED_FLAGS } = await doctorModule;
  const help = REQUIRED_FLAGS.filter((flag) => !['--safe-mode', '--restricted'].includes(flag)).join('\n');
  for (const version of ['2.1.247', '2.1.248']) {
    const result = await scenario({ override: (command, args) => {
      if (command !== 'claude') return undefined;
      if (args[0] === '--version') return ok(version);
      if (args[0] === '--help') return ok(help);
    } });
    assert.equal(result.report.claudeProbe.state, version === '2.1.248' ? 'passed' : 'blocked');
    assert.equal(result.report.tools.claude.optionsEvidence['--restricted'], version === '2.1.248' ? 'documented_version' : 'unverified');
    if (version === '2.1.248') assert.ok(requests(result)[0].args.includes('--restricted'));
  }
});

test('API, helper, OAuth-token, third-party and unknown authentication never trigger generation', async () => {
  for (const authMethod of ['api_key', 'api_key_helper', 'oauth_token', 'third_party', 'unknown']) {
    const result = await scenario({ override: (command, args) => command === 'claude' && args[0] === 'auth' ? json({ authMethod, email: SECRET }) : undefined });
    assert.equal(result.report.claudeProbe.reason, 'subscription_auth_unverified');
    assert.equal(requests(result).length, 0);
    assert.equal(result.cleaned, 1);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  }
});

test('contradictory optional auth fields block a subscription-shaped status', async () => {
  for (const extra of [{ loggedIn: false }, { loggedIn: 'true' }, { apiKeySource: SECRET }, { apiProvider: 'bedrock' }, { subscriptionType: 'enterprise' }]) {
    const result = await scenario({ override: (command, args) => command === 'claude' && args[0] === 'auth' ? json({ authMethod: 'claude.ai', ...extra }) : undefined });
    assert.equal(result.report.claudeProbe.state, 'blocked');
    assert.equal(requests(result).length, 0);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  }
});

test('login failure, invalid auth JSON and an unknown auth schema fail closed', async () => {
  for (const response of [{ status: 1, stdout: SECRET, error: null }, ok(SECRET), json({ loggedIn: true })]) {
    const result = await scenario({ override: (command, args) => command === 'claude' && args[0] === 'auth' ? response : undefined });
    assert.equal(result.report.claudeProbe.state, 'blocked');
    assert.equal(result.exitCode, 1);
    assert.equal(requests(result).length, 0);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  }
});

test('a successful exact marker verifies only the Claude response, using all protections', async () => {
  const result = await scenario({ env: Object.freeze({ HOME: SECRET }) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.claudeProbe.state, 'passed');
  assert.equal(result.report.claudeProbe.temporaryDirectory, 'removed');
  assert.equal(result.report.claudeAuthentication.state, 'subscription_route_verified');
  assert.equal(result.report.claudeAuthentication.subscription, 'not_reported');
  assert.equal(result.report.claudeAuthentication.billingStatus, 'unknown');
  assert.equal(result.report.codeReview, 'not_run');
  assert.equal(result.report.tools.agy.modelResponse, 'not_run');
  assert.equal(result.cleaned, 1);
  const [call] = requests(result);
  assert.equal(requests(result).length, 1);
  assert.equal(call.options.cwd, PROBE);
  assert.notEqual(call.options.cwd, PROJECT);
  assert.equal(call.options.timeout, 45_000);
  assert.equal(call.options.env.HOME, SECRET);
  for (const [option, value] of [['--tools', ''], ['--disallowedTools', '*'], ['--mcp-config', '{"mcpServers":{}}'], ['--max-turns', '1'], ['--output-format', 'json']]) {
    assert.equal(call.args[call.args.indexOf(option) + 1], value);
  }
  for (const option of ['--safe-mode', '--restricted', '--strict-mcp-config', '--no-session-persistence']) assert.ok(call.args.includes(option));
  assert.equal(call.args.at(-1), `Reply with exactly this text and nothing else: ${MARKER}`);
  assert.equal(JSON.stringify(result.report).includes(SECRET), false);
});

test('malformed, error, wrong-marker and failed process responses cannot pass', async () => {
  const success = { type: 'result', subtype: 'success', is_error: false, result: MARKER };
  const cases = [
    [ok(SECRET), 'response_json_invalid'],
    [json({ ...success, is_error: true }), 'response_error'],
    [json({ ...success, errors: { message: SECRET } }), 'response_error'],
    [json({ ...success, subtype: 'error_during_execution' }), 'response_error'],
    [json({ ...success, result: 'different marker' }), 'marker_mismatch'],
    [{ status: 1, stdout: JSON.stringify(success), error: null }, 'request_process_failed'],
    [{ status: null, stdout: '', error: 'timeout' }, 'request_process_failed'],
  ];
  for (const [response, reason] of cases) {
    const result = await scenario({ override: (command, args) => command === 'claude' && args.includes('--print') ? response : undefined });
    assert.equal(result.report.claudeProbe.state, 'failed');
    assert.equal(result.report.claudeProbe.reason, reason);
    assert.equal(result.report.claudeProbe.requestAttempted, true);
    assert.equal(requests(result).length, 1); // No retry without protections.
    assert.equal(result.cleaned, 1);
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.stringify(result.report).includes(SECRET), false);
  }
});

test('directory failures are sanitized and never fall back to the project', async () => {
  const result = await scenario({ directoryError: true });
  assert.equal(result.report.claudeProbe.reason, 'probe_setup_failed');
  assert.equal(requests(result).length, 0);
  assert.equal(JSON.stringify(result.report).includes(SECRET), false);
});

test('native process wrapper sets a bounded timeout, empty stdin, capped output and no shell', async () => {
  const { runProcess, MAX_OUTPUT_BYTES } = await doctorModule;
  const env = Object.freeze({ HOME: SECRET });
  let options;
  const result = runProcess('fake-cli', ['--help'], { cwd: PROJECT, env, timeout: 999_999 }, (_command, _args, actual) => {
    options = actual;
    return { status: 0, stdout: 'help', stderr: SECRET };
  });
  assert.equal(result.stdout, 'help');
  assert.equal(options.shell, false);
  assert.equal(options.timeout, 45_000);
  assert.equal(options.maxBuffer, MAX_OUTPUT_BYTES);
  assert.equal(options.input, '');
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(options.env, env);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('native process errors and size limits do not expose exception or stderr text', async () => {
  const { runProcess, MAX_OUTPUT_BYTES } = await doctorModule;
  for (const [code, expected] of [['ENOENT', 'not_found'], ['ETIMEDOUT', 'timeout'], ['ENOBUFS', 'output_limit'], ['EACCES', 'process_error']]) {
    const result = runProcess('fake-cli', [], {}, () => ({ error: { code, message: SECRET }, stdout: SECRET, stderr: SECRET }));
    assert.equal(result.error, expected);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  assert.equal(runProcess('fake-cli', ['x'.repeat(8193)], {}, () => assert.fail('must not spawn')).error, 'input_limit');
  assert.equal(runProcess('fake-cli', [], {}, () => ({ status: 0, stdout: 'x'.repeat(MAX_OUTPUT_BYTES + 1) })).error, 'output_limit');
  assert.equal(runProcess('fake-cli', [], {}, () => { throw new Error(SECRET); }).error, 'process_error');
});

test('temporary directories are outside the project and only the new directory is removed', async () => {
  const { createProbeDirectory } = await doctorModule;
  const root = mkdtempSync(join(tmpdir(), 'labdam-doctor-test-'));
  const project = join(root, 'project');
  const external = join(root, 'external');
  mkdirSync(project);
  mkdirSync(external);
  try {
    assert.throws(() => createProbeDirectory({ cwd: project, projectRoot: project, tempRoot: project }), /temporary_directory_inside_project/);
    const directory = createProbeDirectory({ cwd: project, projectRoot: project, tempRoot: external });
    assert.equal(existsSync(directory.cwd), true);
    directory.cleanup();
    assert.equal(existsSync(directory.cwd), false);
    assert.equal(existsSync(project), true);
    assert.equal(existsSync(external), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
