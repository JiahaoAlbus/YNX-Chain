// Actual qualified component bytes only; never loads or executes Native.
// Mandatory input is explicitly supplied by the normal component handoff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {stageDesktopC6ApprovedHelper} from '../desktop-native49-c6-helper.mjs';
import {createHash} from 'node:crypto';
import {stageDesktopNative49C6Input,desktopNative49C6StageRoot,desktopNative49C6Selection as selected,verifyDesktopNative49C6Input,verifyDesktopNative49C6ASAR,verifyDesktopNative49C6Runtime} from '../desktop-native49-c6-pack.mjs';
import {beginNativeRuntimeRelocation} from '../portable-runtime-pack.mjs';
import {writeCanonicalArchiveInputs} from '../release-provenance.mjs';
import {canonicalArchivePlan,SDK_ALIAS,CANONICAL_MAIN} from '../canonical-package.mjs';
const input=process.env.YNX_C6_COMPONENT_INPUT;
assert.ok(input&&path.isAbsolute(input),'YNX_C6_COMPONENT_INPUT must name the exact original component input directory');
const asar=createRequire(new URL('../../package.json',import.meta.url))('@electron/asar');
const recordRelative=selected.recordRelative;
const pin=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
function fixture(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-c6-real-package-'))),project=path.join(dir,'project');fs.mkdirSync(path.join(project,'native'),{recursive:true});fs.writeFileSync(path.join(project,'native/original-auth-identity.node'),'OLD CACHE MUST REMAIN');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,project};}
test('real c6 stage is frozen, exact re-entry reuses it, and old Node cache remains unchanged',t=>{
 const {project}=fixture(t),r=stageDesktopNative49C6Input(project,input);assert.equal(r.files,10);assert.equal(r.reused,false);assert.equal(stageDesktopNative49C6Input(project,input).reused,true);assert.equal(fs.readFileSync(path.join(project,'native/original-auth-identity.node'),'utf8'),'OLD CACHE MUST REMAIN');assert.equal(verifyDesktopNative49C6Input(r.destination).wholeAppReady,false);
 const leaf=path.join(r.destination,selected.assets[1].path);fs.appendFileSync(leaf,'MUTATION');assert.throws(()=>stageDesktopNative49C6Input(project,input),/C6_STAGE_FILE_OR_MODE/);assert.equal(fs.readFileSync(leaf).subarray(-8).toString(),'MUTATION');
});
test('real c6 nine unpacked assets relocate and roll back together; wrong record/image cannot select old pair',t=>{
 const {dir}=fixture(t),raw=path.join(dir,'raw');fs.mkdirSync(raw);for(const row of selected.assets.slice(1)){const to=path.join(raw,row.path.slice('apps/wallet-desktop/'.length));fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(input,row.path),to);fs.chmodSync(to,row.mode);}
 const record=fs.readFileSync(path.join(input,recordRelative)),tx=beginNativeRuntimeRelocation(null,raw,{c6RecordBytes:record});assert.equal(tx.files,9);assert.equal(verifyDesktopNative49C6Runtime(raw,record,{canonical:true}).nodeArtifactBytesVerified,true);tx.rollback();assert.equal(verifyDesktopNative49C6Runtime(raw,record).nodeArtifactBytesVerified,true);
 assert.throws(()=>beginNativeRuntimeRelocation(null,raw,{c6RecordBytes:Buffer.from('{}')}),/NATIVE49_NAPI_RECORD_BYTES/);assert.equal(fs.existsSync(path.join(raw,'native/original-auth-identity.node')),true);
 const lib=path.join(raw,'native/original-auth-runtime-libs/libuv.1.dylib');fs.chmodSync(lib,0o644);assert.throws(()=>beginNativeRuntimeRelocation(null,raw,{c6RecordBytes:record}),/C6_STAGE_FILE_OR_MODE/);
});
test('actual canonical ASAR writer retains real c6 stage bytes/sidecar and rejects a changed retained stage',async t=>{
 const {dir,project}=fixture(t);stageDesktopNative49C6Input(project,input);
 const archive=path.join(dir,'input.asar'),output=path.join(dir,'canonical.asar'),metadataInput=Buffer.from(JSON.stringify({name:'PUBLIC-ARCHIVE-CONTROL',version:'0.0.0',main:CANONICAL_MAIN,ynxNativeComponent:selected.kind}));
 const files=[['package.json',metadataInput,false,0o644],[SDK_ALIAS+'/package.json',Buffer.from('{"name":"@ynx-chain/wallet-auth"}'),false,0o644],[SDK_ALIAS+'/src/index.js',Buffer.from('export const PUBLIC_ONLY=true;'),false,0o644],...selected.assets.map(row=>[row.path.slice('apps/wallet-desktop/'.length),fs.readFileSync(path.join(input,row.path)),!row.path.endsWith('.json'),row.mode])];
 const dirs=new Set();for(const [name] of files){let d=path.posix.dirname(name);while(d!=='.'){dirs.add(d);d=path.posix.dirname(d);}}
 await asar.createPackageFromStreams(archive,[...[...dirs].sort().map(p=>({path:p,type:'directory',unpacked:false})),...files.map(([p,b,unpacked,mode])=>({path:p,type:'file',unpacked,stat:{mode,size:b.length},streamGenerator:()=>Readable.from([b])}))]);
 const before=asar.listPackage(archive).map(p=>{const name=p.replace(/^\//,''),s=asar.statFile(archive,name,false);return s.files?{path:name,type:'directory',unpacked:!!s.unpacked}:{path:name,type:'file',unpacked:!!s.unpacked,executable:!!s.executable,...pin(asar.extractFile(archive,name,false))};});
 await writeCanonicalArchiveInputs({asar,archive,output,before,metadataInput,dependencies:{rows:[],contents:new Map()},evidence:{rows:[],contents:new Map()},canonical:canonicalArchivePlan(before,metadataInput)});
 const record=fs.readFileSync(path.join(input,recordRelative));// The normal relocator retains the original builder unpacked tree. This
 // archive-writer control checks ASAR byte/header semantics, not its discarded temporary output modes.
 asar.uncache(output);
 assert.equal(verifyDesktopNative49C6ASAR({asar,archive:output,projectDir:project}).nodeArtifactBytesVerified,true);assert.equal(!!asar.statFile(output,'code/'+recordRelative,false).unpacked,false);
 for(const row of selected.assets.slice(1))assert.equal(asar.statFile(output,'code/'+row.path,false).unpacked,true);
 const stageLeaf=path.join(desktopNative49C6StageRoot(project),selected.assets[1].path);fs.appendFileSync(stageLeaf,'MUTATE');assert.throws(()=>verifyDesktopNative49C6ASAR({asar,archive:output,projectDir:project}),/C6_STAGE_FILE_OR_MODE/);
});
test('symlink stage root is rejected before reading a valid component',t=>{const {dir,project}=fixture(t),link=desktopNative49C6StageRoot(project);fs.symlinkSync(input,link);assert.throws(()=>stageDesktopNative49C6Input(project,input),/C6_REGULAR_ABSOLUTE_ROOT_REQUIRED/);assert.equal(fs.lstatSync(link).isSymbolicLink(),true);});

test('actual helper-only original-source reader stages and verifies one bundle without old Node pair or service execution',t=>{
 const {dir}=fixture(t),projectDir=fileURLToPath(new URL('../..',import.meta.url));
 const first=stageDesktopC6ApprovedHelper({contents:dir,projectDir});
 assert.equal(first.component.helper.translationUnits,13);assert.equal(first.component.nodeComponentVerified,false);assert.equal(first.component.pairedComponentVerified,false);assert.equal(first.bundle.bytesVerified,true);assert.equal(first.executed,false);assert.equal(first.serviceRegistered,false);
 assert.equal(stageDesktopC6ApprovedHelper({contents:dir,projectDir}).bundle.bytesVerified,true);
 const leaf=path.join(dir,'Library/HelperTools/YNXIdentityReceiver');fs.appendFileSync(leaf,'MUTATED');assert.throws(()=>stageDesktopC6ApprovedHelper({contents:dir,projectDir}),/C6_HELPER_BUNDLE_CONFLICT/);assert.equal(fs.readFileSync(leaf).subarray(-7).toString(),'MUTATED');
});
test('actual builder FileSet mapping applies unpack patterns to staged source paths and retains the JSON sidecar packed',async t=>{
 const {dir,project}=fixture(t);stageDesktopNative49C6Input(project,input);
 const src=path.join(desktopNative49C6StageRoot(project),'apps/wallet-desktop'),destination=path.join(dir,'destination'),files=selected.assets.map(row=>path.join(desktopNative49C6StageRoot(project),row.path)),stats=new Map(files.map(file=>[file,fs.statSync(file)]));
 const require=createRequire(new URL('../../package.json',import.meta.url)),{AsarPackager}=require('app-builder-lib/out/asar/asarUtil'),{FileMatcher}=require('app-builder-lib/out/fileMatcher'),{desktopNative49C6BuilderConfiguration}=await import('../desktop-native49-c6-pack.mjs'),metadata=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url)));
 const run=patterns=>new AsarPackager({info:{getWorkspaceRoot:async()=>project}},{resourcePath:dir,defaultDestination:destination,options:{smartUnpack:false},unpackPattern:new FileMatcher(project,destination,x=>x,patterns).createFilter()}).processFileSets([{src,destination,files,metadata:stats}]);
 const broken=await run(metadata.build.asarUnpack);assert.equal(broken.filter(row=>row.type==='file'&&row.unpacked).length,0,'legacy patterns reproduce all nine staged binaries/licenses incorrectly packed');
 const actual=await run(desktopNative49C6BuilderConfiguration(metadata).asarUnpack);
 for(const row of selected.assets){const relative=row.path.slice('apps/wallet-desktop/'.length),packed=actual.find(x=>x.path===relative);assert.ok(packed,relative);assert.equal(packed.unpacked,!relative.endsWith('.json'),relative);}
});
