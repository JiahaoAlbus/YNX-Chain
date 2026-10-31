import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const contract=JSON.parse(fs.readFileSync(new URL('./sdk49-pending-native-source-contract.json',import.meta.url)));
const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}};
for(const r of contract.sourceFiles){const a=pin(path.join(repo,r.path));assert.equal(a.bytes,r.bytes,r.path);assert.equal(a.sha256,r.sha256,r.path)}
const pkg=path.join(repo,'packages/wallet-auth');
const native=JSON.parse(fs.readFileSync(path.join(pkg,'integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
assert.equal(native.NativeInputs.length,contract.NativeInputs);
for(const r of native.NativeInputs){const a=pin(path.join(repo,r.path));assert.equal(a.bytes,r.bytes,r.path);assert.equal(a.sha256,r.sha256,r.path)}
assert.equal(native.devicePendingNativeSuccessor.pendingNormalBuildPlanSupplied,false);
assert.equal(native.devicePendingNativeSuccessor.actualProtocolLibrarySupplied,false);
assert.deepEqual(native.devicePendingNativeSuccessor.compiledAdmissionRows,[]);
const out=process.env.SDK49_PENDING_PACKAGE_EVIDENCE??path.join(process.env.RUNNER_TEMP,'sdk49-pending-native-source');fs.mkdirSync(out,{recursive:true});const work=fs.mkdtempSync(path.join(out,'packed-'));const results=[];
function run(name,cmd,args,cwd=repo){const r=spawnSync(cmd,args,{cwd,env:process.env,timeout:60000,maxBuffer:8<<20});for(const k of ['stdout','stderr'])fs.writeFileSync(path.join(work,name+'.'+k),r[k]??'');results.push({name,status:r.status,signal:r.signal,stdout:pin(path.join(work,name+'.stdout')),stderr:pin(path.join(work,name+'.stderr'))});fs.writeFileSync(path.join(work,'COMMAND_RESULTS.json'),JSON.stringify(results,null,2));assert.equal(r.status,0,name+' failed; retained '+work);return r.stdout.toString()}
const [packed]=JSON.parse(run('npm-pack','npm',['pack',pkg,'--ignore-scripts','--json','--pack-destination',work]));
assert(!packed.files.some(r=>r.path.endsWith('.node')||r.path.endsWith('YNXIdentityReceiver')));
const unpack=path.join(work,'unpacked');fs.mkdirSync(unpack);run('tar-extract','tar',['-xzf',path.join(work,packed.filename),'-C',unpack]);
const stage=path.join(unpack,'package');const required=contract.sourceFiles.filter(r=>r.path.startsWith('packages/wallet-auth/'));
const actual=[];for(const r of required){const rel=r.path.slice('packages/wallet-auth/'.length);assert(packed.files.some(p=>p.path===rel),'NPM_MEMBER_MISSING:'+rel);const a=pin(path.join(stage,rel));assert.equal(a.bytes,r.bytes,rel);assert.equal(a.sha256,r.sha256,rel);actual.push({...a,relative:rel})}
run('public-subpath-import',process.execPath,['--input-type=module','-e','const m=await import("@ynx-chain/wallet-auth/original-product-device-v4-pending-client");if(typeof m.openOriginalProductSessionDeviceV4PendingProofClient!=="function")throw Error("PUBLIC_EXPORT_MISSING");'],stage);
const result={pass:true,sourcePins:contract.sourceFiles.length,NativeInputs:contract.NativeInputs,archive:pin(path.join(work,packed.filename)),npmMembers:packed.files.length,actualPackedMembers:actual,results,normalImportWithoutNativeAcquisition:true,oldGreenGroupsRerun:false,NativeLinked:false,SourceAdmission:false,installed:false,realLogin:false};
fs.writeFileSync(path.join(work,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({work,pass:true,npmMembers:packed.files.length,sourcePins:contract.sourceFiles.length,NativeInputs:contract.NativeInputs}));
