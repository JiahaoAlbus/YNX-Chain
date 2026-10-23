import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,lstatSync,existsSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalNativeEvidencePlan} from '../scripts/canonical-native-evidence.mjs';
import {CANONICAL_NATIVE_EVIDENCE_TESTS,CANONICAL_MAIN,SDK_ALIAS,canonicalSourcePath} from '../scripts/canonical-package.mjs';
import {PACKAGED_RELOCATION_RULES,relocateDesktopPackage,desktopReleaseIdentity,PACKAGED_RELOCATION_RECEIPT} from '../scripts/release-provenance.mjs';
const require=createRequire(new URL('../package.json',import.meta.url)),asar=require('@electron/asar'),cli=require.resolve('@electron/asar/bin/asar.js');
const writer=new URL('../scripts/release-provenance.mjs',import.meta.url).href,planner=new URL('../scripts/canonical-native-evidence.mjs',import.meta.url).href;
const publicBytes=name=>Buffer.from('// PUBLIC source inspection DATA only: '+name+'\n');

test('fixed evidence plan reads only the two source-owned paths and never calls them compiler/runtime inputs',()=>{
 const seen=[],plan=canonicalNativeEvidencePlan('1.3.0-pq.3.32-auth.14',name=>{seen.push(name);return publicBytes(name)});
 assert.deepEqual(seen,CANONICAL_NATIVE_EVIDENCE_TESTS);assert.equal(plan.rows.length,2);
 assert.ok(plan.public.every(p=>p.role==='git-bound-source-inspection-evidence'));
 assert.ok(plan.rows.every(p=>!p.unpacked&&!p.executable));
 assert.throws(()=>canonicalNativeEvidencePlan('1.3.0-pq.3.32-auth.14',()=>Buffer.alloc(0)),/source differs/);
 assert.throws(()=>canonicalNativeEvidencePlan('1.3.0-pq.3.32-auth.14',()=>Buffer.alloc(262145)),/source differs/);
 assert.deepEqual(canonicalNativeEvidencePlan('1.3.0-pq.3.32-auth.16',()=>{throw Error('not selected')}).rows,[]);
});

function fixture(t,{foreign=false,mismatch=false}={}){
 const root=mkdtempSync(path.join(tmpdir(),'PUBLIC-canonical-evidence-')),stage=path.join(root,'raw'),archive=path.join(root,'input.asar'),output=path.join(root,'output.asar');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(name,bytes)=>{const file=path.join(stage,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes)};
 put('package.json',JSON.stringify({name:'PUBLIC-only-fixture',version:'0.0.0',main:CANONICAL_MAIN}));
 put('native/original-auth-identity.node','PUBLIC DATA, not an executable Native module');
 put(SDK_ALIAS+'/package.json','{"name":"@ynx-chain/wallet-auth","type":"module"}');
 put(SDK_ALIAS+'/src/index.js','export const PUBLIC_ONLY=true;\n');
 if(foreign)put(SDK_ALIAS+'/native/foreign.test.mjs','PUBLIC foreign evidence');
 if(mismatch)put(SDK_ALIAS+'/native/original-auth-identity-joint-owner.test.mjs','PUBLIC conflicting evidence');
 execFileSync(process.execPath,[cli,'pack',stage,archive,'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 const before=asar.listPackage(archive).map(raw=>{const name=raw.replace(/^\//,''),info=asar.statFile(archive,name,false);
  if('files'in info)return {path:name,type:'directory',unpacked:!!info.unpacked};
  const bytes=asar.extractFile(archive,name),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  return {path:name,type:'file',unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:info.unpacked?lstatSync(path.join(archive+'.unpacked',name)).mode&0o777:null,bytes:bytes.length,sha256};
 });
 const run=({omitSource=false,duplicate=false,noEvidence=false}={})=>{
  // Same real writer used by writeRelocatedArchive, in a short-lived data
  // child so ASAR's final stream flush completes before the parent reads it.
  const config={archive,output,before:duplicate?[...before,before.at(-1)]:before,omitSource,noEvidence};
  const code=`import{createRequire}from'node:module';import{writeCanonicalArchiveInputs}from${JSON.stringify(writer)};import{canonicalNativeEvidencePlan}from${JSON.stringify(planner)};const require=createRequire(${JSON.stringify(fileURLToPath(new URL('../package.json',import.meta.url)))}),asar=require('@electron/asar'),c=${JSON.stringify(config)};const evidence=c.noEvidence?{rows:[],contents:new Map(),public:[]}:canonicalNativeEvidencePlan('1.3.0-pq.3.32-auth.14',name=>{if(c.omitSource)throw Error('Missing original fixed evidence');return Buffer.from('// PUBLIC source inspection DATA only: '+name+'\\n')});await writeCanonicalArchiveInputs({asar,archive:c.archive,output:c.output,before:c.before,metadataInput:asar.extractFile(c.archive,'package.json'),dependencies:{rows:[],contents:new Map()},evidence});`;
  return spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',maxBuffer:2*1024*1024});
 };
 return {root,archive,output,run};
}
test('real ASAR writer reproduces absent evidence without staging, then stages exact pair at canonical paths',t=>{
 const f=fixture(t);assert.equal(f.run({noEvidence:true}).status,0);
 assert.throws(()=>asar.extractFile(f.output,canonicalSourcePath(CANONICAL_NATIVE_EVIDENCE_TESTS[0])),/not found/);
 // A new output, not an edit of the previous archive, follows the normal child.
 const first=path.join(f.root,'preserved-no-evidence.asar');require('node:fs').renameSync(f.output,first);asar.uncache(f.output);
 const result=f.run();assert.equal(result.status,0,result.stderr);
 for(const name of CANONICAL_NATIVE_EVIDENCE_TESTS){const target=canonicalSourcePath(name);assert.deepEqual(asar.extractFile(f.output,target),publicBytes(name));assert.equal(!!asar.statFile(f.output,target).unpacked,false);
  const alias=SDK_ALIAS+'/'+name.slice('packages/wallet-auth/'.length);assert.equal(asar.statFile(f.output,alias,false).link,target);
 }
 assert.ok(existsSync(first));
});
for(const variant of ['missing','duplicate','foreign','mismatch'])test(`real ASAR writer rejects ${variant} evidence without changing the input archive`,t=>{
 const f=fixture(t,{foreign:variant==='foreign',mismatch:variant==='mismatch'}),before=readFileSync(f.archive);
 const result=f.run({omitSource:variant==='missing',duplicate:variant==='duplicate'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Missing original fixed evidence|Duplicate canonical archive member|Foreign Native build evidence|Conflicting canonical SDK dependency/);
 assert.deepEqual(readFileSync(f.archive),before);assert.equal(existsSync(f.output),false);
});

for(const sdkVersion of ['1.3.0-pq.3.32-auth.14','1.3.0-pq.3.32-auth.18'])test(`normal relocation ${sdkVersion} parent and data child restore excluded evidence from immutable Git and bind the receipt`,t=>{
 const root=mkdtempSync(path.join(tmpdir(),'PUBLIC-normal-evidence-')),app=path.join(root,'apps/wallet-desktop'),raw=path.join(root,'raw'),resources=path.join(root,'resources'),archive=path.join(resources,'app.asar');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const manifestBytes=readFileSync(new URL('../scripts/wallet-auth-runtime-dependencies.json',import.meta.url)),manifest=JSON.parse(manifestBytes);
 const dependencyRoot=process.env.PROVENANCE_SDK_DEPENDENCY_ROOT??fileURLToPath(new URL('../../../packages/wallet-auth/node_modules/',import.meta.url));
 const files=new Map([
  ['apps/wallet-desktop/package.json',Buffer.from(JSON.stringify({name:'PUBLIC-evidence-wallet',version:'0.0.0',main:'src/main.mjs',type:'module'}))],
  ['apps/wallet-desktop/native/original-auth-identity.node',Buffer.from('PUBLIC non-Native fixture; never loaded')],
  ['packages/wallet-auth/package.json',Buffer.from(JSON.stringify({name:'@ynx-chain/wallet-auth',version:sdkVersion,type:'module',dependencies:{'@noble/curves':'2.2.0','@noble/hashes':'2.2.0'},peerDependencies:{'@ynx/batch-v01-candidate':'0.1.0-candidate.2'},peerDependenciesMeta:{'@ynx/batch-v01-candidate':{optional:true}}}))],
  ['packages/wallet-auth/src/index.js',Buffer.from('export const PUBLIC_ONLY=true;\n')],
  ['apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json',manifestBytes],
  ...CANONICAL_NATIVE_EVIDENCE_TESTS.map(name=>[name,publicBytes(name)]),
 ]);
 for(const rule of PACKAGED_RELOCATION_RULES){const body=rule.operands.map((o,index)=>{
  const count=rule.sourcePath==='packages/wallet-auth/src/original-ide-admission-parent-delivery.js'?3:o.count;
  return (o.kind==='from'?`import {} from '${o.from}';\n`:`const PUBLIC_${index}=new URL('${o.from}',import.meta.url);\n`).repeat(count);
 }).join('');files.set(rule.sourcePath,Buffer.from(body));}
 for(const p of manifest.files)files.set('packages/wallet-auth/node_modules/'+p.path,readFileSync(path.join(dependencyRoot,p.path)));
 for(const [name,bytes]of files){const local=path.join(root,name);mkdirSync(path.dirname(local),{recursive:true});writeFileSync(local,bytes);
  if(name.includes('/node_modules/')||name.startsWith('apps/wallet-desktop/scripts/')||CANONICAL_NATIVE_EVIDENCE_TESTS.includes(name))continue;
  const target=path.join(raw,name.startsWith('apps/wallet-desktop/')?name.slice('apps/wallet-desktop/'.length):SDK_ALIAS+'/'+name.slice('packages/wallet-auth/'.length));mkdirSync(path.dirname(target),{recursive:true});
  writeFileSync(target,name==='apps/wallet-desktop/package.json'?JSON.stringify({...JSON.parse(bytes),main:CANONICAL_MAIN}):bytes);if(name.endsWith('.node'))chmodSync(target,0o755);
 }
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();git('init');git('add','apps','packages');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','commit','-m','PUBLIC immutable evidence composition');
 symlinkSync(fileURLToPath(new URL('../node_modules/',import.meta.url)),path.join(app,'node_modules'),'dir');mkdirSync(resources);
 const previous=process.env.GITHUB_SHA;process.env.GITHUB_SHA=git('rev-parse','HEAD');t.after(()=>{if(previous===undefined)delete process.env.GITHUB_SHA;else process.env.GITHUB_SHA=previous});
 writeFileSync(path.join(resources,'ynx-wallet-build-identity.json'),JSON.stringify(desktopReleaseIdentity(app,'0.0.0')));
 execFileSync(process.execPath,[cli,'pack',raw,archive,'--unpack','original-auth-identity.node'],{stdio:'pipe'});
 for(const name of CANONICAL_NATIVE_EVIDENCE_TESTS)assert.throws(()=>asar.extractFile(archive,SDK_ALIAS+'/'+name.slice('packages/wallet-auth/'.length)),/not found/);
 relocateDesktopPackage(resources,app);
 const receipt=JSON.parse(readFileSync(path.join(resources,PACKAGED_RELOCATION_RECEIPT)));
 assert.equal(receipt.nativeBuildEvidence.length,2);assert.equal(receipt.sdkDependencies.files.length,316);
 for(const name of CANONICAL_NATIVE_EVIDENCE_TESTS){const target=canonicalSourcePath(name);assert.deepEqual(asar.extractFile(archive,target),files.get(name));assert.ok(receipt.after.some(r=>r.path===target));}
});
