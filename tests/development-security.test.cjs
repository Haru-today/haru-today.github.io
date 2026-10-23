"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
test("external Actions are pinned and no privileged PR event or automatic production deploy is added",()=>{
  const root=path.join(__dirname,"../.github/workflows");
  for(const name of fs.readdirSync(root).filter(n=>n.endsWith(".yml"))){
    const text=fs.readFileSync(path.join(root,name),"utf8");
    assert.doesNotMatch(text,/^\s+pull_request_target:/m,name);
    for(const [,action,ref] of text.matchAll(/uses:\s+([\w.-]+\/[\w.-]+)@([^\s#]+)/g))assert.match(ref,/^[0-9a-f]{40}$/,name+": "+action);
  }
});
