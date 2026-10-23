import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,rmSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const supplierBytes=3480,supplierSHA='d1109077972c3c3097411a102fcb97bd333f1b03ea5cb0452f90e42595c94c15';
const source=new URL('../scripts/build-contract-relay-runtime-manifest.mjs',import.meta.url),script=readFileSync(source);
const sha=b=>createHash('sha256').update(b).digest('hex');
const row=(path,value)=>({path,bytes:Buffer.byteLength(value),sha256:sha(Buffer.from(value))});
// PUBLIC tiny manifest DATA only. No real package, Source, Native or executor
// is admitted. Tests invoke the original supplier script in isolated tmp roots.
function fixture({outputDirectory=true}={}){
 const root=mkdtempSync(join(tmpdir(),'ynx-runtime-union-PUBLIC-')),tool=join(root,'tool','build-contract-relay-runtime-manifest.mjs');mkdirSync(join(root,'tool'));copyFileSync(source,tool);if(outputDirectory)mkdirSync(join(root,'tool/evidence'));
 const shared=row('src/PUBLIC-shared.js','PUBLIC shared'),executor=row('src/walletconnect-contract-initiator-boundary.js','PUBLIC executor bytes, not real authority');
 const auth={version:'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1',files:[shared,executor,row('src/PUBLIC-empty.js','')]};
 const wc={kind:'YNX-WALLETCONNECT-PRODUCTION-CLOSURE/v1',sdk:{version:'1.3.0-pq.3.32-auth.14'},files:[{...shared,size:shared.bytes},{...row('node_modules/PUBLIC/index.js','PUBLIC dependency'),size:17}],packages:[{name:'PUBLIC'}],edges:[{from:'PUBLIC'}]};
 const aPath=join(root,'original-auth-runtime-manifest.json'),wPath=join(root,'walletconnect-runtime-manifest.json'),H=join(root,'PUBLIC_CANONICAL_HANDOFF.json');
 const h={commit:'PUBLIC-fixture-not-a-commit',versionSDK:wc.sdk.version,evidence:[],runtime:{Auth:{},WalletConnect:{}},NativeAdmission:true,platformQualified:true,network:true,executor:{sha256:'f'.repeat(64)}};
 function freeze(){
  const refs=[];for(const [path,body]of [[aPath,auth],[wPath,wc]]){const raw=Buffer.from(JSON.stringify(body));writeFileSync(path,raw);refs.push({path,bytes:raw.length,sha256:sha(raw)});}
  h.evidence=refs;h.runtime.Auth={files:auth.files.length,manifestSHA256:refs[0].sha256};h.runtime.WalletConnect={files:wc.files.length,packages:wc.packages.length,edges:wc.edges.length};
  return pinH();
 }
 function pinH(){const raw=Buffer.from(JSON.stringify(h));writeFileSync(H,raw);return{bytes:raw.length,sha256:sha(raw)};}
 function run(args){const p=pinH();return spawnSync(process.execPath,[tool,...(args??[H,String(p.bytes),p.sha256])],{encoding:'utf8',cwd:root,timeout:5000});}
 freeze();return{root,tool,auth,wc,h,H,aPath,wPath,executor,freeze,pinH,run,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const reject=(run,pattern)=>{assert.notEqual(run.status,0);assert.match(run.stderr,pattern);};

test('runtime union normal tool is byte-identical to original R166 supplier',()=>{assert.equal(script.length,supplierBytes);assert.equal(sha(script),supplierSHA);});
test('PUBLIC exact manifests union deduplicates matching paths, preserves empty file and derives real input executor',()=>{
 const f=fixture();try{
  const run=f.run();assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout),raw=readFileSync(result.manifest.path),union=JSON.parse(raw);
  assert.equal(result.fileCount,4);assert.equal(result.sharedIdentical,1);assert.deepEqual(result.executor,f.executor);assert.equal(result.executor.sha256,f.auth.files[1].sha256);
  assert.equal(raw.length,result.manifest.bytes);assert.equal(sha(raw),result.manifest.sha256);assert.deepEqual(union.files.map(x=>x.path),[...union.files.map(x=>x.path)].sort());assert.equal(union.files.filter(x=>x.path==='src/PUBLIC-shared.js').length,1);
  assert.equal(union.files.find(x=>x.path==='src/PUBLIC-empty.js').sha256,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for(const flag of ['NativeAdmission','platformQualified','network'])assert.equal(result[flag],false);assert.equal(result.installedSourceRoot,null);assert.equal(result.normalSuccessorWillRequireRegeneration,true);
  assert.ok(!union.files.some(x=>x.path==='native/original-ide-contract-relay-runtime-manifest.json'));
  assert.equal(union.version,'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1');assert.deepEqual(JSON.parse(readFileSync(join(result.manifest.path,'../UNION.json'))),result);
 }finally{f.cleanup();}
});
test('PUBLIC canonical handoff requires absolute path and exact bytes/SHA before output',()=>{
 const f=fixture();try{const p=f.pinH();for(const args of [['PUBLIC_CANONICAL_HANDOFF.json',String(p.bytes),p.sha256],[f.H,String(p.bytes+1),p.sha256],[f.H,String(p.bytes),'0'.repeat(64)],[f.H,'not-bytes',p.sha256],[f.H,String(p.bytes),'not-sha']])reject(f.run(args),/exact canonical handoff|canonical handoff differs/);assert.deepEqual(readdirSync(join(f.root,'tool/evidence')),[]);}finally{f.cleanup();}
});
test('PUBLIC conflicting Auth/WalletConnect file identity is rejected without union output',()=>{
 for(const changed of ['hash','size']){const f=fixture();try{if(changed==='hash')f.wc.files[0].sha256='a'.repeat(64);else f.wc.files[0].size++;f.freeze();reject(f.run(),/normal closures conflict/);assert.deepEqual(readdirSync(join(f.root,'tool/evidence')),[]);}finally{f.cleanup();}}
});
test('PUBLIC version/count/root/reference tampering fails rather than admitting another closure',()=>{
 for(const changed of ['auth-version','sdk-version','count','missing-ref','missing-root','ref-bytes','ref-sha','manifest-tamper']){
  const f=fixture();try{
   let expected=/normal closure identity differs/;
   if(changed==='auth-version')f.auth.version='PUBLIC_OTHER_VERSION';if(changed==='sdk-version')f.wc.sdk.version='PUBLIC_OTHER_SDK';f.freeze();
   if(changed==='count')f.h.runtime.Auth.files++;
   if(changed==='missing-ref'){f.h.evidence=[];expected=/missing original manifest/;}
   if(changed==='missing-root'){f.h.evidence[0].path=join(f.root,'absent-root/original-auth-runtime-manifest.json');expected=/ENOENT/;}
   if(changed==='ref-bytes'){f.h.evidence[0].bytes++;expected=/normal manifest differs/;}
   if(changed==='ref-sha'){f.h.evidence[1].sha256='0'.repeat(64);expected=/normal manifest differs/;}
   if(changed==='manifest-tamper'){writeFileSync(f.aPath,readFileSync(f.aPath)+' ');expected=/normal manifest differs/;}
   reject(f.run(),expected);assert.deepEqual(readdirSync(join(f.root,'tool/evidence')),[]);
  }finally{f.cleanup();}
 }
});
test('PUBLIC missing output root, absent executor, unsafe paths and self-inclusion are refused',()=>{
 const missing=fixture({outputDirectory:false});try{reject(missing.run(),/ENOENT/);}finally{missing.cleanup();}
 for(const changed of ['executor','self','traversal','empty-sha']){
  const f=fixture();try{
   if(changed==='executor')f.auth.files=f.auth.files.filter(x=>x.path!==f.executor.path);
   if(changed==='self')f.auth.files.push(row('native/original-ide-contract-relay-runtime-manifest.json','PUBLIC forbidden self'));
   if(changed==='traversal')f.auth.files.push(row('../PUBLIC-escape.js','PUBLIC forbidden path'));
   if(changed==='empty-sha')f.auth.files.find(x=>x.bytes===0).sha256='0'.repeat(64);
   f.freeze();reject(f.run(),changed==='executor'?/initiator executor absent/:/normal file entry differs/);
  }finally{f.cleanup();}
 }
});
