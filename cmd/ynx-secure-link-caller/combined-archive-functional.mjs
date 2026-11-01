#!/usr/bin/env node
// Compile/run only this narrow functional probe. The parent owns production
// combined-main generation and archive builds. No archive merging, fallback
// runtime, signing/key generation, Root installer or production endpoint here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, mkdir, readFile, writeFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkArchiveDeployment } from '../ynx-secure-link-private-client/combined-archive-deployment.mjs';
import { linkRequiredSymbols } from '../ynx-secure-link-private-client/combined-archive-symbols.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const selectedNames = ['member.bin','message.bin','network.bin','owner.txt','purpose.txt','pk-a.bin','pk-b.bin','bad-sig-a.bin'];
const maximums = new Map([['member.bin',98304],['message.bin',65536],['network.bin',32],['owner.txt',128],['purpose.txt',64],['pk-a.bin',2592],['pk-b.bin',64],['bad-sig-a.bin',98304]]);
const sha = data => createHash('sha256').update(data).digest('hex');
function parseArgs() {
  const args = process.argv.slice(2); const out = {};
  for (let i=0;i<args.length;i+=2) {
    assert(['--inputs','--inputs-sha256','--out','--plan-only'].includes(args[i]) && args[i+1] && out[args[i]]===undefined,'exact probe arguments');
    out[args[i]]=args[i+1];
  }
  for (const name of ['--inputs','--inputs-sha256','--out']) assert(out[name],`required ${name}; absent inputs never Skip/PASS`);
  assert(/^[0-9a-f]{64}$/.test(out['--inputs-sha256']));
  assert(out['--plan-only']===undefined||out['--plan-only']==='true','plan-only is an explicit non-execution mode');
  return out;
}
async function pinned(record, maximum) {
  assert(record && path.isAbsolute(record.path) && Number.isSafeInteger(record.bytes) && record.bytes>0 && record.bytes<=maximum && /^[0-9a-f]{64}$/.test(record.sha256),'bounded pinned input record');
  const handle=await open(record.path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
  try {
    const before=await handle.stat(); assert(before.isFile() && before.size===record.bytes,'pinned input file/length');
    const data=await handle.readFile(); const after=await handle.stat();
    assert(before.dev===after.dev && before.ino===after.ino && before.size===after.size && before.mtimeMs===after.mtimeMs && sha(data)===record.sha256,'pinned input changed');
    return data;
  } finally { await handle.close(); }
}
function flags(values) {
  assert(Array.isArray(values) && values.length<=40,'bounded native link flags');
  for (let i=0;i<values.length;i++) {
    const value=values[i]; assert(typeof value==='string' && !value.includes('\0'));
    if (value==='-framework') { assert(/^[A-Za-z][A-Za-z0-9_]*$/.test(values[++i]),'framework name'); continue; }
    assert(['-lssl','-lcrypto','-lobjc','-lresolv','-lpthread','-lc++','-lbsm'].includes(value) || value.startsWith('-L') && path.isAbsolute(value.slice(2)), 'only native system libraries; no second Go archive/shared runtime');
  }
  return values;
}

function tool(command,args,maximum=8<<20) {
  const result=spawnSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:maximum});
  assert(!result.error&&result.status===0,`${command} read failed: ${result.error?.message??result.status}`);
  return result.stdout;
}
function macMinimum(file) {
  const raw=tool('/usr/bin/otool',['-l',file]);
  const matches=[...raw.matchAll(/cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform (\d+)\s+minos ([0-9.]+)\s+sdk ([0-9.]+)/g)];
  assert(matches.length===1&&matches[0][1]==='1','one actual macOS Mach-O build version');
  assert.equal(tool('/usr/bin/lipo',['-archs',file]).trim(),'arm64','actual arm64 input');
  return {minimumSystemVersion:matches[0][2],sdk:matches[0][3]};
}

// A narrow successor of the original functional control. This reuses the
// owner's recorded strong bundle link and already compiled objects; it is NOT
// a second normal source builder, portable component publisher, or N1 suite.
async function targetNodeABI(input,args,manifestBytes) {
  assert.equal(input.version,2);assert.equal(input.mode,'target-node-abi');
  assert(input.archive?.path.endsWith('.a')&&!input.archives&&!input.goArchives,'one successor Go archive');
  await pinned(input.archive,512<<20);
  assert(input.archiveMinimumSystemVersion==='13.0'||args['--plan-only']==='true'&&input.archiveMinimumSystemVersion==='NOT_VERIFIED_PLAN_ONLY','declared successor target is distinct from Node target; an old archive is read-only plan input');
  const handoff=JSON.parse(await pinned(input.authHandoff,1<<20));
  assert.equal(handoff.objectCount,53);assert.equal(handoff.translationUnits,52);assert.equal(handoff.minimumSystemVersion,'13.5 tag, exact target Node minimum');
  const objectManifest=JSON.parse(await pinned(handoff.objects,2<<20));
  assert.equal(objectManifest.count,53);assert.equal(objectManifest.codegenTarget,'arm64-apple-macosx13.5');
  assert(Array.isArray(objectManifest.objects)&&objectManifest.objects.length===53);
  const objects=objectManifest.objects.map(row=>row.object);
  assert.equal(new Set(objects.map(row=>row.path)).size,53);
  for(const row of objects){assert(row.path.endsWith('.o'));await pinned(row,128<<20);}
  const target=handoff.targetNode;
  assert(target.version==='v24.19.0'&&target.modules==='137'&&target.napi==='10'&&target.uv==='1.52.1','exact original Node target ABI');
  await pinned(target,256<<20);
  const targetMinimum=macMinimum(target.path);assert.equal(targetMinimum.minimumSystemVersion,'13.5');
  const libraries=handoff.runtimeLibraries.filter(row=>row.path.endsWith('.dylib'));
  assert.equal(libraries.length,3);
  const expectedLibraries=['libssl.3.dylib','libcrypto.3.dylib','libuv.1.dylib'];
  assert.deepEqual(libraries.map(row=>path.basename(row.path)).sort(),[...expectedLibraries].sort());
  const libraryMinimums=[];
  for(const row of libraries){await pinned(row,32<<20);const minimum=macMinimum(row.path);assert.equal(minimum.minimumSystemVersion,'13.0');libraryMinimums.push({name:path.basename(row.path),...minimum});}
  const receipt=JSON.parse(await pinned(handoff.actualBuildChain.strongLinkAndPortableStage,2<<20));
  const original=receipt.steps.find(row=>row.name==='actual-strong-link-cpp-explicit');
  assert(original?.status===0&&original.tool==='/usr/bin/swiftc'&&Array.isArray(original.argv),'original successful canonical strict link');
  const originalObjects=objectManifest.objects.map(row=>row.compiledObjectOriginal.path);
  const canonicalPrefix=['-emit-library','-target','arm64-apple-macosx13.5','-Xlinker','-bundle','-Xlinker','-bundle_loader','-Xlinker',target.path,'-o'];
  assert.deepEqual(original.argv.slice(0,10),canonicalPrefix);
  assert(original.argv[10].endsWith('.node'));
  assert.deepEqual(original.argv.slice(11,64),originalObjects,'all 53 original objects, without omission or recompilation');
  const originalArchive=original.argv[64];assert(originalArchive.endsWith('.a'));
  const canonicalSuffix=[...['Foundation','Security','IOKit','AppKit','ServiceManagement','LocalAuthentication'].flatMap(name=>['-framework',name]),'-lresolv','-Xlinker','-lbsm','-Xlinker','-lc++'];
  assert.equal(path.dirname(originalObjects[0]),path.dirname(receipt.plan.output));
  const originalSourceRoot=path.resolve(path.dirname(receipt.plan.output),'../../..');
  const originalLibraries=expectedLibraries.map(name=>path.join(originalSourceRoot,'packages/wallet-auth/native/vendor/runtime-inputs',name));
  assert.deepEqual(original.argv.slice(65),[...canonicalSuffix,...originalLibraries.flatMap(file=>['-Xlinker',file]),'-Xlinker','-undefined','-Xlinker','error'],'canonical complete link flags; no dynamic lookup or extra archive');
  const sourceMap=new Map();
  for(const row of objectManifest.objects){
    assert(Array.isArray(row.sourceInputs)&&row.sourceInputs.length>0&&row.sourceInputs.length<=8);
    for(const source of row.sourceInputs){
      const relative=path.relative(originalSourceRoot,source.path);
      assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'original object source under recorded root');
      const frozen={...source,path:path.join(handoff.sourceRoot,relative)};
      assert(!sourceMap.has(frozen.path)||sourceMap.get(frozen.path).sha256===frozen.sha256,'consistent source input pin');sourceMap.set(frozen.path,frozen);
    }
  }
  const sourceInputs=[...sourceMap.values()];for(const source of sourceInputs)await pinned(source,8<<20);
  const normalManifest=JSON.parse(await pinned(handoff.normalManifest,2<<20));
  const gateRows=normalManifest.files.filter(row=>row.path===normalManifest.strictGate);assert.equal(gateRows.length,1);
  const normalGatePin={...gateRows[0],path:path.join(handoff.sourceRoot,normalManifest.strictGate)};await pinned(normalGatePin,1<<20);
  let symbols=null;
  if(args['--plan-only']!=='true'){
    symbols=JSON.parse(await pinned(input.symbolResult,2<<20));
    assert.equal(symbols.status,'COMBINED_GO_ARCHIVE_STRONG_SYMBOLS_VERIFIED');assert.deepEqual(symbols.goArchives,[input.archive]);
    assert(Array.isArray(symbols.coreExports)&&symbols.coreExports.length===15&&new Set(symbols.coreExports).size===15&&symbols.coreExports.includes('YNXAccountMigrationPossessionSignV1'));
    assert.deepEqual([...symbols.linkExports].sort(),[...linkRequiredSymbols].sort());
    assert.equal(symbols.symbols.length,37);assert.deepEqual(symbols.symbols.map(row=>row.symbol).sort(),[...symbols.coreExports,...symbols.linkExports].sort());
    assert(symbols.runtimeEntry==='__rt0_arm64_darwin_lib','original single-runtime gate result');
    for(const row of symbols.headers)await pinned(row,1<<20);
  }
  assert(path.isAbsolute(args['--out']),'absolute external evidence directory');
  assert(!(await lstat(args['--out']).catch(error=>{if(error.code==='ENOENT')return null;throw error;})),'new output required');
  const out=path.resolve(args['--out']);await mkdir(out,{mode:0o700});
  const image=path.join(out,'original-auth-identity.node');
  const libraryDirectory=path.join(out,'original-auth-runtime-libs');
  const linkArgs=[...canonicalPrefix,image,...objects.map(row=>row.path),input.archive.path,...canonicalSuffix,...expectedLibraries.flatMap(name=>['-Xlinker',path.join(libraryDirectory,name)]),'-Xlinker','-rpath','-Xlinker','@loader_path/original-auth-runtime-libs','-Xlinker','-undefined','-Xlinker','error'];
  const plan={schema:'YNX_COMBINED_TARGET_NODE_ABI_PLAN/v1',archive:input.archive,archiveDeclaredMinimumSystemVersion:input.archiveMinimumSystemVersion,archiveObjectMinimumEvidence:args['--plan-only']==='true'?'NOT_RUN_PLAN_ONLY':'CHECK_REQUIRED_BEFORE_LINK',symbolResult:input.symbolResult??null,authHandoff:input.authHandoff,objects:handoff.objects,nativeObjectCount:53,recompiledObjects:0,canonicalRecipe:handoff.actualBuildChain.strongLinkAndPortableStage,sourceInputs,normalGate:normalGatePin,targetNode:target,targetMinimum,runtimeLibraries:libraries,runtimeLibraryMinimums:libraryMinimums,link:{command:original.tool,args:linkArgs},sourceRecompile:false,N1Executed:false,actualOS13Runtime:false,RootAdmission:false,SourceAdmission:false};
  await writeFile(path.join(out,'INPUTS.json'),manifestBytes,{flag:'wx',mode:0o600});
  await writeFile(path.join(out,'PLAN.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  if(args['--plan-only']==='true'){console.log(JSON.stringify({out,status:'PLAN_ONLY_NOT_RUN'}));return;}
  let deployment;
  try{deployment=checkArchiveDeployment(input.archive,{target:'13.0',architecture:'arm64'});}
  catch(error){if(error.report)await writeFile(path.join(out,'DEPLOYMENT-RESULT.json'),JSON.stringify(error.report,null,2)+'\n',{flag:'wx',mode:0o600});throw error;}
  await writeFile(path.join(out,'DEPLOYMENT-RESULT.json'),JSON.stringify(deployment,null,2)+'\n',{flag:'wx',mode:0o600});
  await mkdir(libraryDirectory,{mode:0o700});
  for(const row of libraries)await writeFile(path.join(libraryDirectory,path.basename(row.path)),await pinned(row,32<<20),{flag:'wx',mode:0o755});
  const linked=spawnSync(original.tool,linkArgs,{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  await writeFile(path.join(out,'link.stdout'),linked.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'link.stderr'),linked.stderr??'',{flag:'wx',mode:0o600});
  assert(!linked.error&&linked.status===0,`actual Node24 single-archive strict link failed: ${linked.error?.message??linked.status}`);
  const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',image],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
  await writeFile(path.join(out,'adhoc.stdout'),signed.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'adhoc.stderr'),signed.stderr??'',{flag:'wx',mode:0o600});
  assert(!signed.error&&signed.status===0,'QA adHoc image signing, never production signing');
  const minimum=macMinimum(image);assert.equal(minimum.minimumSystemVersion,'13.5');
  const imports=tool('/usr/bin/otool',['-L',image]);
  assert(!imports.includes('/opt/homebrew/'),'no old host Homebrew runtime imports');
  for(const name of expectedLibraries)assert(imports.includes('@rpath/'+name),'fixed staged runtime import');
  await writeFile(path.join(out,'image-imports.txt'),imports,{flag:'wx',mode:0o600});
  const imageBytes=await readFile(image);const imagePin={path:image,bytes:imageBytes.length,sha256:sha(imageBytes)};
  const normalGate=await import(pathToFileURL(normalGatePin.path).href);
  assert.deepEqual([...normalGate.goRequired,'YNXAccountMigrationPossessionSignV1'].sort(),[...symbols.coreExports,...symbols.linkExports].sort(),'existing normal gate covers original 36, plus exact migration successor');
  const commonImage=normalGate.check({version:1,image:imagePin,goArchives:[input.archive]});
  // Reuse Auth's normal 36-function/Native-owned gate; only the newly supplied
  // migration export needs an additive final-image readback here.
  const globals=tool('/usr/bin/nm',['-g',image],64<<20),attributes=tool('/usr/bin/nm',['-m',image],64<<20);
  const migration='_YNXAccountMigrationPossessionSignV1';
  const definitions=globals.split('\n').filter(line=>line.trim().split(/\s+/).at(-1)===migration);
  const migrationAttributes=attributes.split('\n').filter(line=>line.trim().split(/\s+/).at(-1)===migration);
  assert(definitions.length===1&&/^[a-f0-9]+\s+T\s+_/.test(definitions[0].trim())&&migrationAttributes.length===1&&!/\bweak\b|\bundefined\b/.test(migrationAttributes[0]),'strong migration callee in actual final image');
  const finalSymbols={schema:'YNX_COMBINED_FINAL_CORE15_LINK22/v1',image:imagePin,archiveSymbolResult:input.symbolResult,normalGate:normalGatePin,originalNormalResult:commonImage,symbols:[...symbols.coreExports,...symbols.linkExports].sort(),migrationStrong:true,singleRuntimeEvidence:symbols.runtimeEntry,RootAdmission:false,SourceAdmission:false};
  await writeFile(path.join(out,'SYMBOL-RESULT.json'),JSON.stringify(finalSymbols,null,2)+'\n',{flag:'wx',mode:0o600});
  // Original normal NAPI APIs exercise the real empty release-table refusal
  // and original partial owner drain. No Source acquisition, key or PQ call.
  const readback=`const assert=require('node:assert/strict');
(async()=>{assert.equal(process.version,'v24.19.0');assert.equal(process.versions.modules,'137');assert.equal(process.versions.napi,'10');assert.equal(process.versions.uv,'1.52.1');
const image=require(process.argv[2]);
for(const name of ['initializeOriginalWalletMainNamespaceV1','isOriginalWalletMainNamespaceOwnerV1','retireOriginalWalletMainNamespaceV1','joinOriginalWalletMainNamespaceV1','closeOriginalWalletMainNamespaceV1','openOriginalWalletMainNamespaceLoaderV1','acquireOriginalPaySource','isOriginalPaySource'])assert.equal(typeof image[name],'function',name);
let owner,cause;try{owner=image.initializeOriginalWalletMainNamespaceV1();}catch(error){owner=error.partial;cause=error;}
try{assert(owner);assert.equal(cause?.code,'PAY_NATIVE_CODE_ROOT_NOT_SUPPLIED');assert.equal(image.isOriginalWalletMainNamespaceOwnerV1(owner),true);assert.equal(image.isOriginalPaySource(owner),false);}
finally{if(owner){image.retireOriginalWalletMainNamespaceV1(owner);await image.joinOriginalWalletMainNamespaceV1(owner);await image.closeOriginalWalletMainNamespaceV1(owner);}}
console.log(JSON.stringify({targetNode:process.version,modules:process.versions.modules,napi:process.versions.napi,uv:process.versions.uv,normalExportsABI:true,rootEmptyReleasesRefused:true,originalPartialDrained:true,N1Executed:false,RootAdmission:false,SourceAdmission:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});\n`;
  const reader=path.join(out,'minimal-readback.cjs');await writeFile(reader,readback,{flag:'wx',mode:0o600});
  const executed=spawnSync(target.path,[reader,image],{encoding:'utf8',timeout:30000,maxBuffer:1<<20,env:{PATH:'/usr/bin:/bin'}});
  await writeFile(path.join(out,'run.stdout'),executed.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'run.stderr'),executed.stderr??'',{flag:'wx',mode:0o600});
  assert(!executed.error&&executed.status===0,`actual target Node24 ABI/lifecycle failed: ${executed.error?.message??executed.status}`);
  const result=JSON.parse(executed.stdout.trim());
  for(const field of ['normalExportsABI','rootEmptyReleasesRefused','originalPartialDrained'])assert.equal(result[field],true);
  assert.equal(result.N1Executed,false);assert.equal(result.RootAdmission,false);assert.equal(result.SourceAdmission,false);
  // Recheck every reused native/archive/runtime input after actual execution.
  for(const row of [input.archive,target,...objects,...libraries,input.authHandoff,handoff.objects,handoff.actualBuildChain.strongLinkAndPortableStage,handoff.normalManifest,normalGatePin,input.symbolResult,...symbols.headers,...sourceInputs])await pinned(row,row===target?256<<20:row===input.archive?512<<20:128<<20);
  await pinned(imagePin,128<<20);
  const report={...plan,schema:'YNX_COMBINED_TARGET_NODE_ABI/v1',archiveObjectMinimumEvidence:'ARCHIVE_DEPLOYMENT_TARGET_VERIFIED',archiveMaximumObservedMinimum:deployment.maximumObservedMinimum,finalStrongSymbolCount:finalSymbols.symbols.length,singleRuntimeEntry:symbols.runtimeEntry,strictLink:true,dynamicLookup:false,oneArchiveInput:true,linkExit:linked.status,adhocQA:true,productionSigning:false,runExit:executed.status,image:{...imagePin,...minimum},actualHostOS:tool('/usr/bin/sw_vers',['-productVersion']).trim(),actualOldOSRuntime:false,result,installed:false,deployed:false};
  await writeFile(path.join(out,'RESULT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({out,result}));
}

async function main() {
  const args=parseArgs(); const manifestBytes=await readFile(args['--inputs']);
  assert(manifestBytes.length<=1<<20 && sha(manifestBytes)===args['--inputs-sha256'],'probe manifest SHA');
  const input=JSON.parse(manifestBytes);
  if(input.mode==='target-node-abi'){await targetNodeABI(input,args,manifestBytes);return;}
  assert(input.version===1);assert(args['--plan-only']===undefined,'plan-only belongs to the explicit target-node-abi mode');
  // Exactly one independently built combined archive; native inputs are .o
  // only. Two .a files, a Go dylib, or a remote runtime cannot be hidden here.
  assert(input.archive?.path.endsWith('.a') && !input.archives && !input.goArchives,'one combined archive');
  await pinned(input.archive,512<<20);
  assert(Array.isArray(input.nativeObjects) && input.nativeObjects.length>0 && input.nativeObjects.length<=128,'actual native closure objects required');
  for (const object of input.nativeObjects) { assert(object.path.endsWith('.o'),'native inputs must be objects, never another Go runtime'); await pinned(object,128<<20); }
  assert(Array.isArray(input.headers) && input.headers.length>0 && input.headers.length<=256);
  for (const header of input.headers) await pinned(header,1<<20);
  const headerNames=new Set(input.headers.map(h=>path.basename(h.path)));
  for (const required of ['registered_n1_verify.h','private_client_v1.h','private_client_startup_v1.h']) assert(headerNames.has(required),`actual header ${required}`);
  assert(Array.isArray(input.includeDirs) && input.includeDirs.length<=32);
  for (const directory of input.includeDirs) assert(path.isAbsolute(directory) && (await stat(directory)).isDirectory(),'native include directory');
  assert(typeof input.rootProbe==='boolean');
  if (input.rootProbe) assert(headerNames.has('pay_root_main_code_private.hpp'),'real Native Root header required; NULL is not empty Root releases');
  assert(/^libnode\.\d+\.dylib$/.test(path.basename(input.nodeLibrary?.path??'')),'official C-native Node library required, not a second Go runtime');
  await pinned(input.nodeLibrary,256<<20);
  const nodeSymbols=spawnSync('nm',['-gU',input.nodeLibrary.path],{encoding:'utf8',timeout:30000,maxBuffer:64<<20});
  assert(!nodeSymbols.error&&nodeSymbols.status===0,'Node library symbol read');
  assert(!nodeSymbols.stdout.split('\n').some(line=>/\b_?(runtime\.|crosscall2\b|_cgoexp_|_rt0_)/.test(line)),'Node library contains a Go runtime marker');
  const nativeLibraries=input.nativeLibraries??[];
  assert(Array.isArray(nativeLibraries)&&nativeLibraries.length<=2);
  for (const library of nativeLibraries) {
    assert(/^libuv\.\d+(\.\d+)*\.dylib$/.test(path.basename(library.path)),'only the actual C-native libuv dependency');
    await pinned(library,32<<20);
    const symbols=spawnSync('nm',['-gU',library.path],{encoding:'utf8',timeout:30000,maxBuffer:4<<20});
    assert(!symbols.error&&symbols.status===0&&!symbols.stdout.split('\n').some(line=>/\b_?(runtime\.|crosscall2\b|_cgoexp_|_rt0_)/.test(line)),'libuv native symbol identity');
  }
  const binding=input.binding;
  for (const name of ['policyRevision','observedHeight','activeFrom']) assert(typeof binding?.[name]==='string' && /^(0|[1-9][0-9]{0,19})$/.test(binding[name]) && BigInt(binding[name])<=0xffffffffffffffffn,`exact PUBLIC scalar ${name}`);

  const publicManifest=await pinned(input.publicFixtureManifest,1<<20);
  const publicRows=JSON.parse(publicManifest); assert(Array.isArray(publicRows),'Core original PUBLIC-INPUTS manifest');
  const selected=[];
  for (const name of selectedNames) {
    const rows=publicRows.filter(r=>r.name===name); assert(rows.length===1,`one original public fixture ${name}`);
    const row={...rows[0],path:path.join(path.dirname(input.publicFixtureManifest.path),name)};
    const data=await pinned(row,maximums.get(name));selected.push({row,data});
  }
  assert(!(await lstat(args['--out']).catch(e=>{if(e.code==='ENOENT')return null;throw e;})),'new external output directory required');
  await mkdir(args['--out'],{mode:0o700}); const out=path.resolve(args['--out']);
  const publicDirectory=path.join(out,'public');await mkdir(publicDirectory,{mode:0o700});
  for (const {row,data} of selected) await writeFile(path.join(publicDirectory,row.name),data,{flag:'wx',mode:0o600});
  await writeFile(path.join(out,'INPUTS.json'),manifestBytes,{flag:'wx',mode:0o600});
  const executable=path.join(out,'combined-functional'); const source=path.join(here,'combined-archive-functional.cpp');
  const probeObject=path.join(out,'combined-functional.o');
  // Strict executable link: the official C++ Node library satisfies NAPI for
  // the COMPLETE original Native object set, including its normal entry TU.
  // There is no dynamic_lookup, omitted PQ.o, symbol stub, or second Go image.
  const command=['-std=c++17','-Wall','-Wextra','-Werror',...(input.rootProbe?['-DYNX_COMBINED_FUNCTIONAL_ROOT_PROBE=1']:[]),...input.includeDirs.flatMap(p=>['-I',p]),'-c',source,'-o',probeObject];
  const linkArgs=[probeObject,input.archive.path,...input.nativeObjects.map(o=>o.path),input.nodeLibrary.path,...nativeLibraries.map(l=>l.path),...flags(input.linkFlags),'-lc++','-o',executable];
  await writeFile(path.join(out,'compile-command.json'),JSON.stringify({compile:{command:'clang++',args:command},link:{command:'swiftc',args:linkArgs}},null,2)+'\n',{flag:'wx',mode:0o600});
  const built=spawnSync('clang++',command,{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  await writeFile(path.join(out,'compile.stdout'),built.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'compile.stderr'),built.stderr??'',{flag:'wx',mode:0o600});
  await writeFile(path.join(out,'node-library-symbol-check.json'),JSON.stringify({library:input.nodeLibrary,nmExit:nodeSymbols.status,GoRuntimeMarkers:[]},null,2)+'\n',{flag:'wx',mode:0o600});
  assert(!built.error && built.status===0,`combined functional C++ compile failed: ${built.error?.message??built.status}`);
  const linked=spawnSync('swiftc',linkArgs,{encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  await writeFile(path.join(out,'link.stdout'),linked.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'link.stderr'),linked.stderr??'',{flag:'wx',mode:0o600});
  assert(!linked.error&&linked.status===0,`actual single-runtime strict Swift link failed: ${linked.error?.message??linked.status}`);
  const executed=spawnSync(executable,[publicDirectory,binding.policyRevision,binding.observedHeight,binding.activeFrom],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
  await writeFile(path.join(out,'run.stdout'),executed.stdout??'',{flag:'wx',mode:0o600});await writeFile(path.join(out,'run.stderr'),executed.stderr??'',{flag:'wx',mode:0o600});
  assert(!executed.error && executed.status===0,`actual combined functional failed: ${executed.error?.message??executed.status}`);
  const result=JSON.parse(executed.stdout.trim());
  for (const name of ['coreValidN1','coreCorruptRejected','linkNullRefused','linkForeignPartialDrained']) assert.equal(result[name],true);
  assert.equal(result.RootAdmission,false);assert.equal(result.SourceAdmission,false);
  if (input.rootProbe) assert.equal(result.rootEmptyReleasesRefused,true);else assert.equal(result.rootScope,'NOT_RUN_NOT_LINKED');
  const report={schema:'YNX_COMBINED_ARCHIVE_FUNCTIONAL/v1',archive:input.archive,nodeLibrary:input.nodeLibrary,nativeLibraries,probeSource:{bytes:(await stat(source)).size,sha256:sha(await readFile(source))},functions:['YNXRegisteredANDMemberVerifyN1V1','ynx_link_pay_native_startup_open_v1',...(input.rootProbe?['acquire_original_pay_main_code_root']:[])],publicFixtureSHA256:input.publicFixtureManifest.sha256,publicFixtureProvenance:'localSynthetic publicprobe; official per-file binding NOT_SUPPLIED',singleGoArchive:true,strictLink:true,dynamicLookup:false,compileExit:built.status,linkExit:linked.status,runExit:executed.status,result,RootAdmission:false,SourceAdmission:false,deployed:false};
  await writeFile(path.join(out,'RESULT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({out,result}));
}
main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1;});
