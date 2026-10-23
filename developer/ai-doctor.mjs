#!/usr/bin/env node
// Local diagnostics only by default. No dependencies or persistent configuration changes.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_FLAGS = Object.freeze([
  '--safe-mode', '--restricted', '--tools', '--disallowedTools',
  '--strict-mcp-config', '--mcp-config', '--max-turns',
  '--no-session-persistence', '--output-format', '--print',
]);
export const MAX_OUTPUT_BYTES = 256 * 1024;
// These are conservative evidence versions, not claims about first introduction.
// v2.1.304 explicitly documents a fix enforcing --max-turns for headless runs.
export const DOCUMENTED_CLAUDE_OPTIONS = Object.freeze({
  '--safe-mode': { minimumVersion: [2, 1, 248], source: 'https://code.claude.com/docs/en/cli-reference' },
  '--restricted': { minimumVersion: [2, 1, 248], source: 'https://code.claude.com/docs/en/cli-reference' },
  '--max-turns': { minimumVersion: [2, 1, 304], source: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.304', reference: 'https://code.claude.com/docs/en/cli-reference' },
});
const INSPECTION_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 45_000;

// Raw process output is consumed internally; it is never copied into the report.
export function runProcess(command, args, options = {}, spawn = spawnSync) {
  if (!args.every((arg) => typeof arg === 'string') ||
      Buffer.byteLength(args.join('\0')) > 8192) {
    return { status: null, stdout: '', error: 'input_limit' };
  }
  try {
    const result = spawn(command, args, {
      cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
      encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: Math.min(options.timeout ?? INSPECTION_TIMEOUT_MS, PROBE_TIMEOUT_MS),
      maxBuffer: MAX_OUTPUT_BYTES, killSignal: 'SIGKILL',
    });
    const errors = { ENOENT: 'not_found', ETIMEDOUT: 'timeout', ENOBUFS: 'output_limit' };
    if (result.error) return { status: null, stdout: '', error: errors[result.error.code] ?? 'process_error' };
    if (result.signal) return { status: null, stdout: '', error: 'process_terminated' };
    const stderr = result.stderr ?? '';
    if (typeof result.stdout !== 'string' || typeof stderr !== 'string' ||
        Buffer.byteLength(result.stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
      return { status: null, stdout: '', error: 'output_limit' };
    }
    // Some CLIs (agy 1.4.6) print successful help to stderr. Opt in only for
    // exact help/version inspections; auth and model stderr stays discarded.
    const inspectStderr = options.includeInspectionStderr === true && result.status === 0 &&
      args.length === 1 && ['--help', '--version'].includes(args[0]);
    const stdout = inspectStderr && stderr ? [result.stdout, stderr].filter(Boolean).join('\n') : result.stdout;
    if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) return { status: null, stdout: '', error: 'output_limit' };
    return { status: result.status, stdout, error: null };
  } catch {
    return { status: null, stdout: '', error: 'process_error' };
  }
}

function succeeded(result) {
  return result.status === 0 && !result.error;
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function optionInHelp(help, option) {
  return new RegExp(`(^|[\\s,])${option}(?=[\\s,=<]|$)`, 'm').test(help);
}

function versionAtLeast(actual, minimum) {
  if (!actual) return false;
  const parts = actual.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

function inspectTool(name, invoke, options) {
  const inspectionOptions = { ...options, includeInspectionStderr: true };
  const version = invoke(name, ['--version'], inspectionOptions);
  if (version.error === 'not_found') {
    return { installation: 'not_found', version: null, help: 'not_checked', optionsFound: [] };
  }
  const help = invoke(name, ['--help'], inspectionOptions);
  return {
    installation: typeof version.status === 'number' || typeof help.status === 'number' ? 'found' : 'unverified',
    version: succeeded(version) ? version.stdout.match(/\b\d{1,4}\.\d{1,4}\.\d{1,6}\b/)?.[0] ?? null : null,
    help: succeeded(help) ? 'checked' : 'unverified',
    optionsFound: (name === 'claude' ? REQUIRED_FLAGS : ['--help', '--version', '--print', '-p', '--output-format'])
      .filter((flag) => succeeded(help) && optionInHelp(help.stdout, flag)),
  };
}

// The renamed repodam repository and its legacy labinsight name share one canonical identifier.
function knownRepository(remote) {
  const match = remote.trim().match(/^(?:https:\/\/(?:[^\s/@?#\\]+@)?github\.com\/|git@github\.com:)Haru-today\/(haru-today\.github\.io|repodam|labinsight)(?:\.git)?\/?$/i);
  if (!match) return 'unrecognized';
  return /^haru-today\.github\.io$/i.test(match[1]) ? 'Haru-today/haru-today.github.io' : 'Haru-today/repodam';
}

function inspectProject(invoke, options) {
  const git = (args) => invoke('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], options);
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (!succeeded(inside) || inside.stdout.trim() !== 'true') {
    return { report: { git: inside.error === 'not_found' ? 'not_found' : 'not_a_repository_or_unverified' }, root: null };
  }
  const branch = git(['branch', '--show-current']);
  const commit = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
  const remote = git(['config', '--get', 'remote.origin.url']);
  const root = git(['rev-parse', '--show-toplevel']);
  return {
    report: {
      git: 'available',
      repository: succeeded(remote) ? knownRepository(remote.stdout) : 'unverified',
      branch: succeeded(branch) && /^[A-Za-z0-9._/-]{1,160}$/.test(branch.stdout.trim()) ? branch.stdout.trim() : null,
      commit: succeeded(commit) && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.stdout.trim()) ? commit.stdout.trim() : null,
      workingTree: succeeded(status) ? (status.stdout.length ? 'dirty' : 'clean') : 'unverified',
    },
    root: succeeded(root) ? root.stdout.trim() : null,
  };
}

export function configuredProviderEnvironment(env) {
  // Prefixes also cover newly introduced endpoint/profile/federation credentials.
  // Return only fixed categories, never arbitrary variable names or their values.
  return [
    ['ANTHROPIC_*', (key) => key.startsWith('ANTHROPIC_')],
    ['CLAUDE_CODE_USE_*', (key) => key.startsWith('CLAUDE_CODE_USE_')],
    ['CLAUDE_CODE_OAUTH_TOKEN', (key) => key === 'CLAUDE_CODE_OAUTH_TOKEN'],
  ].filter(([, matches]) => Object.keys(env).some((key) => matches(key) && String(env[key] ?? '').trim() !== ''))
    .map(([category]) => category);
}

export function createProbeDirectory({ cwd, projectRoot, tempRoot = tmpdir() }) {
  const base = realpathSync(tempRoot);
  for (const folder of [cwd, projectRoot].filter(Boolean)) {
    const rel = relative(realpathSync(folder), base);
    if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
      throw new Error('temporary_directory_inside_project');
    }
  }
  const directory = mkdtempSync(join(base, 'labdam-ai-probe-'));
  return { cwd: directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export function classifyAuthentication(result) {
  if (!succeeded(result)) return { state: 'unverified', reason: 'auth_status_failed' };
  const auth = parseObject(result.stdout);
  if (!auth || typeof auth.authMethod !== 'string' || typeof auth.loggedIn !== 'boolean') {
    return { state: 'unverified', reason: 'auth_json_unrecognized' };
  }
  if (auth.loggedIn === false || auth.authMethod === 'none') return { state: 'not_logged_in', reason: 'login_required' };
  if (auth.authMethod !== 'claude.ai') return { state: 'blocked', reason: 'subscription_auth_unverified' };
  if (auth.apiKeySource || (auth.apiProvider && auth.apiProvider !== 'firstParty')) {
    return { state: 'blocked', reason: 'api_or_provider_auth' };
  }
  if (!['pro', 'max'].includes(auth.subscriptionType)) {
    return { state: 'unverified', reason: 'personal_subscription_unverified' };
  }
  return { state: 'subscription_route_verified', method: 'claude.ai', subscription: auth.subscriptionType, billingStatus: 'unknown' };
}

export function runDoctor({
  cwd = process.cwd(), env = process.env, probeClaude = false, runner = runProcess,
  createDirectory = createProbeDirectory,
  createMarker = () => `LABDAM_AI_CHECK_${randomBytes(16).toString('hex')}`,
  now = () => new Date().toISOString(),
} = {}) {
  const checkedAt = now();
  const invoke = (command, args, options) => {
    try {
      const result = runner(command, args, options);
      if (!result || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > MAX_OUTPUT_BYTES) {
        return { status: null, stdout: '', error: 'output_limit' };
      }
      return result;
    } catch { return { status: null, stdout: '', error: 'process_error' }; }
  };
  const options = { cwd, env, timeout: INSPECTION_TIMEOUT_MS };
  const project = inspectProject(invoke, options);
  const claude = inspectTool('claude', invoke, options);
  const agy = inspectTool('agy', invoke, options);
  // Official documentation can establish known hidden flags for a verified
  // version. No other missing option is inferred; every protection is retained.
  claude.optionsEvidence = Object.fromEntries(REQUIRED_FLAGS.map((flag) => [flag,
    claude.optionsFound.includes(flag) ? 'help' :
      (DOCUMENTED_CLAUDE_OPTIONS[flag] && versionAtLeast(claude.version, DOCUMENTED_CLAUDE_OPTIONS[flag].minimumVersion) ? 'documented_version' : 'unverified'),
  ]));
  claude.optionsDocumentation = Object.fromEntries(REQUIRED_FLAGS
    .filter((flag) => claude.optionsEvidence[flag] === 'documented_version')
    .map((flag) => [flag, DOCUMENTED_CLAUDE_OPTIONS[flag]]));
  claude.unverifiedOptions = REQUIRED_FLAGS.filter((flag) => claude.optionsEvidence[flag] === 'unverified');
  claude.safeProbeCapabilities = claude.unverifiedOptions.length ? 'unverified' : 'verified';
  const report = {
    schemaVersion: 1, checkedAt, mode: probeClaude ? 'probe-claude' : 'inspect', project: project.report,
    tools: { claude, agy: { ...agy, authentication: 'not_checked', modelResponse: 'not_run' } },
    claudeAuthentication: { state: 'not_checked' },
    claudeProbe: { state: 'not_requested', reason: 'explicit_flag_required', requestAttempted: false, requestStartedAt: null, requestFinishedAt: null },
    codeReview: 'not_run',
  };
  const finish = () => ({ report, exitCode: probeClaude && report.claudeProbe.state !== 'passed' ? 1 : 0 });
  const blocked = (reason) => {
    report.claudeProbe = { ...report.claudeProbe, state: 'blocked', reason };
    return finish();
  };
  if (!probeClaude) return finish();
  if (claude.installation !== 'found') return blocked('claude_unavailable');
  if (claude.safeProbeCapabilities !== 'verified') return blocked('capabilities_unverified');
  const providerEnvironment = configuredProviderEnvironment(env);
  if (providerEnvironment.length) {
    report.claudeAuthentication = { state: 'blocked', reason: 'provider_environment', categories: providerEnvironment };
    return blocked('provider_environment');
  }

  let directory;
  try {
    directory = createDirectory({ cwd, projectRoot: project.root });
    report.claudeProbe.temporaryDirectory = 'created';
    const probeOptions = { ...options, cwd: directory.cwd };
    // auth status is JSON by default. Never print its raw JSON or stderr.
    report.claudeAuthentication = classifyAuthentication(invoke('claude', ['auth', 'status'], probeOptions));
    if (report.claudeAuthentication.state !== 'subscription_route_verified') {
      return blocked(report.claudeAuthentication.reason);
    }
    const marker = createMarker();
    if (!/^LABDAM_AI_CHECK_[a-f0-9]{32}$/.test(marker)) return blocked('invalid_synthetic_marker');
    const args = [
      '--safe-mode', '--restricted', '--tools', '', '--disallowedTools', '*',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-turns', '1',
      '--no-session-persistence', '--output-format', 'json', '--print',
      `Reply with exactly this text and nothing else: ${marker}`,
    ];
    report.claudeProbe.requestAttempted = true;
    report.claudeProbe.requestStartedAt = now();
    const result = invoke('claude', args, { ...probeOptions, timeout: PROBE_TIMEOUT_MS });
    report.claudeProbe.requestFinishedAt = now();
    const response = succeeded(result) ? parseObject(result.stdout) : null;
    let reason = 'marker_confirmed';
    if (!succeeded(result)) reason = 'request_process_failed';
    else if (!response) reason = 'response_json_invalid';
    else if (response.type !== 'result' || response.subtype !== 'success' || response.is_error !== false || response.error ||
      (Object.hasOwn(response, 'errors') && (!Array.isArray(response.errors) || response.errors.length))) reason = 'response_error';
    else if (typeof response.result !== 'string' || response.result.trim() !== marker) reason = 'marker_mismatch';
    report.claudeProbe.state = reason === 'marker_confirmed' ? 'passed' : 'failed';
    report.claudeProbe.reason = reason;
    return finish();
  } catch {
    return blocked('probe_setup_failed');
  } finally {
    if (directory) {
      try { directory.cleanup(); report.claudeProbe.temporaryDirectory = 'removed'; }
      catch { report.claudeProbe.temporaryDirectory = 'cleanup_failed'; }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node developer/ai-doctor.mjs [--probe-claude]\nDefault: inspect only; no AI request. --probe-claude: one synthetic Claude connection check.\nExit 0: inspection completed or Claude probe passed; 1: requested probe blocked/failed; 2: usage/internal error.');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--probe-claude')) {
    console.log(JSON.stringify({ schemaVersion: 1, error: 'invalid_arguments' }));
    process.exitCode = 2;
    return;
  }
  try {
    const result = runDoctor({ probeClaude: args.includes('--probe-claude') });
    console.log(JSON.stringify(result.report, null, 2));
    process.exitCode = result.exitCode;
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, error: 'diagnostic_failed' }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
