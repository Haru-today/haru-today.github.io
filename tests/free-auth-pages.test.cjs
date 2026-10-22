"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

async function load(){return import("../free-auth/scripts/audit-public-pages.mjs");}
test("public path probe inventories protected LABDAM/REPODAM and exactly the four poster URLs",async()=>{
  const {LEGACY_PROTECTED_PATHS, PUBLIC_CAFFEINE_PATHS}=await load();
  assert.equal(new Set([...LEGACY_PROTECTED_PATHS,...PUBLIC_CAFFEINE_PATHS]).size,
    LEGACY_PROTECTED_PATHS.length+PUBLIC_CAFFEINE_PATHS.length);
  for(const name of ["/labinsight/app.js","/labinsight/service-worker.js","/labinsight/report.html",
    "/labinsight/manifest.webmanifest","/labinsight/icons/icon-192.png"]){
    assert.ok(LEGACY_PROTECTED_PATHS.includes(name),name);
  }
  assert.deepEqual(PUBLIC_CAFFEINE_PATHS,[
    "/caffeine-atlas/","/caffeine-atlas/caffeine-sensitivity-app/analyzer.html",
    "/caffeine-atlas/privacy.html","/caffeine-atlas/terms.html"
  ]);
});
test("anonymous GET audit flags exposed legacy paths without treating public Caffeine Atlas as private",async()=>{
  const {auditPublicPages,PAGES_ORIGIN,LEGACY_PROTECTED_PATHS,PUBLIC_CAFFEINE_PATHS}=await load();
  const calls=[];
  const report=await auditPublicPages(async(url,init)=>{
    calls.push({url,init});
    const status=url.includes("/caffeine-atlas/")?200:200;
    return new Response(null,{status});
  });
  assert.equal(report.cutoverReady,false);
  assert.equal(report.results.filter(x=>x.state==="EXPOSED").length,LEGACY_PROTECTED_PATHS.length);
  assert.equal(report.results.filter(x=>x.state==="PUBLIC").length,PUBLIC_CAFFEINE_PATHS.length);
  assert.equal(calls.length,LEGACY_PROTECTED_PATHS.length+PUBLIC_CAFFEINE_PATHS.length);
  for(const {url,init} of calls){
    assert.ok(url.startsWith(PAGES_ORIGIN+"/"));
    assert.equal(init.method,"GET");
    assert.equal(init.credentials,"omit");
    assert.equal(init.redirect,"manual");
    assert.equal(init.headers["Cache-Control"],"no-cache");
    assert.equal(Object.hasOwn(init.headers,"Cookie"),false);
  }
});
test("cutover is READY only when private paths are closed and poster links stay publicly readable",async()=>{
  const {auditPublicPages}=await load();
  const fetchImpl=async url=>new Response(null,{
    status:url.includes("/caffeine-atlas/")?200:404
  });
  const report=await auditPublicPages(fetchImpl);
  assert.equal(report.cutoverReady,true);
  assert.equal(report.results.filter(x=>x.state==="CLOSED").length,18);
});
test("redirects, connectivity errors, and unavailable public Caffeine URLs remain REVIEW",async()=>{
  const {auditPublicPages}=await load();
  const report=await auditPublicPages(async url=>{
    if(url.endsWith("/labinsight/app.js"))throw Error("network disabled");
    if(url.includes("/caffeine-atlas/"))return new Response(null,{status:503});
    return new Response(null,{status:302,headers:{Location:"/login.html"}});
  });
  assert.equal(report.cutoverReady,false);
  assert.equal(report.results.find(x=>x.path==="/labinsight/app.js").state,"REVIEW");
  assert.equal(report.results.filter(x=>x.kind==="caffeine"&&x.state==="REVIEW").length,4);
});
