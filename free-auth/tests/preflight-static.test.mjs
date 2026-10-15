import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectStatic } from '../scripts/preflight-static.mjs';

const files = [
  'index.html','account.html','admin.html','login.html','pending.html','membership-privacy.html',
  'labinsight/index.html','labinsight/checkup.html','labinsight/report.html',
  'labinsight/hospitals.html','labinsight/account.html','labinsight/styles.css',
  'labinsight/manifest.webmanifest','labinsight/app.js','labinsight/ocr-review.js',
  'labinsight/reference-ranges.js','labinsight/hospital-data.js',
  'labinsight/runtime-config.js','labinsight/service-worker.js',
  'labinsight/icons/icon.svg','labinsight/icons/icon-192.png','labinsight/icons/icon-512.png'
];
const validUuid = '4ac37a14-46b2-47ab-9b4e-cc2e25e2d1a0'; // synthetic, not a real DB
const config = () => ({ name:'labdam-free-approval',main:'./worker.mjs',workers_dev:true,
  vars:{ AUTH_ORIGIN:'https://labdam-free-approval.jleegenomics.workers.dev' },
  assets:{directory:'./dist',binding:'ASSETS',run_worker_first:true},
  d1_databases:[{binding:'DB',database_name:'labdam-membership',database_id:'REPLACE_WITH_REAL_FREE_D1_DATABASE_ID',migrations_dir:'migrations'}]
});
async function fixture(fn){
  const root=await mkdtemp(join(tmpdir(),'labdam-preflight-'));
  try{
    const dist=join(root,'free-auth','dist');
    await mkdir(dist,{recursive:true});
    for(const f of files){const p=join(dist,f);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,'mock');}
    await writeFile(join(root,'free-auth','wrangler.jsonc'),JSON.stringify(config()));
    const writeConfig=async c=>writeFile(join(root,'free-auth','wrangler.jsonc'),JSON.stringify(c));
    await fn({root,dist,writeConfig});
  } finally {await rm(root,{recursive:true,force:true});}
}
test('reviewed Free/D1 settings pass offline, but missing real UUID remains a warning',async()=>fixture(async({root})=>{
  const r=await inspectStatic(root);
  assert.equal(r.ok,true);assert.equal(r.checkedAssets,files.length);
  assert.match(r.warnings.join(' '),/not configured/);
}));
test('trial preflight rejects placeholder D1 UUID',async()=>fixture(async({root})=>{
  const r=await inspectStatic(root,{requireRealD1:true});
  assert.equal(r.ok,false);assert.match(r.errors.join(' '),/valid D1/);
}));
test('synthetic UUID passes format only, not proof of remote D1 ownership',async()=>fixture(async({root,writeConfig})=>{
  const c=config();c.d1_databases[0].database_id=validUuid;await writeConfig(c);
  const r=await inspectStatic(root,{requireRealD1:true});assert.equal(r.ok,true);
}));
test('disabling run_worker_first fails closed',async()=>fixture(async({root,writeConfig})=>{
  const c=config();c.assets.run_worker_first=false;await writeConfig(c);
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/run_worker_first/);
}));
test('production route and extra D1 binding are rejected',async()=>fixture(async({root,writeConfig})=>{
  const c=config();c.routes=['example.com/*'];c.d1_databases.push({...c.d1_databases[0],binding:'OTHER'});await writeConfig(c);
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/production routes/);assert.match(r.errors.join(' '),/single dedicated DB/);
}));
test('Caffeine Atlas must remain outside protected dist',async()=>fixture(async({root,dist})=>{
  await mkdir(join(dist,'caffeine-atlas'));await writeFile(join(dist,'caffeine-atlas','index.html'),'mock');
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/Forbidden asset path/);
}));
test('secrets and symlink assets are rejected',async()=>fixture(async({root,dist})=>{
  await writeFile(join(dist,'.dev.vars'),'SECRET=do-not-read');
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/Forbidden asset path/);
}));
test('symlinked asset tree cannot escape inspected bundle',async()=>fixture(async({root,dist})=>{
  await symlink('/tmp',join(dist,'external'));
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/symbolic link/);
}));
test('missing critical LabInsight script fails closed',async()=>fixture(async({root,dist})=>{
  await rm(join(dist,'labinsight','app.js'));
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/Missing protected asset: labinsight\/app.js/);
}));
test('malformed JSON cannot silently pass',async()=>fixture(async({root})=>{
  await writeFile(join(root,'free-auth','wrangler.jsonc'),'{');
  const r=await inspectStatic(root);assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/Cannot parse/);
}));
test('CLI resolves repository root from its own path, not caller cwd',async()=>fixture(async({root})=>{
  const dest=join(root,'free-auth','scripts','preflight-static.mjs');
  await mkdir(join(root,'free-auth','scripts'),{recursive:true});
  await copyFile(fileURLToPath(new URL('../scripts/preflight-static.mjs',import.meta.url)),dest);
  const run=spawnSync(process.execPath,[dest,'--json'],{cwd:'/tmp',encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.ok,true);
  assert.equal(report.checkedAssets,files.length);
}));
test('a symlinked dist root cannot be treated as an inspected protected bundle',async()=>fixture(async({root,dist})=>{
  await rm(dist,{recursive:true});
  await symlink('/tmp',dist);
  const r=await inspectStatic(root);
  assert.equal(r.ok,false);
  assert.match(r.errors.join(' '),/real directory/);
}));

test('release-only privacy gate blocks unfinished notice but leaves development CI runnable',async()=>fixture(async({root,dist})=>{
  const location=join(dist,'membership-privacy.html');
  await writeFile(location,'회원가입 개인정보 처리 안내 Google Cloudflare 보관기간 정식 개인정보처리방침 최종 확정 전 안내');
  const development=await inspectStatic(root);
  assert.equal(development.ok,true);
  assert.match(development.warnings.join(' '),/Membership privacy notice/);
  const release=await inspectStatic(root,{requireFinalPolicy:true});
  assert.equal(release.ok,false);
  assert.match(release.errors.join(' '),/Membership privacy notice/);
}));
test('strict policy check detects missing private contact and recognizes synthetic updated text',async()=>fixture(async({root,dist})=>{
  const location=join(dist,'membership-privacy.html');
  await writeFile(location,'회원가입 개인정보 처리 안내 Google Cloudflare 보관기간');
  assert.equal((await inspectStatic(root,{requireFinalPolicy:true})).ok,false);
  // Synthetic fixtures test validation only; this does not certify legal completeness.
  await writeFile(location,'회원가입 개인정보 처리 안내 Google Cloudflare 보관기간: 검토된 기간. <a href="mailto:privacy@example.invalid">전용 문의</a>');
  const result=await inspectStatic(root,{requireFinalPolicy:true});
  assert.equal(result.ok,true,result.errors.join('; '));
}));

test('trial host is exact and public vars cannot accidentally include credentials',async()=>fixture(async({root,writeConfig})=>{
  const c=config();c.vars.AUTH_ORIGIN='https://some-other-worker.workers.dev';await writeConfig(c);
  let r=await inspectStatic(root);assert.equal(r.ok,false);assert.match(r.errors.join(' '),/AUTH_ORIGIN/);
  c.vars.AUTH_ORIGIN='https://labdam-free-approval.jleegenomics.workers.dev';c.vars.GOOGLE_CLIENT_SECRET='SHOULD_NOT_BE_IN_VARS';await writeConfig(c);
  r=await inspectStatic(root);assert.equal(r.ok,false);assert.match(r.errors.join(' '),/AUTH_ORIGIN/);
}));
