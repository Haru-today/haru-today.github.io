"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {deployment, uploaded, latest, compareVersions} = require("../scripts/prodam-cutover-guard.cjs");
const id = "a1234567-1234-1234-1234-123456789abc";
const candidate = "b1234567-1234-1234-1234-123456789abc";
const dep = () => ({id, versions:[{version_id:id, percentage:100}]});
test("only a single complete deployment is eligible for promotion or rollback", () => {
  assert.deepEqual(deployment(dep()), {deployment:id, version:id});
  for (const value of [{}, {...dep(),versions:[]}, {...dep(),versions:[{version_id:id,percentage:50}]}, {...dep(),id:"no"}]) assert.throws(() => deployment(value));
});
test("a unique upload event must name the intended Worker", () => {
  const good = JSON.stringify({type:"version-upload",worker_name:"labdam-free-approval",version_id:id});
  assert.equal(uploaded(good),id);
  for (const value of ["", good+"\n"+good, good.replace("labdam-free-approval", "other")]) assert.throws(() => uploaded(value));
});
test("bindings retain all existing settings and secrets; only two exact switches may be added", () => {
  const base = {id,resources:{script_runtime:{compatibility_date:"2026-10-14"},bindings:[{type:"d1",name:"DB",id:"db"},{type:"assets",name:"ASSETS"},{type:"secret_text",name:"GOOGLE_CLIENT_SECRET"},{type:"secret_text",name:"RATE_LIMIT_SECRET"},{type:"plain_text",name:"AUTH_ORIGIN",text:"same"}]}};
  const next = structuredClone(base);
  next.id = candidate;
  next.resources.bindings.push({type:"plain_text",name:"PRODAM_REVIEW_ONLY",text:"1"},{type:"plain_text",name:"PRODAM_REVIEW_ORIGIN",text:"https://repodam.labdam.kr"});
  compareVersions(base,next,id,candidate);
  assert.throws(() => compareVersions(base,next,candidate,id));
  for (const mutate of [x => x.resources.bindings.splice(0,1), x => x.resources.bindings[4].text="changed", x => x.resources.bindings.push({type:"plain_text",name:"EXTRA",text:"1"}), x => x.resources.bindings[5].text="0", x => x.resources.script_runtime.compatibility_date="other", x => x.resources.bindings[2].type="plain_text"]) {
    const broken=structuredClone(next); mutate(broken); assert.throws(() => compareVersions(base,broken,id,candidate));
  }
});
test("secret inheritance is allowed only when newest version matches expected", () => {
  latest([{id}],id);
  latest([{id},{id:candidate}],candidate,id);
  assert.throws(() => latest([{id},{id},{id:candidate}],candidate,"c1234567-1234-1234-1234-123456789abc"));
  assert.throws(() => latest([{id},{id:candidate}],id));
  assert.throws(() => latest([],id));
});
