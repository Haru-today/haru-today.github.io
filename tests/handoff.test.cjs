"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const script = fs.readFileSync(__dirname + "/../free-auth/handoff.js", "utf8");
const OLD = "https://labdam-free-approval.jleegenomics.workers.dev", NEXT = "https://repodam.labdam.kr";
const REPORT = "labinsight-latest-report", CARE = "labinsight-carepath-session-v1";
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {data, getItem:k => data.has(k) ? data.get(k) : null,
    setItem:(k,v) => data.set(k,v), removeItem:k => data.delete(k)};
}
function page(origin, path, storage, identity = "a".repeat(64)) {
  const listeners = new Map(), writes = [], status = {textContent:""}, buttons = [];
  const location = {origin, pathname:path, hash:"", replace:x => writes.push(x)};
  const win = {
    addEventListener:(type, fn) => listeners.set(type, fn),
    removeEventListener:(type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); }
  };
  const sandbox = {
    window:win, location, sessionStorage:storage,
    document:{getElementById:() => status, querySelector:() => ({prepend:b => buttons.push(b)}),
      createElement:() => ({addEventListener:(_type, fn) => { sandbox.click = fn; }})},
    crypto:{getRandomValues:a => a.fill(17)},
    confirm:() => true, alert:() => {}, history:{replaceState:() => {}},
    setTimeout:() => 1, clearTimeout:() => {},
    fetch:async url => ({ok:true, json:async () => url === "/api/handoff-status" ? {enabled:true} : {id:identity}})
  };
  return {sandbox, listeners, writes, status, buttons, win};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test("same-account handoff copies synthetic tab data without deleting original", async () => {
  const report = JSON.stringify({glucose:100}), care = JSON.stringify({version:1, records:[]});
  const old = page(OLD, "/labinsight/", store({[REPORT]:report, [CARE]:care}));
  const next = page(NEXT, "/labinsight/handoff.html", store());
  const nonce = "11".repeat(32);
  next.sandbox.location.hash = "#" + nonce;
  const popup = {postMessage:(data, target) => {
    assert.equal(target, NEXT);
    next.listeners.get("message")?.({origin:OLD, source:opener, data});
  }};
  const opener = {postMessage:(data, target) => {
    assert.equal(target, OLD);
    old.listeners.get("message")?.({origin:NEXT, source:popup, data});
  }};
  old.win.open = () => popup;
  next.win.opener = opener;
  vm.runInNewContext(script, old.sandbox);
  old.sandbox.click();
  vm.runInNewContext(script, next.sandbox);
  await tick(); await tick();
  assert.equal(old.sandbox.sessionStorage.getItem(REPORT), report);
  assert.equal(next.sandbox.sessionStorage.getItem(REPORT), report);
  assert.equal(next.sandbox.sessionStorage.getItem(CARE), care);
  assert.deepEqual(next.writes, ["/labinsight/"]);
});
test("different account, foreign sender and populated destination cannot overwrite data", async () => {
  const old = page(OLD, "/labinsight/index.html", store({[REPORT]:'{"glucose":100}'}));
  const next = page(NEXT, "/labinsight/handoff.html", store({[REPORT]:'{"existing":true}'}), "b".repeat(64));
  const nonce = "11".repeat(32);
  next.sandbox.location.hash = "#" + nonce;
  const popup = {postMessage:(data, target) => next.listeners.get("message")?.({origin:OLD, source:opener, data})};
  const opener = {postMessage:(data, target) => old.listeners.get("message")?.({origin:NEXT, source:popup, data})};
  old.win.open = () => popup; next.win.opener = opener;
  vm.runInNewContext(script, old.sandbox); old.sandbox.click();
  old.listeners.get("message")({origin:"https://evil.invalid", source:popup, data:{type:"repodam-ready", nonce, id:"a".repeat(64)}});
  vm.runInNewContext(script, next.sandbox);
  await tick(); await tick();
  assert.equal(next.sandbox.sessionStorage.getItem(REPORT), '{"existing":true}');
  assert.equal(old.sandbox.sessionStorage.getItem(REPORT), '{"glucose":100}');
  assert.equal(next.writes.length, 0);
});
test("existing destination report is not overwritten even for the same account", async () => {
  const old = page(OLD, "/labinsight/", store({[REPORT]:'{"glucose":100}'}));
  const next = page(NEXT, "/labinsight/handoff.html", store({[REPORT]:'{"existing":true}'}));
  const nonce = "11".repeat(32); next.sandbox.location.hash = "#" + nonce;
  const popup = {postMessage:(data, target) => next.listeners.get("message")?.({origin:OLD, source:opener, data})};
  const opener = {postMessage:(data, target) => old.listeners.get("message")?.({origin:NEXT, source:popup, data})};
  old.win.open = () => popup; next.win.opener = opener;
  vm.runInNewContext(script, old.sandbox); old.sandbox.click();
  vm.runInNewContext(script, next.sandbox); await tick(); await tick();
  assert.equal(next.sandbox.sessionStorage.getItem(REPORT), '{"existing":true}');
  assert.equal(old.sandbox.sessionStorage.getItem(REPORT), '{"glucose":100}');
  assert.equal(next.writes.length, 0);
});
test("malformed or script-bearing report is not transferred", async () => {
  for (const value of ['{"glucose":"<img src=x onerror=alert(1)>"}', '{"unexpected":"data"}', 'not json']) {
    const old = page(OLD, "/labinsight/", store({[REPORT]:value}));
    const next = page(NEXT, "/labinsight/handoff.html", store());
    const nonce = "11".repeat(32); next.sandbox.location.hash = "#" + nonce;
    const popup = {postMessage:data => next.listeners.get("message")?.({origin:OLD, source:opener, data})};
    const opener = {postMessage:data => old.listeners.get("message")?.({origin:NEXT, source:popup, data})};
    old.win.open = () => popup; next.win.opener = opener;
    vm.runInNewContext(script, old.sandbox); old.sandbox.click();
    vm.runInNewContext(script, next.sandbox); await tick(); await tick();
    assert.equal(next.sandbox.sessionStorage.getItem(REPORT), null);
    assert.equal(old.sandbox.sessionStorage.getItem(REPORT), value);
    assert.equal(next.writes.length, 0);
  }
});
test("reviewed report, CarePath and sample booking shapes survive unchanged", async () => {
  const values = {
    [REPORT]:JSON.stringify({gender:"male",age:46,height:172,weight:78,bpSys:132,bpDia:86,
      bmi:26.37,ast:48,alt:72,glucose:112,provenance:"manual",reportSchemaVersion:4,
      referenceRanges:{ast:{min:0,max:40,unit:"U/L"}}}),
    [CARE]:JSON.stringify({version:1,records:[{id:"2026-01-05|Demo",date:"2026-01-05",
      laboratory:"Demo",note:"Synthetic\nsecond line",values:{ast:{value:48,unit:"U/L",range:{min:0,max:40,unit:"U/L"}}}}]}),
    "labinsight-demo-bookings-v2":JSON.stringify([{id:"sample",hospitalId:"sample",
      hospital:"Demo",department:"Demo",packageName:"Demo",date:"2026-01-05",time:"09:00",
      demo:true,status:"requested",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"}])
  };
  const old=page(OLD,"/labinsight/",store(values)), next=page(NEXT,"/labinsight/handoff.html",store());
  const nonce="11".repeat(32);next.sandbox.location.hash="#"+nonce;
  const popup={postMessage:data=>next.listeners.get("message")?.({origin:OLD,source:opener,data})};
  const opener={postMessage:data=>old.listeners.get("message")?.({origin:NEXT,source:popup,data})};
  old.win.open=()=>popup;next.win.opener=opener;
  vm.runInNewContext(script,old.sandbox);old.sandbox.click();
  vm.runInNewContext(script,next.sandbox);await tick();await tick();
  for(const [key,value] of Object.entries(values)) {
    assert.equal(old.sandbox.sessionStorage.getItem(key),value);
    assert.equal(next.sandbox.sessionStorage.getItem(key),value);
  }
});
test("source timeout stops a late identity response from sending data", async () => {
  const old=page(OLD,"/labinsight/",store({[REPORT]:'{"glucose":100}'}));
  let finishIdentity, timeout, sent=0;
  old.sandbox.setTimeout=fn => {timeout=fn;return 1;};
  old.sandbox.fetch=async url => url==="/api/handoff-status"
    ? {ok:true,json:async()=>({enabled:true})}
    : await new Promise(resolve=>{finishIdentity=resolve;});
  const popup={postMessage:()=>{sent++;}};
  old.win.open=()=>popup;
  vm.runInNewContext(script,old.sandbox); old.sandbox.click();
  old.listeners.get("message")({origin:NEXT,source:popup,data:{type:"repodam-ready",nonce:"11".repeat(32),id:"a".repeat(64)}});
  timeout();
  finishIdentity({ok:true,json:async()=>({id:"a".repeat(64)})});
  await tick(); await tick();
  assert.equal(sent,0);
  assert.equal(old.sandbox.sessionStorage.getItem(REPORT),'{"glucose":100}');
});
test("a destination without login promptly reports failure and re-enables the button", async () => {
  const old=page(OLD,"/labinsight/",store({[REPORT]:'{"glucose":100}'}));
  const next=page(NEXT,"/labinsight/handoff.html",store());
  next.sandbox.location.hash="#"+"11".repeat(32);
  next.sandbox.fetch=async()=>({ok:false});
  const popup={postMessage:data=>next.listeners.get("message")?.({origin:OLD,source:opener,data})};
  const opener={postMessage:data=>old.listeners.get("message")?.({origin:NEXT,source:popup,data})};
  old.win.open=()=>popup; next.win.opener=opener;
  vm.runInNewContext(script,old.sandbox);await tick();old.sandbox.click();
  assert.equal(old.buttons[0].disabled,true);
  vm.runInNewContext(script,next.sandbox);await tick();await tick();
  assert.equal(old.buttons[0].disabled,false);
  assert.equal(old.sandbox.sessionStorage.getItem(REPORT),'{"glucose":100}');
  assert.equal(next.writes.length,0);
});
