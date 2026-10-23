import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {canonicalArchivePlan,canonicalSourcePath,CANONICAL_MAIN,NATIVE_CANONICAL} from '../scripts/canonical-package.mjs';
import {R155_INTAKE_ASSET,R155_HELPER_ASSET} from '../scripts/r155-native-component.mjs';
const require=createRequire(import.meta.url),asar=require('@electron/asar'),{FileMatcher}=require('app-builder-lib/out/fileMatcher.js');
const sha=b=>createHash('sha256').update(b).digest('hex');
const projectPrefix='apps/wallet-desktop/';
const required=['native/original-auth-identity.node','native/original-auth-identity-build.json',R155_INTAKE_ASSET.slice(projectPrefix.length),R155_HELPER_ASSET.slice(projectPrefix.length)];
const fixtureBytes=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url));

test('normal builder allowlist retains both exact R155 supplier DATA paths through real ASAR canonical packing',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'ynx-r155-packaging-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'input'),stage=path.join(root,'selected');fs.mkdirSync(input);fs.mkdirSync(stage);
 const config=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
 const metadata=Buffer.from(JSON.stringify({name:'public-canonical-r155-path-fixture',version:'0.6.10',type:'module',main:CANONICAL_MAIN}));
 const files=new Map([
  ['package.json',metadata],['src/main.mjs',Buffer.from('// PUBLIC path fixture; no entrypoint execution\n')],
  ['native/original-auth-identity.node',Buffer.from('PUBLIC stand-in, never loaded or qualified')],
  ['native/original-auth-identity-build.json',fixtureBytes('r155-executed-producer-record.json')],
  [R155_INTAKE_ASSET.slice(projectPrefix.length),fixtureBytes('r155-original-source-intake.json')],
  [R155_HELPER_ASSET.slice(projectPrefix.length),Buffer.from('PUBLIC helper stand-in, never executed or qualified')],
  ['node_modules/@ynx-chain/wallet-auth/package.json',Buffer.from('{"name":"@ynx-chain/wallet-auth","version":"PUBLIC","type":"module"}')],
  ['native/unreviewed.node',Buffer.from('PUBLIC forbidden extra')],['native/password.wallet.json',Buffer.from('PUBLIC forbidden extra')],
  ['native/original-source-current-dirfd.node',Buffer.from('PUBLIC unsupported Native')],['native/publisher-record.bin',Buffer.from('PUBLIC forbidden custody data')]
 ]);
 for(const [name,body]of files){const file=path.join(input,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body,{mode:name.endsWith('.node')||name.endsWith('YNXIdentityReceiver')?0o755:0o644});}
 // Use the actual electron-builder matcher, not an ad hoc includes/glob model.
 const filter=new FileMatcher(input,stage,v=>v,config.build.files).createFilter();
 for(const name of files.keys()){const file=path.join(input,name);if(filter(file,fs.statSync(file))){const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);fs.chmodSync(dest,fs.statSync(file).mode&0o777);}}
 const raw=path.join(root,'raw.asar');await asar.createPackageWithOptions(stage,raw,{unpack:'**/original-auth-identity.node'});
 const before=[];
 function inventory(tree,prefix=''){
  for(const [name,info]of Object.entries(tree.files??{})){
   const p=prefix?prefix+'/'+name:name;
   if(info.files){before.push({path:p,type:'directory',unpacked:!!info.unpacked});inventory(info,p);}
   else{const body=asar.extractFile(raw,p);before.push({path:p,type:'file',unpacked:!!info.unpacked,executable:!!info.executable,physicalMode:null,bytes:body.length,sha256:sha(body)});}
  }
 }
 inventory(asar.getRawHeader(raw).header);
 const plan=canonicalArchivePlan(before,metadata),originals=new Map(before.map(row=>[row.path.startsWith('native/')||row.path.startsWith('src/')?'code/'+projectPrefix+row.path:row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?'code/packages/wallet-auth/'+row.path.slice('node_modules/@ynx-chain/wallet-auth/'.length):row.path,row.path]));
 const canonical=path.join(root,'canonical.asar');
 const streams=plan.after.map(row=>{
  if(row.type==='directory')return {path:row.path,type:row.type,unpacked:row.unpacked};
  if(row.type==='link')return {path:row.path,type:row.type,unpacked:row.unpacked,symlink:path.posix.relative(path.posix.dirname(row.path),row.link),stat:{mode:0o777}};
  let body;
  if(row.path==='package.json')body=plan.metadata;
  else if(row.path==='code/'+projectPrefix+'package.json')body=plan.appMetadata;
  else{const alias=row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?'code/packages/wallet-auth/'+row.path.slice('node_modules/@ynx-chain/wallet-auth/'.length):row.path;body=asar.extractFile(raw,originals.get(alias));}
  return {path:row.path,type:'file',unpacked:row.unpacked,stat:{mode:row.executable?0o755:0o644,size:body.length},streamGenerator:()=>Readable.from([body])};
 });
 await asar.createPackageFromStreams(canonical,streams);
 // This is the same canonical path extraction that failed in the real App.
 for(const name of required)assert.deepEqual(asar.extractFile(canonical,canonicalSourcePath(projectPrefix+name)),files.get(name));
 assert.equal(asar.statFile(canonical,NATIVE_CANONICAL).unpacked,true);
 const names=asar.listPackage(canonical);
 for(const name of ['native/unreviewed.node','native/password.wallet.json','native/original-source-current-dirfd.node','native/publisher-record.bin'])assert.equal(names.includes('/'+canonicalSourcePath(projectPrefix+name)),false);
 assert.deepEqual(config.build.files.filter(p=>p.startsWith('native/')).sort(),[...required].sort());
});
