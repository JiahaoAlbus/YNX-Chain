import test from 'node:test';
import assert from 'node:assert/strict';
import * as selection from '../src/wallet-pq-host-selection.mjs';
import {original,binding} from './helpers/pq-host-export.mjs';
import fs from 'node:fs/promises';
import {types} from 'node:util';
import {exactData} from '../src/features/pq-transaction/transfer-binding.mjs';
import {createOriginalPQHostSource} from '../src/wallet-pq-original-source.mjs';

test('SourceOwner normal handoff derives exact six-field request only from the validated saved original',()=>{
 const actual=selection.preparePQHostCatalogBinding(original,binding);
 const {version,...request}=JSON.parse(selection.preparePQHostSelectionRequest(original,binding).stdin);
 assert.deepEqual(actual,{...request,originalHash:'0x'+request.nativeWireHash});
 assert.equal(Object.keys(actual).length,6);assert.equal(Object.hasOwn(actual,'version'),false);
 assert(Object.isFrozen(actual));assert(Buffer.byteLength(JSON.stringify(actual))<=4096);
});

// PUBLIC controlled facade boundary only. The actual source is evaluated in the
// same realm with its single fixed import replaced; no Native identity, Source
// enrollment, Protocol binary, Root or permission is minted by these fixtures.
async function sourceFixture(){
 const events=[],owner=Object.freeze({PUBLIC:'not a Native owner'}),pair={catalogPath:'/PUBLIC/catalog.json',catalogSha256:'a'.repeat(64)};
 let locked=false,revoked=false,instanceId='PUBLIC-instance',readError=null,readErrorPresent=false,saveError=false,held=false,closeError=false,joinError=false,acquireError=null,recognized=true;
 const guard={account:binding.account,assert(){if(locked)throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}};
 const native={
  acquireOriginalPQHostCatalogSource(){events.push('acquire');if(acquireError)throw acquireError;return owner;},
  isOriginalPQHostCatalogSource(value){return value===owner&&recognized;},
  readOriginalPQHostCatalogHandoff(value,six){assert.equal(value,owner);assert.deepEqual(six,selection.preparePQHostCatalogBinding(original,binding));events.push('read');if(readErrorPresent)throw readError;return pair;},
  assertOriginalPQHostCatalogSourceCurrent(value,six){assert.equal(value,owner);assert.deepEqual(six,selection.preparePQHostCatalogBinding(original,binding));events.push('current');},
  observeOriginalPQHostCatalogSourceRevocation(){return{version:'YNX-PQ-HOST-CATALOG-SOURCE-OBSERVATION/v1',sourceId:'PUBLIC-source',instanceId,retired:false,revoked,current:!revoked,unknown:false,dataOnly:true,authorized:false};},
  retireOriginalPQHostCatalogSource(){events.push('retire');},joinOriginalPQHostCatalogSource(){events.push('join');if(joinError)throw Object.assign(Error('PUBLIC child active'),{code:'PUBLIC_CHILD_ACTIVE'});},
  closeOriginalPQHostCatalogSource(){events.push('close');if(closeError)throw false;},readOriginalPQHostCatalogSourceStatus(){return{PUBLIC:true};}
 };
 const receiver={receive(six,result){assert.deepEqual(six,selection.preparePQHostCatalogBinding(original,binding));assert.deepEqual(result,pair);events.push('receive');if(saveError){held=true;throw Object.assign(Error('PUBLIC storage UNKNOWN'),{code:'PUBLIC_STORAGE_UNKNOWN'});}},select(){events.push('select');if(held)throw Error('PUBLIC held');return pair;},pending:()=>held,reconcile(){events.push('reconcile');held=false;},assertSafeToClose(){if(held)throw Error('PUBLIC held');}};
 const raw=await fs.readFile(new URL('../src/wallet-pq-original-source.mjs',import.meta.url),'utf8');
 const fixed="const loadOriginalPQHostCatalogSource=()=>import('../../../packages/wallet-auth/src/original-pq-host-catalog-source.js');";
 assert(raw.includes(fixed));
 const create=Function('types','exactData','preparePQHostCatalogBinding','loadOriginalPQHostCatalogSource',raw.replace(/^import .*;\n/gm,'').replace(fixed,'').replace(/^export /gm,'')+'\nreturn createOriginalPQHostSource;')(types,exactData,selection.preparePQHostCatalogBinding,async()=>native);
 return{source:create({original,binding,receiver}),guard,events,owner,receiver,pair,lock:()=>{locked=true;},revoke:()=>{revoked=true;},changeInstance:()=>{instanceId='PUBLIC-replacement';},readError:value=>{readErrorPresent=true;readError=value;},saveError:()=>{saveError=true;},closeError:()=>{closeError=true;},joinError:value=>{joinError=value;},partial:()=>{acquireError=Object.assign(Error('PUBLIC partial'),{partial:owner});},unrecognized:()=>{recognized=false;},afterRead:fn=>{const read=native.readOriginalPQHostCatalogHandoff;native.readOriginalPQHostCatalogHandoff=(...args)=>{const result=read(...args);fn();return result;};}};
}
test('controlled normal Source handoff actually invokes receive before selection and retains the same private owner',async()=>{
 const f=await sourceFixture();await f.source.acquire(f.guard);assert.deepEqual(f.source.catalog(),f.pair);
 assert(f.events.indexOf('read')<f.events.indexOf('receive'));assert(f.events.indexOf('receive')<f.events.indexOf('select'));
 assert.throws(()=>f.source.assertSafeToClose());f.source.retire();await f.source.join();await f.source.close();f.source.assertSafeToClose();
 assert.equal(f.events.filter(x=>x==='acquire').length,1);assert.equal(f.events.filter(x=>x==='read').length,1);
});
test('controlled original source retirement after handoff preserves returned DATA but never publishes a catalog lease',async()=>{
 const f=await sourceFixture();f.afterRead(f.lock);await assert.rejects(f.source.acquire(f.guard),{code:'PUBLIC_LOCKED'});
 assert(f.events.includes('receive'));assert.throws(()=>f.source.catalog());f.source.retire();await f.source.close();f.source.assertSafeToClose();
 assert.equal(f.events.filter(x=>x==='read').length,1);
});
test('controlled partial Native custody is retained for original cleanup after acquisition failure',async()=>{
 const f=await sourceFixture();f.partial();await assert.rejects(f.source.acquire(f.guard),/PUBLIC partial/);assert.throws(()=>f.source.assertSafeToClose());
 f.source.retire();await f.source.close();f.source.assertSafeToClose();assert(f.events.includes('close'));assert(!f.events.includes('read'));
});
test('controlled unrecognized copied owner cannot call read or escape cleanup debt',async()=>{
 const f=await sourceFixture();f.unrecognized();await assert.rejects(f.source.acquire(f.guard),{code:'PQ_HOST_ORIGINAL_SOURCE_OWNER_REQUIRED'});
 assert(!f.events.includes('read'));await assert.rejects(f.source.close(),{code:'PQ_HOST_ORIGINAL_SOURCE_OWNER_REQUIRED'});assert.throws(()=>f.source.assertSafeToClose());
});
test('controlled unknown registrar outcome cannot be retried or discarded by closing its resource',async()=>{
 const f=await sourceFixture();f.readError(false);await assert.rejects(f.source.acquire(f.guard),error=>error===false);
 await f.source.close();assert.throws(()=>f.source.assertSafeToClose());assert.throws(()=>f.source.save(f.guard),{code:'PQ_HOST_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'});
 await assert.rejects(f.source.acquire(f.guard),{code:'PQ_HOST_ORIGINAL_SOURCE_ALREADY_ENTERED'});assert.equal(f.events.filter(x=>x==='read').length,1);
});
test('same original child later exits: confirmed cleanup closes resource but keeps first cleanup cause and UNKNOWN read debt',async()=>{
 const f=await sourceFixture();f.readError(false);await assert.rejects(f.source.acquire(f.guard),error=>error===false);
 f.joinError(true);await assert.rejects(f.source.close(),{code:'PUBLIC_CHILD_ACTIVE'});assert.equal(f.source.status().closed,false);assert(!f.events.includes('close'));
 f.joinError(false);await f.source.close();assert.equal(f.source.status().closed,true);assert.equal(f.source.status().cleanupCausePresent,true);
 assert.throws(()=>f.source.assertSafeToClose());assert.throws(()=>f.source.save(f.guard),{code:'PQ_HOST_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'});assert.equal(f.events.filter(x=>x==='read').length,1);assert.equal(f.events.filter(x=>x==='acquire').length,1);
});
test('controlled receive UNKNOWN permits only same-byte local reconciliation, never another registrar call',async()=>{
 const f=await sourceFixture();f.saveError();await assert.rejects(f.source.acquire(f.guard),{code:'PUBLIC_STORAGE_UNKNOWN'});await f.source.close();assert.throws(()=>f.source.assertSafeToClose());
 assert.equal(f.source.save(f.guard).canRetry,false);f.source.assertSafeToClose();assert(f.events.includes('reconcile'));assert.equal(f.events.filter(x=>x==='read').length,1);
});
test('controlled revocation or instance replacement stays sticky and close failure retains original debt',async()=>{
 for(const change of ['revoke','changeInstance']){const f=await sourceFixture();await f.source.acquire(f.guard);f[change]();assert.throws(()=>f.source.assertCurrent(f.guard),{code:'PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID'});assert.equal(f.source.status().unknown,true);assert.throws(()=>f.source.catalog());await f.source.close();f.source.assertSafeToClose();}
 const f=await sourceFixture();await f.source.acquire(f.guard);f.closeError();await assert.rejects(f.source.close(),error=>error===false);assert.throws(()=>f.source.assertSafeToClose());assert.equal(f.events.filter(x=>x==='acquire').length,1);
});
test('actual production source has no loader option and a locked guard refuses before Native or receiver entry',async()=>{
 let writes=0;const source=createOriginalPQHostSource({original,binding,receiver:{receive(){writes++;},pending:()=>false,assertSafeToClose(){}},loader:()=>{throw Error('must not be used');}});
 await assert.rejects(source.acquire({account:binding.account,assert(){throw Object.assign(Error('PUBLIC locked'),{code:'PUBLIC_LOCKED'});}}),{code:'PUBLIC_LOCKED'});assert.equal(writes,0);await source.close();source.assertSafeToClose();
});
test('SourceOwner normal handoff refuses a changed original or network before any resource acquisition',()=>{
 for(const value of [{...original,hash:'0x'+'0'.repeat(64)},{...original,operationId:''},{...original,account:'PUBLIC-not-an-account'}])assert.throws(()=>selection.preparePQHostCatalogBinding(value,binding),error=>error instanceof Error&&!(error instanceof TypeError));
 assert.throws(()=>selection.preparePQHostCatalogBinding(original,{...binding,account:'0x'+'f'.repeat(40)}),error=>error instanceof Error&&!(error instanceof TypeError));
});
