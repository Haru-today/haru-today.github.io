import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const worker = read('../worker.mjs');
const schema = read('../migrations/0001_initial.sql');
const policy = read('../membership-privacy.html');
const notes = read('../PROVIDER-PRIVACY-REVIEW-20261016.md');

test('Google OAuth asks for login-only scopes documented to applicants', () => {
  assert.match(worker, /scope:\s*["']openid email profile["']/);
  assert.doesNotMatch(worker, /scope:\s*["'][^"']*(?:drive|gmail|calendar|contacts|spreadsheets)[^"']*["']/i);
  assert.match(notes, /openid email profile/);
  assert.match(policy, /Google 고유 식별자/);
});

test('provider audit never asserts an unverified Korean-only D1 residency', () => {
  assert.match(notes, /실제 계정/);
  assert.match(notes, /jurisdiction/);
  assert.match(notes, /location hint/);
  assert.match(notes, /확인/);
  assert.doesNotMatch(policy, /한국 (?:내에서만|서버에만) (?:저장|처리)/);
  assert.match(policy, /국외 처리 검토/);
  assert.match(policy, /policy-status" content="draft"/);
});

test('actual D1 schema has only membership and transient auth tables, not health data', () => {
  for (const name of ['members', 'oauth_states', 'sessions', 'login_throttle'])
    assert.match(schema, new RegExp('CREATE TABLE IF NOT EXISTS '+name));
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS (?:health|genotype|carepath|reports)/i);
  assert.match(notes, /회원 승인/);
  assert.match(policy, /회원 승인용 D1 데이터베이스에 저장하지 않습니다/);
});

test('provider audit leaves operator and private contact as release blockers', () => {
  assert.match(notes, /법적 개인정보처리자/);
  assert.match(notes, /비공개/);
  assert.match(notes, /Google/);
  assert.match(notes, /Cloudflare/);
  assert.match(policy, /운영자 실명 또는 공식 사업자 명칭 확인 대기/);
  assert.match(policy, /개설·확인 대기/);
});

test('provider review source contains no tokens, real personal data or access keys', () => {
  assert.doesNotMatch(notes, /(?:sk-proj-|Bearer\s+eyJ|GOOGLE_CLIENT_SECRET\s*=|CLOUDFLARE_API_TOKEN\s*=)/i);
  assert.doesNotMatch(notes, /\b(?:SELECT|DELETE|UPDATE|INSERT)\s+(?:.*FROM\s+)?members\b/i);
});
