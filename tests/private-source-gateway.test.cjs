"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const fixture=require("./fixtures/private-source-gateway-sha256.json");
const root=path.join(__dirname,"../labinsight");
test("private-source transition publishes only the reviewed legacy handoffs, not the health app",()=>{
  assert.deepEqual(fs.readdirSync(root).sort(),Object.keys(fixture.files).sort());
  for(const [file,digest] of Object.entries(fixture.files)){
    const data=fs.readFileSync(path.join(root,file));
    assert.equal(createHash("sha256").update(data).digest("hex"),digest,file+" must remain the reviewed data-free handoff");
  }
  for(const file of ["index.html","checkup.html","report.html","hospitals.html","account.html","404.html"]){
    const html=fs.readFileSync(path.join(root,file),"utf8");
    assert.doesNotMatch(html,/<(?:form|input|script)\b|localStorage|sessionStorage/i,file);
    assert.ok(html.includes('name="robots" content="noindex,nofollow"'),file);
    assert.ok(html.includes('https://labdam-free-approval.jleegenomics.workers.dev/'),file);
  }
  for(const file of ["app.js","styles.css","ocr-review.js","carepath.html","carepath.js","runtime-config.js"])
    assert.equal(fs.existsSync(path.join(root,file)),false,file+" must stay approval-protected");
});
