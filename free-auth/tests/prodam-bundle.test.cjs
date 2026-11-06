'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const source=process.env.LABDAM_PRODAM_PRIVATE_ASSETS,script=path.resolve(__dirname,'../prepare-prodam-bundle.mjs');
test('reviewed PRODAM assembly accepts only the exact snapshot and never overwrites',{skip:!source && 'requires the private reviewed asset checkout'},t=>{
  const root=path.resolve(os.tmpdir()),tmp=fs.mkdtempSync(path.join(root,'prodam-bundle-test-'));
  t.after(()=>{if(path.dirname(tmp)!==root||!path.basename(tmp).startsWith('prodam-bundle-test-'))throw Error('unsafe cleanup');fs.rmSync(tmp,{recursive:true,force:true});});
  const input=path.join(tmp,'source'),out=path.join(tmp,'output');fs.cpSync(path.resolve(source),input,{recursive:true});
  const run=(src,dst)=>cp.spawnSync(process.execPath,[script,src,dst],{encoding:'utf8'});
  assert.equal(run(input,out).status,0);
  const existing=run(input,out);assert.equal(existing.status,1,'existing output must not be overwritten');assert.match(existing.stderr,/EEXIST/);
  fs.appendFileSync(path.join(input,'app.js'),'\n// tampered in test\n');
  const mismatch=path.join(tmp,'mismatch'),badHash=run(input,mismatch);assert.equal(badHash.status,1);assert.match(badHash.stderr,/Asset checksum mismatch: app\.js/);assert.equal(fs.existsSync(mismatch),false);
  fs.copyFileSync(path.join(source,'app.js'),path.join(input,'app.js'));
  fs.writeFileSync(path.join(input,'unexpected.js'),'test');
  const extra=path.join(tmp,'extra'),badSet=run(input,extra);assert.equal(badSet.status,1);assert.match(badSet.stderr,/Source asset set differs/);assert.equal(fs.existsSync(extra),false);
  fs.rmSync(path.join(input,'unexpected.js'));
  const nested=path.join(input,'nested'),badTarget=run(input,nested);assert.equal(badTarget.status,1,'output cannot be inside source');assert.match(badTarget.stderr,/Source and target must be separate/);assert.equal(fs.existsSync(nested),false);
});
