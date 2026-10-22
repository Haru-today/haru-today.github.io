/**
 * LABDAM static deployment preflight, offline and read-only.
 * Does not access Google/Cloudflare, secrets, member data or GitHub.
 * Run AFTER the reviewed LABDAM + LabInsight protected bundle build.
 */
import { readFile, lstat, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROHIBITED = /(^|\/)(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?|node_modules|\.git|\.github|auth-gateway|google-apps-script|caffeine-atlas|secrets?)(?:\/|$)/i;
const REQUIRE = Object.freeze([
  'index.html', 'account.html', 'admin.html', 'login.html', 'pending.html',
  'membership-privacy.html', 'labinsight/index.html',
  'labinsight/checkup.html', 'labinsight/report.html', 'labinsight/hospitals.html',
  'labinsight/account.html', 'labinsight/styles.css', 'labinsight/manifest.webmanifest',
  'labinsight/app.js', 'labinsight/ocr-review.js',
  'labinsight/reference-ranges.js', 'labinsight/hospital-data.js',
  'labinsight/runtime-config.js', 'labinsight/service-worker.js',
  'labinsight/icons/icon.svg', 'labinsight/icons/icon-192.png',
  'labinsight/icons/icon-512.png'
]);

async function walk(dir, base = dir) {
  const result = [];
  if (!(await lstat(dir)).isDirectory()) throw Error('Protected dist must be a real directory');
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const stat = await lstat(abs);
    if (stat.isSymbolicLink()) throw Error('Static bundle contains a symbolic link');
    const rel = relative(base, abs).split(sep).join('/');
    if (PROHIBITED.test('/' + rel)) throw Error('Forbidden asset path: ' + rel);
    if (stat.isDirectory()) result.push(...await walk(abs, base));
    else if (stat.isFile()) result.push(rel);
    else throw Error('Unsupported static bundle entry: ' + rel);
  }
  return result;
}

export async function inspectStatic(root, { requireRealD1 = false, requireFinalPolicy = false } = {}) {
  const errors = [], warnings = [];
  let config;
  try {
    // This reviewed Wrangler config is strict JSON, although Wrangler permits JSONC.
    config = JSON.parse(await readFile(join(root, 'free-auth', 'wrangler.jsonc'), 'utf8'));
  } catch (_) {
    return { ok: false, errors: ['Cannot parse free-auth/wrangler.jsonc as JSON'], warnings };
  }
  if (config.name !== 'labdam-free-approval') errors.push('Unexpected Worker name');
  if (config.main !== './worker.mjs') errors.push('Worker entry must be ./worker.mjs');
  if (config.workers_dev !== true) errors.push('Expected workers_dev=true for isolated trial origin');
  // AUTH_ORIGIN is public configuration; keep it pinned to the separately confirmed
  // free test hostname. Never place OAuth secrets or user data in Wrangler vars.
  const vars = config.vars;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars) ||
      vars.AUTH_ORIGIN !== 'https://labdam-free-approval.jleegenomics.workers.dev' ||
      vars.GOOGLE_CLIENT_ID !== '226050909035-egl6ftg6ba8n5hjpckc8t0hgrfr4qfdm.apps.googleusercontent.com' ||
      Object.keys(vars).length !== 2) {
    errors.push('Only the confirmed AUTH_ORIGIN and GOOGLE_CLIENT_ID are allowed in public vars');
  }
  if (config.assets?.directory !== './dist' || config.assets?.binding !== 'ASSETS' ||
      config.assets?.run_worker_first !== true) {
    errors.push('Static assets must be served through ASSETS with run_worker_first=true');
  }
  if (config.routes != null || config.route != null || config.zone_id != null) {
    errors.push('Custom production routes are not permitted in the trial config');
  }
  if (config.unsafe != null) errors.push('Unexpected unsafe Wrangler settings');
  if (!Array.isArray(config.d1_databases) || config.d1_databases.length !== 1 ||
      config.d1_databases[0]?.binding !== 'DB' ||
      config.d1_databases[0]?.database_name !== 'labdam-membership' ||
      config.d1_databases[0]?.migrations_dir !== 'migrations') {
    errors.push('Expected a single dedicated DB binding and reviewed migration directory');
  }
  const dbId = config.d1_databases?.[0]?.database_id;
  if (requireRealD1 && !UUID.test(dbId || '')) {
    errors.push('A valid D1 database UUID is required before manual trial deployment');
  } else if (!UUID.test(dbId || '')) {
    warnings.push('D1 database UUID is not configured; deployment is NOT ready');
  }
  const dist = resolve(root, 'free-auth', 'dist');
  let files = [];
  try { files = await walk(dist); }
  catch (error) { errors.push('Cannot inspect protected dist: ' + error.message); }
  for (const path of REQUIRE) if (!files.includes(path)) errors.push('Missing protected asset: ' + path);
  // Operational contact and retention claims must be reviewed before launch.
  // This validates obvious placeholders, NOT legal compliance or real ownership.
  if (files.includes('membership-privacy.html')) {
    try {
      const notice = await readFile(join(dist, 'membership-privacy.html'), 'utf8');
      // Static QA cannot verify legal ownership or a provider contract. To
      // fail closed, require explicit review flags AND actual contact details.
      // A placeholder or "draft" notice is never release-ready.
      const incompleteWording = /정식 개인정보처리방침(?: 최종)? 확정 전|운영 담당자의 법적 명칭|공식 개인정보 담당자와 비공개 접수 방법|운영 보관기간은 정식 정책에서 확정해야|확인 대기|개설·확인 대기|미설정/;
      const providerNames = /Google/.test(notice) && /Cloudflare/.test(notice);
      const retentionField = /보관기간|보유기간/.test(notice) && /가입|회원/.test(notice);
      const finalFlag = /<meta\s+name="policy-status"\s+content="final"\s*\/?>/i.test(notice);
      const controller = notice.match(/<meta\s+name="policy-controller"\s+content="([^"]{2,120})"\s*\/?>/i)?.[1] || "";
      const validController = Boolean(controller) && !/예시|미정|pending|example|sample|test|확인/i.test(controller);
      const providerReview = /<meta\s+name="policy-providers-reviewed"\s+content="yes"\s*\/?>/i.test(notice);
      const retentionReview = /<meta\s+name="policy-retention-reviewed"\s+content="yes"\s*\/?>/i.test(notice);
      const privateContact = /mailto:([^"'<>\s]+)/i.exec(notice)?.[1] || "";
      const validPrivateContact = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(privateContact) &&
        !/example\.(?:com|org|net|invalid)|\.invalid$|noreply|no-reply|placeholder/i.test(privateContact);
      if (incompleteWording.test(notice) || !providerNames || !retentionField ||
          !finalFlag || !validController || !providerReview || !retentionReview || !validPrivateContact) {
        const message = 'Membership privacy notice needs final operator/contact, retention and provider review before launch';
        if (requireFinalPolicy) errors.push(message); else warnings.push(message);
      }
    } catch (_) { errors.push('Cannot inspect membership privacy notice'); }
  }
  return { ok: errors.length === 0, errors, warnings, checkedAssets: files.length };
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(f => !['--require-real-d1', '--require-final-policy', '--json'].includes(f))) {
    process.stderr.write('Usage: node preflight-static.mjs [--require-real-d1] [--require-final-policy] [--json]\n');
    process.exitCode = 2; return;
  }
  const result = await inspectStatic(DEFAULT_ROOT, { requireRealD1: flags.includes('--require-real-d1'), requireFinalPolicy: flags.includes('--require-final-policy') });
  if (flags.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    for (const e of result.errors) console.error('ERROR:', e);
    for (const w of result.warnings) console.warn('WARNING:', w);
    console.log(result.ok ? 'Static configuration/bundle checks passed (NOT a cloud deployment approval).' : 'Static preflight FAILED.');
    console.log('Checked static files:', result.checkedAssets || 0);
  }
  if (!result.ok) process.exitCode = 1;
}
// Node resolves module symlinks; canonicalize argv too (macOS /var -> /private/var).
let entryPath;
try { entryPath = process.argv[1] && realpathSync(resolve(process.argv[1])); } catch (_) {}
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch(() => { process.stderr.write('Static preflight failed.\n'); process.exitCode = 2; });
}
