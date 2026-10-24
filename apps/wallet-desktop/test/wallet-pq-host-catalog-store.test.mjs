import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PQHostCatalogStore} from '../src/wallet-pq-host-catalog-store.mjs';
import {createOriginalPQHostCatalogReceiver} from '../src/wallet-pq-host-catalog-registration.mjs';
const original={operationId:'PUBLIC-one-operation',account:'0x'+'a'.repeat(40),networkId:'b'.repeat(64),originalHash:'0x'+'c'.repeat(64),nativeWireHash:'c'.repeat(64),transactionHash:'d'.repeat(64)};
const sha=b=>createHash('sha256').update(b).digest('hex');
const options={skip:process.platform==='win32'||process.getuid?.()===0};
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-pq-registration-public-')));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pairFor=(identity,name='catalog.json')=>{const catalogPath=path.join(root,name),raw=Buffer.from(JSON.stringify({version:'YNX-CONSENSUS-PROOF-HOST-SOURCE-CATALOG/v1',manifestPath:'/PUBLIC/manifest',manifestSHA256:'e'.repeat(64),binding:identity,sourcePath:'/PUBLIC/source',sourceSha256:'f'.repeat(64),sourceId:'PUBLIC-not-trusted',epoch:'1'}));fs.writeFileSync(catalogPath,raw,{mode:0o600});return {catalogPath,catalogSha256:sha(raw)};};
 const directory=path.join(root,'records'),pair=pairFor(original);
 return {root,directory,pair,pairFor,store:new PQHostCatalogStore({directory})};
}
test('two operations retain independent pairs; restart selects only journal-bound original without overwriting',options,t=>{
 const f=fixture(t),other={...original,operationId:'PUBLIC-other-operation'};
 assert.throws(()=>f.store.select(original),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});
 assert.deepEqual(f.store.retain(original,f.pair),f.pair);
 assert.throws(()=>f.store.retain(other,f.pair),{code:'PQ_HOST_REGISTRATION_BINDING'});
 const otherPair=f.pairFor(other,'other-catalog.json');assert.deepEqual(f.store.retain(other,otherPair),otherPair);
 const files=fs.readdirSync(f.directory);assert.equal(files.length,2);
 const before=files.map(n=>fs.statSync(path.join(f.directory,n)).mtimeMs);
 const cold=new PQHostCatalogStore({directory:f.directory});assert.deepEqual(cold.select(original),f.pair);assert.deepEqual(cold.select(other),otherPair);
 assert.deepEqual(cold.retain(original,f.pair),f.pair);
 assert.deepEqual(files.map(n=>fs.statSync(path.join(f.directory,n)).mtimeMs),before);
 assert.throws(()=>cold.select({...original,operationId:'PUBLIC-absent'}),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});
 assert.throws(()=>cold.select({...original,networkId:'0'.repeat(64)}));
});
test('conflicting pairs, duplicate JSON, partial restart records and non-private directories remain untouched',options,t=>{
 const f=fixture(t);f.store.retain(original,f.pair);
 const file=path.join(f.directory,fs.readdirSync(f.directory)[0]),before=fs.readFileSync(file);
 const another=path.join(f.root,'other.json');fs.copyFileSync(f.pair.catalogPath,another);fs.chmodSync(another,0o600);
 assert.throws(()=>f.store.retain(original,{...f.pair,catalogPath:another}),{code:'PQ_HOST_REGISTRATION_CONFLICT'});assert(fs.readFileSync(file).equals(before));
 for(const raw of [Buffer.from('{'),Buffer.from(before.toString().replace('{','{"version":"bad",'))]){
  fs.writeFileSync(file,raw);const cold=new PQHostCatalogStore({directory:f.directory});assert.throws(()=>cold.select(original));assert.throws(()=>cold.retain(original,f.pair));assert(fs.readFileSync(file).equals(raw));
 }
 fs.writeFileSync(file,before);fs.chmodSync(f.directory,0o755);assert.throws(()=>f.store.select(original),{code:'PQ_HOST_REGISTRATION_STORAGE'});assert.equal(fs.statSync(f.directory).mode&0o777,0o755);
});
test('post-write sync failure holds UNKNOWN; exact local reconciliation cannot re-register or authorize a Host',options,t=>{
 const f=fixture(t),sync=fs.fsyncSync;let fault=true;
 fs.fsyncSync=fd=>{if(fault){fault=false;throw Object.assign(Error('PUBLIC fsync uncertain'),{code:'PUBLIC_UNKNOWN'});}return sync(fd);};syncBuiltinESMExports();
 try{assert.throws(()=>f.store.retain(original,f.pair),{code:'PQ_HOST_REGISTRATION_UNCONFIRMED'});}finally{fs.fsyncSync=sync;syncBuiltinESMExports();}
 assert.equal(f.store.pending().outcome,'UNKNOWN');assert.throws(()=>f.store.select(original));assert.throws(()=>f.store.retain({...original,operationId:'PUBLIC-other'},f.pair));
 const saved=f.store.reconcile();assert.deepEqual(saved,{saved:true,hostAcquired:false,proofVerified:false});assert.equal(f.store.pending(),null);assert.deepEqual(f.store.select(original),f.pair);assert.equal(fs.readdirSync(f.directory).length,1);
});
test('catalog modification or withdrawal after restart never revives a saved pin',options,t=>{
 const f=fixture(t);f.store.retain(original,f.pair);const cold=new PQHostCatalogStore({directory:f.directory});
 fs.writeFileSync(f.pair.catalogPath,'changed');assert.throws(()=>cold.select(original),{code:'PQ_HOST_CATALOG_UNVERIFIED'});
 fs.unlinkSync(f.pair.catalogPath);assert.throws(()=>cold.select(original),{code:'PQ_HOST_CATALOG_UNVERIFIED'});assert.equal(fs.readdirSync(f.directory).length,1);
});
test('every original binding field is independent of the supplied catalog; hostile DATA cannot become a registration',options,t=>{
 const f=fixture(t);let getters=0;
 for(const field of Object.keys(original)){
  const changed={...original,[field]:field==='operationId'?'PUBLIC-other':field==='account'?'0x'+'e'.repeat(40):field==='originalHash'?'0x'+'e'.repeat(64):'e'.repeat(64)};
  assert.throws(()=>f.store.retain(changed,f.pair),{code:'PQ_HOST_REGISTRATION_BINDING'});
 }
 const hostile={...original};Object.defineProperty(hostile,'operationId',{enumerable:true,get(){getters++;return 'PUBLIC-other';}});
 for(const value of [hostile,new Proxy(original,{}),{...original,root:true}])assert.throws(()=>f.store.retain(value,f.pair),{code:'PQ_HOST_REGISTRATION_BINDING'});
 assert.equal(getters,0);assert.equal(fs.existsSync(f.directory),false);
});
test('private receiver does not release a held save on shutdown or silently retry another operation',options,t=>{
 const f=fixture(t),receiver=createOriginalPQHostCatalogReceiver({directory:f.directory}),sync=fs.fsyncSync;let fault=true;
 fs.fsyncSync=fd=>{if(fault){fault=false;throw false;}return sync(fd);};syncBuiltinESMExports();
 try{assert.throws(()=>receiver.receive(original,f.pair),e=>e.code==='PQ_HOST_REGISTRATION_UNCONFIRMED'&&e.cause===false);}finally{fs.fsyncSync=sync;syncBuiltinESMExports();}
 assert.throws(()=>receiver.assertSafeToClose(),{code:'PQ_HOST_REGISTRATION_UNCONFIRMED'});assert.equal(receiver.pending().outcome,'UNKNOWN');
 assert.equal(receiver.reconcile().hostAcquired,false);receiver.assertSafeToClose();assert.deepEqual(receiver.select(original),f.pair);
});
