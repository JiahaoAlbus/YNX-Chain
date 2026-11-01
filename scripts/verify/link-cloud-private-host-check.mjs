#!/usr/bin/env node
// Actual LINK Unix -> frozen original Cloud host integration only. Neither
// supplier tree is modified. No normal daemon, CI, GUI or public listener starts.
import {constants} from 'node:fs';
import {open, mkdir, readFile, realpath, writeFile, copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const fixedH = {bytes:4889, sha256:'89b5f3ff683879d74be1d5155895d4f4450c0b62d496536c2cd0c1969c14a837'};
const fixedSource = {bytes:15555, sha256:'323eb9dd95b7dbcd45689ac1fe681fcb545d2cfcd6739c7762116c43dc677111'};
// P04's actual normal consumer already compiled these original Auth/Core
// dependencies. Its historical Cloud rows are NOT substituted for the newer
// complete Cloud SOURCE above. No package API is reconstructed by this runner.
const dependencyHandoff='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P04/private-host-normal-dependencies-r1/LINK_SOURCE_CLOSURE_HANDOFF.json';
const fixedDependencyHandoff={bytes:3548,sha256:'5a8f8a76bda01ac983660b28fb06adc266ff9739d4792bf5f8c7aa5f6b128e85'};
const fixedDependencies = {bytes:14815,sha256:'ebf2fc43fb9b6eed0f61c6b5bcd974020a5c7296049be4b982da4dda8ffd9c9e'};
const sha = data => createHash('sha256').update(data).digest('hex');
const requireValue = (condition, code) => {if(!condition) throw Error(code);};
const pin = async path => {const b=await readFile(path);return {bytes:b.length,sha256:sha(b)};};
const equal = (a,b) => a.bytes===b.bytes && a.sha256===b.sha256;
const inside = (a,b) => {const r=relative(a,b);return r==='' || r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
const args=process.argv.slice(2);
requireValue(args.length===2 || args.length===3&&['--execute','--compile-only'].includes(args[2]), 'HANDOFF_JSON FRESH_OUTPUT [--execute|--compile-only] required');
const hPath=await realpath(args[0]);
requireValue(equal(await pin(hPath),fixedH),'original_Cloud_handoff_pin_mismatch');
const h=JSON.parse(await readFile(hPath,'utf8'));
const sourcePath=await realpath(h.source.path);
requireValue(equal(await pin(sourcePath),fixedSource),'original_Cloud_source_manifest_pin_mismatch');
const source=JSON.parse(await readFile(sourcePath,'utf8'));
const frozen=await realpath(h.frozenRoot);
const requested=resolve(args[1]);
const out=join(await realpath(dirname(requested)), requested.split('/').at(-1));
requireValue(!inside(root,out)&&!inside(out,root)&&!inside(frozen,out)&&!inside(out,frozen),'output_overlaps_supplier');
const cloudFiles=[],seen=new Set();
for(const row of source.files){
  requireValue(typeof row.relative==='string' && !isAbsolute(row.relative) && !row.relative.split('/').includes('..')&&!seen.has(row.relative),'invalid_source_manifest_path');
  seen.add(row.relative);
  const p=join(frozen,row.relative);
  requireValue(equal(await pin(p),row),'frozen_source_leaf_pin_mismatch');
  if(/^internal\/cloud\/[^/]+\.go$/.test(row.relative)) {
    cloudFiles.push({...row,frozenPath:p});
  }
}
requireValue(cloudFiles.length===h.completeCloudGoLeaves&&cloudFiles.length===81,'incomplete_original_cloud_package');
requireValue(equal(await pin(dependencyHandoff),fixedDependencyHandoff),'normal_dependency_handoff_pin_mismatch');
const dependencyH=JSON.parse(await readFile(dependencyHandoff,'utf8'));
const dependencyManifest=dependencyH.sourceManifest.path;
requireValue(equal(await pin(dependencyManifest),fixedDependencies),'normal_dependency_manifest_pin_mismatch');
const dependencyData=JSON.parse(await readFile(dependencyManifest,'utf8'));
const dependencyPackages=['internal/developerauthority','internal/ynxbatch','internal/accountaddress'];
const dependencies=[];
for(const row of dependencyData.files)requireValue(equal(await pin(join(dependencyH.sourceRoot,row.relative)),row),'normal_closure_leaf_pin_mismatch');
requireValue(dependencyData.files.length===60,'normal_closure_incomplete');
requireValue(equal(await pin(dependencyH.moduleDelta.path),dependencyH.moduleDelta),'original_module_delta_pin_mismatch');
const delta=JSON.parse(await readFile(dependencyH.moduleDelta.path,'utf8'));
requireValue(delta.addedRequire==='ynx.local/auth/binary-http-source v0.0.0'&&delta.addedReplace==='ynx.local/auth/binary-http-source => ./packages/auth-binary-http/go','normal_module_delta_mismatch');
for(const pkg of dependencyPackages) {
  const rows=dependencyData.files.filter(row=>row.relative.startsWith(pkg+'/'));
  requireValue(rows.length>0,'normal_dependency_package_not_supplied');
  const originalRoot=dependencyH.sourceRoot,registered=new Set();
  for(const row of rows) {
    requireValue(!row.relative.split('/').includes('..')&&!registered.has(row.relative),'invalid_normal_dependency_path');
    registered.add(row.relative);
    const p=join(originalRoot,row.relative);
    requireValue(equal(await pin(p),row),'normal_dependency_leaf_pin_mismatch');
    dependencies.push({...row,frozenPath:p});
  }
}
const template=join(root,'scripts/verify/link-cloud-private-host.integration.go.txt');
const templatePin=await pin(template);
const git = (...a) => {
  const r=spawnSync('git',['-C',root,...a],{encoding:'utf8',timeout:5000});
  requireValue(r.status===0,'git_source_identity_failed');return r.stdout.trim();
};
const sourceHead=git('rev-parse','HEAD');
requireValue(/^[0-9a-f]{40}$/.test(sourceHead),'invalid_source_head');
const native={};
for(const [key,arguments_] of [['version',['--modversion','openssl']],['libdir',['--variable=libdir','openssl']],['includedir',['--variable=includedir','openssl']]]) {
  const r=spawnSync('pkg-config',arguments_,{encoding:'utf8',timeout:5000});
  requireValue(r.status===0,'original_native_pkg_config_unavailable');native[key]=r.stdout.trim();
}
requireValue(native.version==='3.6.4','original_native_OpenSSL_version_mismatch');
native.inputs=[];
for(const path of [join(native.libdir,'libssl.3.dylib'),join(native.libdir,'libcrypto.3.dylib'),join(native.includedir,'openssl/opensslv.h')]) {
  const resolved=await realpath(path);native.inputs.push({path:resolved,...await pin(resolved)});
}
await mkdir(out,{mode:0o700});
await mkdir(join(out,'go-tmp'),{mode:0o700});
await mkdir(join(out,'public-state'),{mode:0o700});
const binaryRows=dependencyData.files.filter(row=>row.relative.startsWith('packages/auth-binary-http/go/'));
requireValue(binaryRows.length===11,'normal_binary_module_incomplete');
const originalMod=await readFile(join(root,'go.mod'),'utf8');
requireValue(!originalMod.includes('ynx.local/auth/binary-http-source'),'root_module_delta_already_declared');
const tracked=git('ls-files','--cached','--others','--exclude-standard','internal/securelink','go.mod','go.sum').split('\n').filter(Boolean);
const before=[];
for(const name of tracked)before.push({path:name,...await pin(join(root,name))});
// The new runner and template are source even before this module is committed.
for(const name of ['scripts/verify/link-cloud-private-host-check.mjs','scripts/verify/link-cloud-private-host.integration.go.txt'])before.push({path:name,...await pin(join(root,name))});
// Go's vet subprocess requires a real package working directory. An overlay
// cannot provide that for packages absent from this checkout. Materialize this
// exact scoped source composition in the external run rather than suppressing
// vet or creating directories in an owning supplier checkout.
const physical=join(out,'physical-module');await mkdir(physical,{mode:0o700});
const physicalPins=[];
async function install(relativeName, from) {
  const to=join(physical,relativeName);await mkdir(dirname(to),{recursive:true,mode:0o700});
  await copyFile(from,to);physicalPins.push({path:relativeName,...await pin(to)});
}
for(const row of before)if(row.path.startsWith('internal/securelink/'))await install(row.path,join(root,row.path));
for(const row of cloudFiles)await install(row.relative,row.frozenPath);
for(const row of dependencies)await install(row.relative,row.frozenPath);
for(const row of binaryRows)await install(row.relative,join(dependencyH.sourceRoot,row.relative));
await install('internal/securelink/link_cloud_private_host_integration_test.go',template);
// Only these original module descriptors are required by the unchanged root
// replacement declaration; this test imports no Comet package or substitutes
// any consensus implementation. Missing future imports fail closed.
for(const name of ['go.mod','go.sum'])await install('third_party/cometbft/'+name,join(root,'third_party/cometbft',name));
const physicalMod=originalMod+'\nrequire '+delta.addedRequire+'\nreplace '+delta.addedReplace+'\n';
await writeFile(join(physical,'go.mod'),physicalMod,{flag:'wx',mode:0o600});
await copyFile(join(root,'go.sum'),join(physical,'go.sum'));
physicalPins.push({path:'go.mod',...await pin(join(physical,'go.mod'))},{path:'go.sum',...await pin(join(physical,'go.sum'))});
const requiredTest='TestLINKCloudOriginalHostUnixLifecycleAndColdGeneration';
const compileOnly=args[2]==='--compile-only';
const command=['test','-mod=readonly','-p','1','-race','-tags=link_cloud_host_integration,securelink_openssl','./internal/securelink','-run',compileOnly?'^$':'^'+requiredTest+'$','-count=1','-v','-json','-timeout=60s'];
const result={schema:'YNX-LINK-CLOUD-ORIGINAL-HOST-INTEGRATION/v1',sourceHead,sourceDirtyAtStart:git('status','--porcelain'),
  originalCloud:{handoff:hPath,...fixedH,manifest:sourcePath,manifestPin:fixedSource,frozenRoot:frozen,cloudFiles},
  originalNormalDependencies:{handoff:dependencyHandoff,handoffPin:fixedDependencyHandoff,manifest:dependencyManifest,...fixedDependencies,packages:dependencyPackages,files:dependencies,binaryRows,moduleDelta:dependencyH.moduleDelta,relativeInstalledBinary:'./packages/auth-binary-http/go'},
  template:{path:template,...templatePin},sourcePins:before,physicalModule:physical,physicalPins,compileOnly,requiredTest,command:['/opt/homebrew/bin/go',...command],
  stage:'PREPARED_ONLY',normalDaemonStarted:false,publicListener:false,RootAdmission:false,fundsMoved:false,
  TLSProfileChanged:false,native,transport:'actual bounded private UDS in original securelink_openssl+cgo build; no new TLS handshake claim for this local leg',
  priorEvidenceReused:['640c67e original caller/current lifecycle','original Cloud normal4 and related8','6064 carrier function'],
  repeatedPriorSuites:false};
await writeFile(join(out,'INPUT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
if(!args[2]) {process.stdout.write(JSON.stringify({stage:result.stage,out})+'\n');process.exit(0);}
// Redirect child output directly to retained files; no private body or key
// material is requested by this integration. No output is silently truncated.
const stdout=await open(join(out,'go-test.jsonl'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
const stderr=await open(join(out,'go-test.stderr.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
let run;
try {
  run=spawnSync('/opt/homebrew/bin/go',command,{cwd:physical,env:{...process.env,GOMAXPROCS:'2',CGO_ENABLED:'1',GOWORK:'off',GOPROXY:'off',GOTMPDIR:join(out,'go-tmp'),YNX_LINK_CLOUD_HOST_ARTIFACT_ROOT:join(out,'public-state')},
    stdio:['ignore',stdout.fd,stderr.fd],timeout:150000,killSignal:'SIGTERM'});
} finally {await stdout.close();await stderr.close();}
result.exitCode=run.status;result.signal=run.signal;result.error=run.error?.code??null;
result.sourceUnchanged=true;
for(const row of before)if(!equal(await pin(join(root,row.path)),row))result.sourceUnchanged=false;
for(const row of cloudFiles)if(!equal(await pin(row.frozenPath),row))result.sourceUnchanged=false;
for(const row of dependencies)if(!equal(await pin(row.frozenPath),row))result.sourceUnchanged=false;
for(const row of dependencyData.files)if(!equal(await pin(join(dependencyH.sourceRoot,row.relative)),row))result.sourceUnchanged=false;
for(const row of native.inputs)if(!equal(await pin(row.path),row))result.sourceUnchanged=false;
for(const row of physicalPins)if(!equal(await pin(join(physical,row.path)),row))result.sourceUnchanged=false;
requireValue(equal(await pin(hPath),fixedH)&&equal(await pin(sourcePath),fixedSource),'supplier_manifest_changed');
const events=[];
result.malformedGoEventLines=0;
for(const line of (await readFile(join(out,'go-test.jsonl'),'utf8')).split('\n').filter(Boolean)) {
  try {events.push(JSON.parse(line));} catch {result.malformedGoEventLines++;}
}
const passed=events.filter(e=>e.Action==='pass'&&e.Test?.startsWith('TestLINKCloudOriginalHostUnix')).map(e=>({name:e.Test,seconds:e.Elapsed}));
const failed=events.filter(e=>['fail','skip'].includes(e.Action));
result.passed=passed;result.failOrSkipEvents=failed;
result.buildFailureEvents=events.filter(e=>e.Action==='build-fail');
const valid=run.status===0&&result.sourceUnchanged&&failed.length===0&&result.buildFailureEvents.length===0&&result.malformedGoEventLines===0;
result.stage=valid&&(compileOnly||passed.some(p=>p.name===requiredTest))?(compileOnly?'NATIVE_COMPILE_VET_PASS_NO_FUNCTION_EXECUTION':'ACTUAL_UNIX_HOST_INTEGRATION_PASS'):'NOT_QUALIFIED';
result.actualBusinessSourceQualified=false;result.deployed=false;
result.logs=[];
for(const name of ['go-test.jsonl','go-test.stderr.log'])result.logs.push({path:join(out,name),...await pin(join(out,name))});
await writeFile(join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({stage:result.stage,out,exitCode:run.status,signal:run.signal,sourceUnchanged:result.sourceUnchanged,passed})+'\n');
process.exitCode=result.stage==='NOT_QUALIFIED'?1:0;
