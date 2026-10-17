import test from 'node:test';
import assert from 'node:assert/strict';
import {createPQKeyPreparationSource} from '../src/wallet-pq-key-source.mjs';
const binding=Object.freeze({account:'TEST-PUBLIC-ACCOUNT',network:'a'.repeat(64)}),network=Object.freeze({chainId:binding.network,owner:'TEST-PUBLIC-OWNER'});
function fixture(){
 let locked=false,created=0,restored=0,saved=0,read=0,verified=0,lastExpected;
 const handle=Object.freeze({TEST_ONLY_SECRET_HANDLE:true}),pub=Object.freeze({...network,pkA:'TEST-public-A',pkB:'TEST-public-B'}),receipt=Object.freeze({TEST_ONLY_RECEIPT:true});
 const guard={account:binding.account,assert(){if(locked)throw Error('TEST locked');}};
 const sdk={validatePQNetworkBinding:n=>Object.freeze({...n}),createPQWalletKeyHandle:async n=>{assert.deepEqual(n,network);created++;return handle;},readPQWalletKeyPublic:h=>{assert.equal(h,handle);return pub;},restorePQWalletKeyHandle:async(wire,credential,expected)=>{assert.equal(credential,'TEST-credential');assert.equal(wire[0],7);lastExpected=expected;restored++;return handle;},assertPQPublicBindingMatches(a,b){assert.deepEqual(a,b);return a;}};
 const repository={saveKeys:async o=>{guard.assert();assert.equal(o.handle,handle);assert.deepEqual(o.publicBinding,pub);saved++;return receipt;},readKeys:async()=>{read++;return receipt;},verifySavedKeys:async o=>{verified++;return o.handle===handle&&o.receipt===receipt;}};
 const dependencies={sdk,repository,getOriginalNetwork:async()=>network,getRegisteredBinding:async()=>pub,readRestoreInput:async()=>({wire:Uint8Array.of(7),credential:'TEST-credential',expectedBinding:{owner:'UNTRUSTED_FILE_OWNER'}})};
 return {dependencies,sdk,repository,guard,handle,pub,receipt,source:()=>createPQKeyPreparationSource(dependencies),lock:()=>locked=true,unlock:()=>locked=false,counts:()=>({created,restored,saved,read,verified,lastExpected})};
}
test('PQ App adapter uses actual SDK ABI names, fixed network and protected repository',async()=>{
 const f=fixture(),s=f.source(),material=await s.prepare('generate',{binding,guard:f.guard});
 assert.deepEqual(Object.keys(material),[]);assert.equal(s.selectOriginal(material,x=>x.handle),f.handle);
 const args={binding,operationId:'TEST-op',guard:f.guard},receipt=await s.persist(material,args);assert.equal(await s.verifyPersisted(material,receipt,args),true);
 assert.equal(f.counts().created,1);assert.equal(f.counts().saved,1);
});
test('PQ App restoration cannot trust expected keys supplied in the backup input',async()=>{
 const f=fixture(),s=f.source(),material=await s.prepare('restore',{binding,guard:f.guard});
 assert.equal(f.counts().lastExpected,f.pub);assert.equal(s.selectOriginal(material,x=>x.handle),f.handle);assert.equal(f.counts().created,0);
});
test('PQ SDK late generated handle reaches custody without a post-await throw hiding it',async()=>{
 const f=fixture();f.sdk.createPQWalletKeyHandle=async()=>{f.lock();return f.handle;};const s=f.source();
 const material=await s.prepare('generate',{binding,guard:f.guard});assert.equal(s.selectOriginal(material,x=>x.handle),f.handle);
 await assert.rejects(s.persist(material,{binding,operationId:'TEST-op',guard:f.guard}));assert.equal(f.counts().saved,0);
});
test('PQ App adapter rejects network mismatch before entering the SDK',async()=>{
 const f=fixture(),s=f.source();await assert.rejects(s.prepare('generate',{binding:{...binding,network:'b'.repeat(64)},guard:f.guard}),{code:'PQ_KEY_BINDING_CHANGED'});assert.equal(f.counts().created,0);
});
test('PQ App adapter rejects a mismatched original registration before decrypting',async()=>{
 const f=fixture();f.dependencies.getRegisteredBinding=async()=>({...f.pub,owner:'WRONG'});const s=f.source();await assert.rejects(s.prepare('restore',{binding,guard:f.guard}),{code:'PQ_KEY_BINDING_CHANGED'});assert.equal(f.counts().restored,0);
});
test('PQ App read-only reconciliation uses the same handle, never re-generates or saves',async()=>{
 const f=fixture(),s=f.source(),args={binding,operationId:'TEST-op',guard:f.guard},material=await s.prepare('generate',args);
 const receipt=await s.reconcile(material,args);assert.equal(await s.verifyPersisted(material,receipt,args),true);assert.equal(f.counts().created,1);assert.equal(f.counts().saved,0);assert.equal(f.counts().read,1);
});
test('PQ renderer-shaped objects cannot replace main-retained originals',async()=>{
 const f=fixture(),s=f.source(),args={binding,operationId:'TEST-op',guard:f.guard};await assert.rejects(s.persist({handle:f.handle},args),{code:'PQ_ORIGINAL_KEY_HANDLE_REQUIRED'});assert.equal(f.counts().saved,0);
});
