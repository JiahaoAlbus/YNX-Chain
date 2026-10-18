import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fixture as exportFixture,original,binding,sha} from './helpers/pq-host-export.mjs';
import {preparePQTransferOriginal} from '../src/features/pq-transaction/transfer-binding.mjs';
import {installOriginalProofHostDelivery,readInstalledOriginalProofHostDelivery} from '../src/original-proof-host-delivery.mjs';
async function fixture(t,runtime=false){
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'wallet-operator-data-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const incoming=path.join(root,'incoming'),dest=path.join(root,'installed');await fs.mkdir(incoming,{mode:0o700});const f=exportFixture(),origin='/PUBLIC/operator-destination',body=new Map();
 const layout=[['migration','migration.json'],['genesis','genesis.json'],['state','committed-state.json'],['schedule','schedule.json'],...(runtime?[['runtime','runtime-plan.json']]:[]),['trustedLightBlock','trusted-light-block.json'],['context','trust-context.json'],['lifecycle','lifecycle.json'],['source','host-source.json']];
 for(const [role]of layout)if(!['context','lifecycle','source'].includes(role))body.set(role,Buffer.from(JSON.stringify({PUBLIC:'synthetic not a genuine Host '+role})));
 const paths={migrationFile:'migration',genesisFile:'genesis',stateFile:'state',scheduleFile:'schedule',runtimePlanFile:'runtime',trustedLightBlockFile:'trustedLightBlock'};
 for(const [key,role]of Object.entries(paths))f.light[key]=body.has(role)?path.join(origin,layout.find(x=>x[0]===role)[1]):'';
 if(runtime)f.light.runtimePlanHash='ef'.repeat(32);f.light.trustedLightBlockSHA256=sha(body.get('trustedLightBlock'));
 body.set('context',Buffer.from(JSON.stringify(f.context)));body.set('lifecycle',Buffer.from(JSON.stringify(f.lifecycle)));
 const pins={migrationSHA256:'migration',genesisSHA256:'genesis',stateSHA256:'state',scheduleSHA256:'schedule',runtimePlanSHA256:'runtime',trustedLightBlockSHA256:'trustedLightBlock',contextSHA256:'context',lifecycleSHA256:'lifecycle'};
 for(const [field,role]of Object.entries(pins))f.source[field]=body.has(role)?sha(body.get(role)):'';
 f.source.contextFile=path.join(origin,'trust-context.json');f.source.lifecycleFile=path.join(origin,'lifecycle.json');body.set('source',Buffer.from(JSON.stringify(f.source)));
 const p=preparePQTransferOriginal(original,binding),manifest={version:'YNX-CONSENSUS-PROOF-HOST-DELIVERY/v1',sourceId:f.selection.sourceId,epoch:f.selection.epoch,binding:{operationId:original.operationId,account:binding.account,networkId:binding.networkId,originalHash:original.hash,nativeWireHash:original.hash.slice(2),transactionHash:p.binding.abciTransactionHash.slice(2)},sourceFile:'host-source.json',sourceSHA256:sha(body.get('source')),files:layout.map(([role,name])=>({role,name,bytes:String(body.get(role).length),sha256:sha(body.get(role))})),totalBytes:String([...body.values()].reduce((n,b)=>n+b.length,0))};
 for(const [role,name]of layout)await fs.writeFile(path.join(incoming,name),body.get(role),{mode:0o600});
 let raw;async function save(text=null){raw=Buffer.from(text??JSON.stringify(manifest));await fs.writeFile(path.join(incoming,'delivery.json'),raw,{mode:0o600});}await save();let locked=false;
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}};
 return {root,incoming,dest,f,body,layout,manifest,guard,save,raw:()=>raw,lock:()=>{locked=true;},install:()=>installOriginalProofHostDelivery({deliveryDirectory:incoming,deliverySha256:sha(raw),destinationDirectory:dest,original,binding,guard}),restore:()=>readInstalledOriginalProofHostDelivery({directory:dest,deliverySha256:sha(raw),original,binding,guard})};
}
test('8/9-role delivery pins copy exclusively, preserve original bytes and relocate only existing path/checksum slots',async t=>{
 for(const runtime of [false,true]){const f=await fixture(t,runtime),selected=await f.install();assert.deepEqual(Object.keys(selected),['sourcePath','sourceSha256','sourceId','epoch']);assert.equal(Object.isFrozen(selected),true);const sourceRaw=await fs.readFile(selected.sourcePath);assert.equal(sha(sourceRaw),selected.sourceSha256);
  const source=JSON.parse(sourceRaw),context=JSON.parse(await fs.readFile(source.contextFile));assert.equal(source.contextFile,path.join(f.dest,'trust-context.json'));assert.equal(source.lifecycleFile,path.join(f.dest,'lifecycle.json'));assert.deepEqual(context.expectedTransaction,f.f.expected);
  for(const key of Object.keys(f.f.light)){if(key.endsWith('File')){assert.equal(context.lightTrust[key],f.f.light[key]===''?'':path.join(f.dest,path.basename(f.f.light[key])));}else assert.equal(context.lightTrust[key],f.f.light[key]);}
  assert.deepEqual(await fs.readFile(path.join(f.dest,'original/delivery.json')),f.raw());assert.deepEqual(await fs.readFile(path.join(f.dest,'original/trust-context.json')),f.body.get('context'));assert.deepEqual(await fs.readFile(path.join(f.dest,'original/host-source.json')),f.body.get('source'));assert.equal((await fs.stat(f.dest)).mode&0o777,0o700);assert.equal((await fs.stat(selected.sourcePath)).mode&0o777,0o600);
  await assert.rejects(f.install());assert.deepEqual(await fs.readFile(selected.sourcePath),sourceRaw);
 }
});
test('foreign original/network/hash and malformed closed manifests fail before a destination exists',async t=>{
 for(const change of [m=>{m.binding.originalHash='0x'+'0'.repeat(64);},m=>{m.binding.networkId='0'.repeat(64);},m=>{m.files[0].name='../escape';},m=>{m.files.reverse();},m=>{m.totalBytes='01';},m=>{m.files[0].bytes='1073741825';},m=>{m.files[0].sha256='0'.repeat(64);},m=>{m.extra='unrecognized';}]){const f=await fixture(t);change(f.manifest);await f.save();await assert.rejects(f.install());await assert.rejects(fs.stat(f.dest),{code:'ENOENT'});}
});
test('independent catalog pin, duplicate escaped keys, BOM and invalid UTF8 cannot be replaced by incoming self metadata',async t=>{
 const f=await fixture(t);await assert.rejects(installOriginalProofHostDelivery({deliveryDirectory:f.incoming,deliverySha256:'ab'.repeat(32),destinationDirectory:f.dest,original,binding,guard:f.guard}));
 for(const transform of [s=>s.replace('"sourceId":','"sourceId":"duplicate","source\\u0049d":'),s=>'\ufeff'+s]){await f.save(transform(JSON.stringify(f.manifest)));await assert.rejects(f.install());}
 await f.save();const originalManifest=f.raw();await fs.writeFile(path.join(f.incoming,'delivery.json'),Buffer.concat([Buffer.from([255]),originalManifest]));await assert.rejects(f.install());await assert.rejects(fs.stat(f.dest),{code:'ENOENT'});
});
test('extra files, symlinks, hardlinks and changed payload pins cannot produce a selected source',async t=>{
 for(const mode of ['extra','symlink','hardlink','changed']){const f=await fixture(t),file=path.join(f.incoming,'migration.json');if(mode==='extra')await fs.writeFile(path.join(f.incoming,'unknown'),Buffer.from('PUBLIC'));if(mode==='changed')await fs.writeFile(file,Buffer.alloc(f.body.get('migration').length,88));if(mode==='hardlink')await fs.link(file,path.join(f.root,'alias'));if(mode==='symlink'){await fs.rename(file,path.join(f.root,'original-migration'));await fs.symlink(path.join(f.root,'original-migration'),file);}await assert.rejects(f.install());}
});
test('a locked original cannot create any private installation or use another account guard',async t=>{
 const f=await fixture(t);f.lock();await assert.rejects(f.install(),{code:'PUBLIC_LOCKED'});await assert.rejects(fs.stat(f.dest),{code:'ENOENT'});
});
test('lock during exclusive copy retains the original catalog and partial file, with no selection or destructive retry',async t=>{
 const f=await fixture(t),partial=path.join(f.dest,'migration.json'),guard={account:binding.account,assert(){if(existsSync(partial))throw Object.assign(Error('PUBLIC lock during copy'),{code:'PUBLIC_LOCKED'});}};
 await assert.rejects(installOriginalProofHostDelivery({deliveryDirectory:f.incoming,deliverySha256:sha(f.raw()),destinationDirectory:f.dest,original,binding,guard}),e=>e.code==='PQ_HOST_DELIVERY_UNCONFIRMED'&&e.cause.code==='PUBLIC_LOCKED'&&e.partialDirectory===f.dest);
 const before=await fs.readFile(partial),manifest=await fs.readFile(path.join(f.dest,'original/delivery.json'));await assert.rejects(fs.stat(path.join(f.dest,'host-source.json')),{code:'ENOENT'});
 await assert.rejects(f.install());assert.deepEqual(await fs.readFile(partial),before);assert.deepEqual(await fs.readFile(path.join(f.dest,'original/delivery.json')),manifest);
});
async function snapshot(root){const result={};async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name),s=await fs.lstat(file);if(e.isDirectory())await visit(file);else result[path.relative(root,file)]={sha256:sha(await fs.readFile(file)),bytes:s.size,mode:s.mode,mtimeMs:s.mtimeMs};}}await visit(root);return result;}
test('cold DATA restore rebinds 8/9 roles to the independent original manifest with zero rewrites or incoming-directory dependency',async t=>{
 for(const runtime of [false,true]){const f=await fixture(t,runtime),installed=await f.install(),before=await snapshot(f.dest);await fs.rename(f.incoming,path.join(f.root,'unavailable-incoming'));const cold=await f.restore();assert.deepEqual(cold,installed);assert.equal(Object.isFrozen(cold),true);assert.deepEqual(await snapshot(f.dest),before);}
});
test('cold restore rejects tampered payload, lifecycle, original bytes and relocated files without repair or deletion',async t=>{
 for(const relative of ['migration.json','lifecycle.json','trust-context.json','host-source.json','original/delivery.json','original/trust-context.json','original/host-source.json']){const f=await fixture(t);await f.install();const file=path.join(f.dest,relative),raw=await fs.readFile(file),bad=Buffer.from(raw);bad[0]^=1;await fs.writeFile(file,bad);const before=await snapshot(f.dest);await assert.rejects(f.restore(),{code:'PQ_HOST_DELIVERY_RESTORE_UNVERIFIED'});assert.deepEqual(await snapshot(f.dest),before);}
});
test('cold restore does not self-admit a local pin, foreign operation, extra files or relaxed private permissions',async t=>{
 const f=await fixture(t);await f.install();const before=await snapshot(f.dest);
 await assert.rejects(readInstalledOriginalProofHostDelivery({directory:f.dest,deliverySha256:'ab'.repeat(32),original,binding,guard:f.guard}),{code:'PQ_HOST_DELIVERY_RESTORE_UNVERIFIED'});
 await assert.rejects(readInstalledOriginalProofHostDelivery({directory:f.dest,deliverySha256:sha(f.raw()),original:{...original,operationId:'different-original'},binding,guard:f.guard}),{code:'PQ_HOST_DELIVERY_RESTORE_UNVERIFIED'});assert.deepEqual(await snapshot(f.dest),before);
 await fs.writeFile(path.join(f.dest,'unexpected'),Buffer.from('PUBLIC preserve unknown file'));await assert.rejects(f.restore());assert.equal(await fs.readFile(path.join(f.dest,'unexpected'),'utf8'),'PUBLIC preserve unknown file');
 const other=await fixture(t);await other.install();await fs.chmod(path.join(other.dest,'host-source.json'),0o644);await assert.rejects(other.restore());assert.equal((await fs.stat(path.join(other.dest,'host-source.json'))).mode&0o777,0o644);
});
