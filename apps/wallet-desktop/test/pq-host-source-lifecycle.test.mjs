import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
// Explicit PUBLIC orchestration fixtures, not genuine cryptographic processes,
// Native owners, independent Source qualification or consensus authority.
async function fixture({acquireFailure=false,closeFailure=false,childHeld=false}={}){
 const raw=await fs.readFile(new URL('../src/wallet-pq-finality-verification.mjs',import.meta.url),'utf8');
 const events=[],original={account:'PUBLIC-account',hash:'PUBLIC-hash',operationId:'PUBLIC-operation',kind:'pq-transfer'},binding={account:original.account},guard={account:original.account,assert(){}};
 let closed=false,acquired=false,released=!childHeld,resolveChild;const childDone=new Promise(resolve=>{resolveChild=resolve;});if(released)resolveChild();
 let resolveSaved;const saved=new Promise(resolve=>{resolveSaved=resolve;});
 const source={async acquire(){events.push('source-acquire');acquired=true;if(acquireFailure)throw false;},assertCurrent(){assert(acquired);assert(!closed);events.push('source-current');},catalog:()=>({PUBLIC:'catalog'}),retire(){events.push('source-retire');},async join(){events.push('source-join');},async close(){events.push('source-close');if(closeFailure)throw false;closed=true;},assertSafeToClose(){if(!closed)throw Error('PUBLIC source debt');},save(){events.push('source-save');}};
 const child=name=>({retire(){events.push(name+'-retire');},async join(){events.push(name+'-join');await childDone;},assertSafeToClose(){if(!released)throw Error('PUBLIC child held');}});
 const selector={...child('selector'),async run(g){g.assert();events.push('select');return{PUBLIC:'selection'};}};
 const host={...child('host'),async acquire(g){g.assert();events.push('host');},async withContext(g,action){g.assert();const result=await action({},g);g.assert();events.push('last-current');return result;}};
 const capture={...child('capture'),async run(){events.push('proof');return{observation:{status:'verifier-error-data'},journalRecord:{PUBLIC:true}};}};
 const context={createPQHostContextReference:()=>host,createPQFinalityVerifierCapture:()=>capture,supportsPackagedPQTypedFinality:()=>true,originalPQVerifierReceipt:{},preparePQFinalityOriginal:()=>{},createPQVerifiedFinalityTerminal:()=>{throw Error('no genuine terminal authority');}};
 runInNewContext(raw.replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nthis.create=createPQFinalityVerification;',context);
 const service=context.create({evidence:{assertSafeToClose(){}},createSource:()=>source,createSelection:(o,b,catalog)=>{assert.equal(o,original);assert.equal(b,binding);assert.equal(catalog.PUBLIC,'catalog');return selector;},createProducer:()=>({}),createVerifier:()=>({}),persistObservation:async()=>{events.push('save');resolveSaved();return{stored:true};},flushObservation:async()=>({stored:true})});
 return{events,service,original,binding,guard,saved,release(){released=true;resolveChild();}};
}
test('normal source owner remains held through selector, Host, proof, journal and all child joins',async()=>{
 const f=await fixture({childHeld:true});let settled=false;
 const work=f.service.verify(f.original,f.binding,{},f.guard).then(value=>{settled=true;return value;});
 await f.saved;
 assert(f.events.includes('save'));assert(!settled);assert(!f.events.includes('source-close'));assert.throws(()=>f.service.assertSafeToClose());
 await assert.rejects(f.service.save(f.original,f.binding,f.guard),{code:'PQ_FINALITY_NO_HELD_EVIDENCE'});
 f.release();const value=await work;assert.equal(value.nativeGrant,false);
 for(const name of ['selector','host','capture'])assert(f.events.indexOf(name+'-join')<f.events.indexOf('source-close'));
 assert(f.events.filter(event=>event==='source-current').length>=4);f.service.assertSafeToClose();
});
test('normal source acquisition failure does not construct selection or Host and cleans only original partial custody',async()=>{
 const f=await fixture({acquireFailure:true});await assert.rejects(f.service.verify(f.original,f.binding,{},f.guard),error=>error===false);
 assert(!f.events.includes('select'));assert(!f.events.includes('host'));assert(f.events.includes('source-close'));f.service.assertSafeToClose();
});
test('normal source cleanup failure blocks success and new verification without reacquisition',async()=>{
 const f=await fixture({closeFailure:true});await assert.rejects(f.service.verify(f.original,f.binding,{},f.guard),error=>error===false);
 assert(f.service.pending());assert.throws(()=>f.service.assertSafeToClose());
 await assert.rejects(f.service.verify(f.original,f.binding,{},f.guard),{code:'PQ_FINALITY_VERIFICATION_UNCONFIRMED'});
 assert.equal(f.events.filter(event=>event==='source-acquire').length,1);assert.equal(f.events.filter(event=>event==='proof').length,1);
 await assert.rejects(f.service.join(),error=>error===false);assert(f.service.pending());
});
