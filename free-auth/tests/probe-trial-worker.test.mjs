import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeTrialWorker,normalizeTrialOrigin} from '../scripts/probe-trial-worker.mjs';
const ORIGIN='https://labdam-test.workers.dev';
const CAFFEINE='https://haru-today.github.io';
function fakeReply(url) {
  const pathname=new URL(url).pathname;
  const isCaffeine=url.startsWith(CAFFEINE);
  const isPublic=['/healthz','/login.html','/pending.html','/membership-privacy.html'].includes(pathname);
  const isRedirect=['/','/index.html','/labinsight/','/labinsight/checkup.html','/labinsight/report.html','/admin.html'].includes(pathname);
  const status=isCaffeine||isPublic?200:isRedirect?303:pathname==='/caffeine-atlas/'?404:401;
  const headers={'Cache-Control':'private, no-store, max-age=0'};
  if(isRedirect)headers.Location=ORIGIN+'/login.html?next=%2F';
  return new Response(null,{status,headers});
}
test('realistic anonymous Worker gate plus unchanged public Caffeine URLs pass',async()=>{
 const result=await probeTrialWorker(ORIGIN,async url=>fakeReply(url));
 assert.equal(result.ok,true);
 assert.equal(result.results.length,21);
 assert.equal(result.results.filter(x=>x.kind==='caffeine').length,4);
});
test('no credentials, no redirects followed, no write methods or OAuth state creation',async()=>{
 const calls=[];
 await probeTrialWorker(ORIGIN,async(url,options)=>{
   calls.push({url,options});return fakeReply(url);
 });
 assert.equal(calls.length,21);
 for (const {url,options} of calls) {
   assert.equal(options.method,'GET');
   assert.equal(options.credentials,'omit');
   assert.equal(options.redirect,'manual');
   assert.equal(options.cache,'no-store');
   assert.equal(options.headers['Cache-Control'],'no-cache');
   assert.equal(new URL(url).pathname.startsWith('/auth/'),false);
 }
});
test('misconfigured public LabInsight JS or missing no-store fails gate',async()=>{
 const exposed=await probeTrialWorker(ORIGIN,async url=>{
   const r=fakeReply(url);
   if(url.endsWith('/labinsight/app.js'))return new Response(null,{status:200});
   return r;
 });
 assert.equal(exposed.ok,false);
 assert.equal(exposed.results.find(x=>x.path==='/labinsight/app.js').ok,false);
 const cacheFailure=await probeTrialWorker(ORIGIN,async url=>{
   const r=fakeReply(url);
   if(url.endsWith('/labinsight/styles.css'))return new Response(null,{status:401});
   return r;
 });
 assert.equal(cacheFailure.ok,false);
});
test('external redirect, 503, Caffeine outage, network errors fail closed',async()=>{
 const report=await probeTrialWorker(ORIGIN,async url=>{
   if(url.endsWith('/index.html'))return new Response(null,{status:303,headers:{Location:'https://attacker.example/login.html','Cache-Control':'no-store'}});
   if(url.endsWith('/healthz'))return new Response(null,{status:503});
   if(url.startsWith(CAFFEINE))return new Response(null,{status:503});
   if(url.endsWith('/api/me'))throw Error('network');
   return fakeReply(url);
 });
 assert.equal(report.ok,false);
 assert.equal(report.results.find(x=>x.path==='/index.html').ok,false);
 assert.equal(report.results.find(x=>x.path==='/api/me').status,null);
 assert.equal(report.results.filter(x=>x.kind==='caffeine'&&x.ok).length,0);
});
test('rejects Pages, localhost, non-HTTPS and origin with credentials/path/query',()=>{
 for(const x of [
  'https://haru-today.github.io','https://something.github.io','http://labdam-test.workers.dev',
  'http://localhost:8787','https://localhost','https://username:password@labdam-test.workers.dev',
  'https://labdam-test.workers.dev/labinsight','https://labdam-test.workers.dev/?a=b',
  'https://labdam-test.workers.dev/#frag'
 ])assert.throws(()=>normalizeTrialOrigin(x),x);
 assert.equal(normalizeTrialOrigin(ORIGIN+'/'),ORIGIN);
});
