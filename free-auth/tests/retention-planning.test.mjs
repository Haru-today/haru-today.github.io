import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewRetention } from '../retention-planning.mjs';

const DAY = 86400;
const NOW = 2_000_000_000;
const member = (status, ageDays, options={}) => ({
  google_sub: 'synthetic-user-identifer-NOT_FOR_REPORT',
  email: 'synthetic@example.invalid',
  display_name: 'not reported',
  purpose: 'never log this',
  role: 'member',
  status,
  created_at: NOW - (ageDays + 1) * DAY,
  updated_at: NOW - ageDays * DAY,
  reviewed_at: NOW - ageDays * DAY,
  ...options
});
const sample = opts => previewRetention([
  member('pending', 89), member('pending', 90),
  member('rejected', 29), member('rejected', 30),
  member('approved', 4000),
  member('rejected', 9000, { role:'admin' })
], { nowSeconds: NOW, pendingDays:90, rejectedDays:30, ...opts });

test('an explicitly configured 90/30 day PREVIEW counts only synthetic pending and rejected candidates', () => {
  const x=sample();
  assert.equal(x.scanned,6);
  assert.equal(x.pendingCandidates,1);
  assert.equal(x.rejectedCandidates,1);
  assert.equal(x.candidateTotal,2);
  assert.equal(x.approved,1);
  assert.equal(x.administrators,1);
  assert.equal(x.examplesOnly,true);
  assert.match(x.disclaimer,/삭제.*수행하지/);
});
test('a status is never inferred; all approved accounts and administrator accounts are excluded', () => {
  const x=previewRetention([
    member('approved',9999),
    member('rejected',9999,{role:'admin'}),
    member('pending',9999,{role:'admin'}),
    member('invalid',9999)
  ],{nowSeconds:NOW,pendingDays:30,rejectedDays:30});
  assert.equal(x.candidateTotal,0);
  assert.equal(x.administrators,2);
  assert.equal(x.skippedUnreliable,1);
});
test('rejected application is aged from review time, not registration date', () => {
  const x=previewRetention([
    member('rejected',100,{reviewed_at:NOW-2*DAY}),
    member('rejected',100,{reviewed_at:NOW-30*DAY})
  ],{nowSeconds:NOW,pendingDays:90,rejectedDays:30});
  assert.equal(x.rejectedCandidates,1);
});
test('pending application is aged from last update, not registration date', () => {
  const x=previewRetention([
    member('pending',365,{updated_at:NOW-1*DAY}),
    member('pending',365,{updated_at:NOW-90*DAY})
  ],{nowSeconds:NOW,pendingDays:90,rejectedDays:30});
  assert.equal(x.pendingCandidates,1);
});
test('unknown, missing, nonsensical or future timestamps fail closed',()=>{
  const x=previewRetention([
    member('pending',400,{updated_at:undefined}),
    member('pending',400,{updated_at:NOW+DAY}),
    member('pending',400,{created_at:NOW+DAY}),
    member('rejected',400,{reviewed_at:null}),
    member('rejected',400,{reviewed_at:NOW+DAY}),
    null
  ],{nowSeconds:NOW,pendingDays:90,rejectedDays:30});
  assert.equal(x.candidateTotal,0);
  assert.equal(x.skippedUnreliable,6);
});
test('explicit retention scenario inputs required; no silent default or invented compliance periods',()=>{
  assert.throws(()=>previewRetention([]),/nowSeconds/);
  assert.throws(()=>previewRetention([],{nowSeconds:NOW,pendingDays:0,rejectedDays:30}),/pendingDays/);
  assert.throws(()=>previewRetention([],{nowSeconds:NOW,pendingDays:90,rejectedDays:3651}),/rejectedDays/);
});
test('output contains aggregate counts only, never a Google identity, email, purpose or SQL',()=>{
  const result=sample();
  const resultJson=JSON.stringify(result);
  assert.doesNotMatch(resultJson,/synthetic-user-identifer|synthetic@example\.invalid|never log this/);
  const src=readFileSync(new URL('../retention-planning.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(|\bXMLHttpRequest\b|\bwrangler\b|\bDELETE\s+FROM\b|\.run\s*\(|\.first\s*\(|\bprocess\.env\b/i);
  const worker=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/retention-planning\.mjs|pendingDays|rejectedDays/);
});
