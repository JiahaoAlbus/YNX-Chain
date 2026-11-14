import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';
const realRequire=createRequire(import.meta.url);
test('normal producer shell preserves the Root63 provenance branch and actually verifies its source roles',async t=>{
 const temp=await mkdtemp(join(tmpdir(),'ynx-provenance-shell-'));t.after(()=>rm(temp,{recursive:true,force:true}));const capture=join(temp,'captured.js');
 const script=await readFile(new URL('../scripts/package-local-macos.sh',import.meta.url),'utf8'),start=script.indexOf("node -e '\nconst fs = require(\"fs\");"),end=script.indexOf('\n# A projected SDK',start);
 assert.ok(start>0&&end>start);
 // Capture the exact argv after bash quoting, not a JS substring before shell
 // interpretation. The original single-quote defect parses but loses a literal.
 execFileSync('/bin/bash',['-c','node() { printf "%s" "$2" > "$capture"; }\n'+script.slice(start,end)],{env:{...process.env,capture},stdio:'pipe'});
 const code=await readFile(capture,'utf8');let verified=false,written;
 const fakeFS={existsSync:()=>false,readFileSync:p=>JSON.stringify(p.endsWith('desktop-entry.json')?{mode:'local'}:{sourceCommit:'source',sourceVariant:'ROOT63_RESOURCE8',SDKSourceCommit:'sdk'}),writeFileSync:(_,body)=>{written=JSON.parse(body);}};
 const require=n=>n==='fs'?fakeFS:n==='child_process'?{execFileSync:()=>{verified=true;return JSON.stringify({applicationSourceCommit:'source',assembledSourceCommit:'source',originalNativeReceiptsPreserved:true});}}:realRequire(n);
 runInNewContext(code,{require,process:{execPath:process.execPath,argv:['node','/QA.app/Contents/Resources/build-provenance.json','source','tree','date','checkpoint','sbom','macos-arm64','15.0','compat','brand','']}});
 assert.equal(verified,true);assert.equal(written.currentPackageSourceRoles.applicationSourceCommit,'source');assert.equal(written.nativeLink.SDKSourceCommit,'sdk');
 // Exercise the actual shell-decoded producer, including its independent SDK
 // binding branch. A valid new resource-only variant must not be rejected by
 // the older provenance list after the runtime loader has already admitted it.
 for(const variant of ['SDK49-IDE-C6-SCOPE-PHASE-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-CONTROL-MATCHED-WHOLE-SOURCE-ARCHIVE-RUNTIME/v1','PUBLIC_UNREVIEWED_VARIANT']){
  const binding=Buffer.from(JSON.stringify({schema:'YNX_IDE_SDK_PROJECTION_BINDING/v1',sourceVariant:variant}));written=undefined;
  const bindingFS={...fakeFS,existsSync:p=>p.endsWith('identity-sdk-projection-binding.json'),readFileSync:p=>p.endsWith('identity-sdk-projection-binding.json')?binding:fakeFS.readFileSync(p)};
  const boundRequire=n=>n==='fs'?bindingFS:require(n);
  const run=()=>runInNewContext(code,{require:boundRequire,process:{execPath:process.execPath,argv:['node','/QA.app/Contents/Resources/build-provenance.json','source','tree','date','checkpoint','sbom','macos-arm64','15.0','compat','brand','']}});
  if(variant==='PUBLIC_UNREVIEWED_VARIANT'){assert.throws(run,/Exact current SDK projection binding/);assert.equal(written,undefined);}
  else{run();assert.equal(written.packagedSDKSourceProjection.sourceVariant,variant);assert.equal(written.packagedSDKSourceProjection.bytes,binding.length);assert.equal(written.packagedSDKSourceProjection.sha256,realRequire('crypto').createHash('sha256').update(binding).digest('hex'));}
 }
});
