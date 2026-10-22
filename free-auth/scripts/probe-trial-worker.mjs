/**
 * Anonymous read-only smoke checks for an explicitly supplied TRIAL Worker origin.
 * Does not authenticate, submit forms, exchange OAuth codes, deploy or mutate D1.
 * Does not prove real Google login, remote D1, or old Pages cleanup.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CAFFEINE_ORIGIN = 'https://haru-today.github.io';
const PRIVATE = [
  ['/labinsight/','303','login'],
  ['/labinsight/checkup.html','303','login'],
  ['/labinsight/report.html','303','login'],
  ['/labinsight/carepath.html','303','login'],
  ['/admin.html','303','login'],
  ['/labinsight/app.js','401','deny'],
  ['/labinsight/carepath.js','401','deny'],
  ['/labinsight/carepath-data.js','401','deny'],
  ['/labinsight/styles.css','401','deny'],
  ['/labinsight/service-worker.js','401','deny'],
  ['/api/me','401','deny'],
  ['/api/admin/applications','401','deny'],
  ['/caffeine-atlas/','404','notfound']
];
const PUBLIC = [
  '/','/index.html','/assets/portal-redesign.css','/assets/portal-session.js','/favicon.svg',
  '/privacy.html','/terms.html','/api/session-status','/login.html','/pending.html','/membership-privacy.html'
];
const CAFFEINE = [
  '/caffeine-atlas/',
  '/caffeine-atlas/caffeine-sensitivity-app/analyzer.html',
  '/caffeine-atlas/privacy.html',
  '/caffeine-atlas/terms.html'
];

export function normalizeTrialOrigin(input) {
  if (typeof input!=='string') throw Error('A trial HTTPS origin is required');
  let u;
  try { u = new URL(input); } catch(_) { throw Error('Invalid trial HTTPS origin'); }
  if (u.protocol!=='https:' || u.username || u.password || u.search || u.hash ||
      u.pathname!=='/' || u.hostname==='haru-today.github.io' ||
      u.hostname==='github.io' || u.hostname.endsWith('.github.io') ||
      u.hostname==='localhost' || u.hostname.endsWith('.localhost')) {
    throw Error('Use a separate HTTPS trial Worker origin, never the public Pages origin');
  }
  return u.origin;
}

const trialCases = [
  ['/healthz',200,'health'],
  ...PUBLIC.map(p=>[p,200,'public']),
  ...PRIVATE.map(([p,status,kind])=>[p,Number(status),kind]),
  ...CAFFEINE.map(p=>[p,200,'caffeine'])
];
export async function probeTrialWorker(input, fetchImpl=fetch) {
  const origin=normalizeTrialOrigin(input);
  const results=[];
  for (const [path,expected,kind] of trialCases) {
    const base=kind==='caffeine'?CAFFEINE_ORIGIN:origin;
    const url=base+path;
    try {
      const response=await fetchImpl(url,{
        method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',
        headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(7000)
      });
      const status=response.status;
      const location=response.headers.get('Location');
      const cacheControl=response.headers.get('Cache-Control')||'';
      let ok=status===expected;
      if (kind==='login') {
        const expectedRedirect=new URL('/#login',origin);
        let resolved;
        try { resolved=new URL(location,origin); } catch (_) {}
        ok=ok && resolved?.origin===origin && resolved?.pathname===expectedRedirect.pathname && resolved?.hash===expectedRedirect.hash;
      }
      if (kind==='deny'||kind==='login') {
        ok=ok && /no-store/i.test(cacheControl);
      }
      // Ignore body; never collect any membership information or patient records.
      if(response.body) {
        try {await response.body.cancel();}catch(_){}
      }
      results.push({path,kind,status,expected,ok});
    } catch (_) {
      results.push({path,kind,status:null,expected,ok:false});
    }
  }
  return {
    origin,ok:results.every(x=>x.ok),results,
    scope:'Anonymous HTTP status/header checks only. OAuth/D1/real sessions unverified.'
  };
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length<2||args.length>3||args[0]!=='--origin'||
     (args.length===3&&args[2]!=='--json')){
    process.stderr.write('Usage: node free-auth/scripts/probe-trial-worker.mjs --origin https://YOUR-TRIAL.workers.dev [--json]\n');
    process.exitCode=2;return;
  }
  let report;
  try {report=await probeTrialWorker(args[1]);}
  catch(e) {process.stderr.write(e.message+'\n');process.exitCode=2;return;}
  if(args[2]==='--json')process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else {
    for(const r of report.results)console.log(r.ok?'PASS':'FAIL',
      String(r.status??'NETWORK').padEnd(7),r.kind.padEnd(9),r.path);
    console.log('Anonymous trial gate:',report.ok?'PASS':'FAIL');
    console.log(report.scope);
  }
  if(!report.ok)process.exitCode=1;
}
if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(()=>{process.stderr.write('Trial probe failed.\n');process.exitCode=2;});
}
