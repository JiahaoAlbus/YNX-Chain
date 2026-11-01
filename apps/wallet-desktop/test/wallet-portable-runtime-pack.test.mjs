import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import data from '../scripts/canonical-native-portable-qa-profile-data.json' with {type:'json'};
import {PORTABLE_QA_ROLE,PORTABLE_QA_INPUT_NAMES} from '../scripts/canonical-native-portable-qa-profile.mjs';
import {COMMON_QA_INPUT_NAMES} from '../scripts/canonical-native-qa-profile.mjs';
import {createPortablePackageAssetReader,portableRuntimeAssets,verifyPortableRuntimeFiles,verifyPortableRuntimePackage,beginNativeRuntimeRelocation,preservePortableNestedSignatures,PORTABLE_NESTED_SIGN_IGNORE,recoverFailedNativePackage,NativePackageRecoveryError} from '../scripts/portable-runtime-pack.mjs';
import {matchedCustodyPackagedNativeSources} from '../scripts/release-provenance.mjs';
import {writeCanonicalArchiveInputs} from '../scripts/release-provenance.mjs';
import {canonicalArchivePlan,SDK_ALIAS,NATIVE_CANONICAL,CANONICAL_MAIN} from '../scripts/canonical-package.mjs';
import {Readable} from 'node:stream';
const root=fileURLToPath(new URL('../../../',import.meta.url)),pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const licenses=[...new Map(data.runtimeManifest.libraries.flatMap(x=>x.licenses).map(x=>[x.name,x.input])).entries()];
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-portable-pack-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bodies=new Map(),base='apps/wallet-desktop/native/';
 const output={relative:base+'original-auth-identity.node',...pin(Buffer.from('PUBLIC NOT EXECUTED NODE'))};bodies.set(output.relative,Buffer.from('PUBLIC NOT EXECUTED NODE'));
 const libraryOutputs=data.runtimeManifest.libraries.map(x=>{const relative=base+'original-auth-runtime-libs/'+x.name,b=Buffer.from('PUBLIC NOT EXECUTED '+x.name);bodies.set(relative,b);return{relative,...pin(b)};});
 const licenseOutputs=licenses.map(([name,p])=>{const relative=base+'original-auth-runtime-libs/'+name;bodies.set(relative,fs.readFileSync(path.join(root,p.path)));return{relative,bytes:p.bytes,sha256:p.sha256};});
 const record={normalPortableImageRole:{kind:PORTABLE_QA_ROLE},output,portableRuntime:{libraryOutputs,licenseOutputs}};
 const raw=path.join(dir,'app.asar.unpacked');fs.mkdirSync(raw);
 for(const row of portableRuntimeAssets(record)){const p=path.join(raw,row.unpackedRelative);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bodies.get(row.sourceRelative));}
 return {dir,raw,record,bodies};
}
test('portable selection requires all 266 actual inputs and preserves legacy selection',()=>{
 const c={normalCommonImage:true,portableRuntime:true,sourceBytesVerified:true};
 assert.equal(PORTABLE_QA_INPUT_NAMES.length,266);
 assert.deepEqual(matchedCustodyPackagedNativeSources(null,c,PORTABLE_QA_INPUT_NAMES),PORTABLE_QA_INPUT_NAMES);
 for(const available of [COMMON_QA_INPUT_NAMES,PORTABLE_QA_INPUT_NAMES.slice(1)])assert.throws(()=>matchedCustodyPackagedNativeSources(null,c,available),/PORTABLE_QA_GIT_SOURCE_MISSING/);
 assert.throws(()=>matchedCustodyPackagedNativeSources(null,{...c,sourceBytesVerified:false},PORTABLE_QA_INPUT_NAMES),/PORTABLE_QA_GIT_SOURCE_MISSING/);
 assert.deepEqual(matchedCustodyPackagedNativeSources(null,{normalCommonImage:true,sourceBytesVerified:true},COMMON_QA_INPUT_NAMES),COMMON_QA_INPUT_NAMES);
});
test('nine real unpacked files relocate together, retain byte pins, and roll back together',t=>{
 const f=fixture(t);assert.equal(verifyPortableRuntimeFiles(f.record,f.raw).assetsVerified,9);
 const tx=beginNativeRuntimeRelocation(f.record,f.raw);assert.equal(tx.files,9);
 assert.equal(verifyPortableRuntimeFiles(f.record,f.raw,{canonical:true}).assetsVerified,9);
 for(const row of portableRuntimeAssets(f.record))assert.equal(fs.existsSync(path.join(f.raw,row.unpackedRelative)),false);
 tx.rollback();assert.equal(verifyPortableRuntimeFiles(f.record,f.raw).assetsVerified,9);tx.rollback();
});
test('archive rollback failure still restores all native files and retains recovery files and falsy first cause',t=>{
 const f=fixture(t),tx=beginNativeRuntimeRelocation(f.record,f.raw),recoveryDir=path.join(f.dir,'recovery');fs.mkdirSync(recoveryDir);const backup=path.join(recoveryDir,'original.asar');fs.writeFileSync(backup,'PUBLIC ORIGINAL ARCHIVE');
 const archiveError=Error('CONTROLLED_ARCHIVE_RESTORE_FAILURE'),result=recoverFailedNativePackage(false,recoveryDir,()=>{throw archiveError;},()=>tx.rollback());
 assert.equal(result.retainTemporary,true);assert.ok(result.error instanceof NativePackageRecoveryError);assert.equal(result.error.cause,false);assert.deepEqual(result.error.errors,[false,archiveError]);assert.equal(result.error.recoveryDirectory,recoveryDir);assert.equal(fs.readFileSync(backup,'utf8'),'PUBLIC ORIGINAL ARCHIVE');assert.equal(verifyPortableRuntimeFiles(f.record,f.raw).assetsVerified,9);
 const success=recoverFailedNativePackage(null,recoveryDir,()=>{},()=>{});assert.equal(success.retainTemporary,false);assert.equal(success.error,null);
 const partial=new NativePackageRecoveryError([false,null],'PUBLIC PARTIAL MOVE');assert.equal(recoverFailedNativePackage(partial,recoveryDir,()=>{},()=>{}).retainTemporary,true);
});
test('actual ASAR writer preserves all nine unpacked flags and library distance through canonical assembly',async t=>{
 const f=fixture(t),require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),archive=path.join(f.dir,'input.asar'),output=path.join(f.dir,'canonical.asar'),metadataInput=Buffer.from(JSON.stringify({name:'PUBLIC-portable-pack',version:'0.0.0',main:CANONICAL_MAIN}));
 const files=[['package.json',metadataInput,false],[SDK_ALIAS+'/package.json',Buffer.from('{"name":"@ynx-chain/wallet-auth"}'),false],[SDK_ALIAS+'/src/index.js',Buffer.from('export const PUBLIC_ONLY=true;'),false],...portableRuntimeAssets(f.record).map(x=>[x.unpackedRelative,f.bodies.get(x.sourceRelative),true])];
 const dirs=new Set();for(const [name] of files){let d=path.posix.dirname(name);while(d!=='.'){dirs.add(d);d=path.posix.dirname(d);}}
 await asar.createPackageFromStreams(archive,[...[...dirs].sort().map(p=>({path:p,type:'directory',unpacked:false})),...files.map(([p,b,unpacked])=>({path:p,type:'file',unpacked,stat:{mode:0o644,size:b.length},streamGenerator:()=>Readable.from([b])}))]);
 const before=asar.listPackage(archive).map(p=>{const name=p.replace(/^\//,''),s=asar.statFile(archive,name,false);return s.files?{path:name,type:'directory',unpacked:!!s.unpacked}:s.link?{path:name,type:'link',link:s.link,unpacked:!!s.unpacked}:{path:name,type:'file',unpacked:!!s.unpacked,executable:!!s.executable,...pin(asar.extractFile(archive,name,false))};});
 const dependencies={rows:[],contents:new Map()},evidence={rows:[],contents:new Map()},canonical=canonicalArchivePlan(before,metadataInput);
 await writeCanonicalArchiveInputs({asar,archive,output,before,metadataInput,dependencies,evidence,canonical});
 assert.equal(asar.statFile(output,NATIVE_CANONICAL,false).unpacked,true);
 for(const row of portableRuntimeAssets(f.record)){const p='code/apps/wallet-desktop/'+row.unpackedRelative;assert.equal(asar.statFile(output,p,false).unpacked,true);assert.deepEqual(asar.extractFile(output,p,false),f.bodies.get(row.sourceRelative));}
});
test('missing, mutated and linked libraries refuse before relocating any original',t=>{
 const f=fixture(t),row=portableRuntimeAssets(f.record)[1],p=path.join(f.raw,row.unpackedRelative),bytes=fs.readFileSync(p);
 fs.appendFileSync(p,'MUTATED');assert.throws(()=>beginNativeRuntimeRelocation(f.record,f.raw),/SOURCE_PIN_DIFFERS/);fs.writeFileSync(p,bytes);
 fs.unlinkSync(p);assert.throws(()=>beginNativeRuntimeRelocation(f.record,f.raw),/ENOENT/);
 const external=path.join(f.dir,'external');fs.writeFileSync(external,bytes);fs.symlinkSync(external,p);
 assert.throws(()=>beginNativeRuntimeRelocation(f.record,f.raw),/REGULAR_FILE_REQUIRED/);
 assert.equal(fs.existsSync(path.join(f.raw,'native/original-auth-identity.node')),true);
});
test('linked directories and even dangling destination links are refused without overwriting',t=>{
 const f=fixture(t),dir=path.join(f.raw,'native/original-auth-runtime-libs'),outside=path.join(f.dir,'libraries');
 fs.renameSync(dir,outside);fs.symlinkSync(outside,dir);assert.throws(()=>beginNativeRuntimeRelocation(f.record,f.raw),/REGULAR_FILE_REQUIRED/);fs.unlinkSync(dir);fs.renameSync(outside,dir);
 const dest=path.join(f.raw,'code/apps/wallet-desktop/native/original-auth-identity.node');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.symlinkSync('/PUBLIC/ABSENT',dest);
 assert.throws(()=>beginNativeRuntimeRelocation(f.record,f.raw),/DESTINATION_EXISTS/);assert.equal(fs.lstatSync(dest).isSymbolicLink(),true);
});
test('post outer-sign check reads both actual canonical layouts and detects changed nested bytes',t=>{
 const f=fixture(t),project=path.join(f.dir,'project');fs.mkdirSync(path.join(project,'native'),{recursive:true});fs.writeFileSync(path.join(project,'native/original-auth-identity-build.json'),JSON.stringify(f.record));beginNativeRuntimeRelocation(f.record,f.raw);
 assert.equal(verifyPortableRuntimePackage(f.dir,project).assetsVerified,9);
 fs.renameSync(f.raw,path.join(f.dir,'app.code'));fs.writeFileSync(path.join(f.dir,'ynx-wallet-physical-code-layout.json'),'PUBLIC LAYOUT MARKER');assert.equal(verifyPortableRuntimePackage(f.dir,project).assetsVerified,9);
 const p=path.join(f.dir,'app.code/code/apps/wallet-desktop/native/original-auth-runtime-libs/libuv.1.dylib');fs.appendFileSync(p,'SIGNING REWRITE');assert.throws(()=>verifyPortableRuntimePackage(f.dir,project),/SOURCE_PIN_DIFFERS/);
});
test('normal pack filters include and unpack the exact nine assets, excluding foreign libraries',t=>{
 const f=fixture(t),metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),require=createRequire(new URL('../package.json',import.meta.url)),{FileMatcher}=require('app-builder-lib/out/fileMatcher');
 const selected=new FileMatcher('/PUBLIC/project','/PUBLIC/output',x=>x,metadata.build.files).createFilter();
 const unpacked=new FileMatcher('/PUBLIC/project','/PUBLIC/output',x=>x,metadata.build.asarUnpack).createFilter();
 for(const row of portableRuntimeAssets(f.record)){const name='/PUBLIC/project/'+row.unpackedRelative;assert.equal(selected(name,{isDirectory:()=>false}),true,name);assert.equal(unpacked(name,{isDirectory:()=>false}),true,name);}
 const foreign='/PUBLIC/project/native/original-auth-runtime-libs/foreign.dylib';assert.equal(selected(foreign,{isDirectory:()=>false}),false);assert.equal(unpacked(foreign,{isDirectory:()=>false}),false);
});
test('actual builder keeps SDK dependencies packed when SDK source DATA contains vendor dylibs',async t=>{
 const f=fixture(t),require=createRequire(new URL('../package.json',import.meta.url)),{AsarPackager}=require('app-builder-lib/out/asar/asarUtil'),{FileMatcher}=require('app-builder-lib/out/fileMatcher'),metadata=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),input=path.join(f.dir,'input'),destination=path.join(f.dir,'stage'),moduleRoot='node_modules/@ynx-chain/wallet-auth';
 const names=[moduleRoot+'/native/vendor/runtime-inputs/libssl.3.dylib',moduleRoot+'/node_modules/@noble/curves/LICENSE','native/original-auth-identity.node','native/original-auth-runtime-libs/libssl.3.dylib'];
 const files=[],stats=new Map();for(const name of names){const file=path.join(input,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'PUBLIC DATA NEVER LOADED');const stat=fs.statSync(file);if(name.startsWith(moduleRoot+'/'))Object.assign(stat,{moduleRootPath:moduleRoot,moduleName:'@ynx-chain/wallet-auth',moduleFullFilePath:name});files.push(file);stats.set(file,stat);}
 const fileSet={src:input,destination,files,metadata:stats},packager={info:{getWorkspaceRoot:async()=>f.dir}},unpackPattern=new FileMatcher(input,destination,x=>x,metadata.build.asarUnpack).createFilter();
 const process=options=>new AsarPackager(packager,{resourcePath:f.dir,defaultDestination:destination,options,unpackPattern}).processFileSets([fileSet]);
 const automatic=await process({smartUnpack:true});assert.equal(automatic.find(x=>x.path===names[1]).unpacked,true,'real default builder reproduces the SDK dependency conflict');
 const actual=await process(metadata.build.asar);assert.equal(actual.find(x=>x.path===names[0]).unpacked,false);assert.equal(actual.find(x=>x.path===names[1]).unpacked,false);assert.equal(actual.find(x=>x.path===names[2]).unpacked,true);assert.equal(actual.find(x=>x.path===names[3]).unpacked,true);
});
test('actual Electron builder preserves exactly four nested signatures for only the portable role',async t=>{
 const f=fixture(t),options={signIgnore:['EXISTING']};preservePortableNestedSignatures({},options);assert.deepEqual(options.signIgnore,['EXISTING']);preservePortableNestedSignatures(f.record,options);preservePortableNestedSignatures(f.record,options);assert.deepEqual(options.signIgnore,['EXISTING',PORTABLE_NESTED_SIGN_IGNORE]);
 const require=createRequire(new URL('../package.json',import.meta.url)),{MacTargetHelper}=require('app-builder-lib/out/mac/MacTargetHelper');
 // Use the installed normal builder's real sign-option reader, with no signer
 // or certificate invocation. PUBLIC fixture binaries are never executed.
 const actual=await MacTargetHelper.prototype.buildSignOptions.call({packager:{config:{electronVersion:'42.10.0'}},getOptionsForFile:async()=>()=>({})},'/PUBLIC/App.app',null,'development',false,options,null,3);
 for(const layout of ['app.asar.unpacked','app.code'])for(const row of portableRuntimeAssets(f.record))assert.equal(actual.ignore('/PUBLIC/App.app/Contents/Resources/'+layout+'/code/apps/wallet-desktop/'+row.unpackedRelative),/\.(?:node|dylib)$/.test(row.unpackedRelative));
 assert.equal(actual.ignore('/PUBLIC/App.app/Contents/Resources/app.code/code/apps/wallet-desktop/native/foreign.node'),false);
});

test('portable package reader separates fixed generated outputs from Git operands',t=>{
 const f=fixture(t);beginNativeRuntimeRelocation(f.record,f.raw);
 const calls=[],source=relative=>{calls.push(relative);if(relative==='SOURCE')return Buffer.from('PUBLIC SOURCE');throw Error('GIT_OPERAND_ABSENT');};
 const read=createPortablePackageAssetReader(f.record,source,f.raw);
 for(const row of portableRuntimeAssets(f.record))assert.deepEqual(read(row.sourceRelative),f.bodies.get(row.sourceRelative));
 assert.deepEqual(calls,[]);assert.equal(read('SOURCE').toString(),'PUBLIC SOURCE');assert.throws(()=>read('apps/wallet-desktop/native/foreign.dylib'),/GIT_OPERAND_ABSENT/);
 const row=portableRuntimeAssets(f.record)[1],file=path.join(f.raw,'code/apps/wallet-desktop',row.unpackedRelative);fs.writeFileSync(file,'TAMPERED');
 assert.throws(()=>createPortablePackageAssetReader(f.record,source,f.raw));
 assert.deepEqual(read(row.sourceRelative),f.bodies.get(row.sourceRelative));
 fs.rmSync(file);fs.symlinkSync(path.join(f.dir,'missing'),file);assert.throws(()=>createPortablePackageAssetReader(f.record,source,f.raw),/REGULAR_FILE/);
 assert.equal(createPortablePackageAssetReader(null,source,f.raw),source);
});
