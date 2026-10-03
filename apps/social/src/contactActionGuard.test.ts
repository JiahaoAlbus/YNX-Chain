import assert from 'node:assert/strict';
import test from 'node:test';
import {runCurrentContactAction} from './contactActionGuard';

test('stale reviewed alert cannot send under a newer account',async()=>{
 let generation=1,calls=0;const reviewed=generation;generation=2;
 assert.equal(await runCurrentContactAction(()=>generation===reviewed,async()=>{calls++}),false);
 assert.equal(calls,0);
});
test('current explicit action sends once and confirms current readback eligibility',async()=>{
 let calls=0;assert.equal(await runCurrentContactAction(()=>true,async()=>{calls++}),true);assert.equal(calls,1);
});
test('late success cannot refresh the next account',async()=>{
 let current=true,finish!:(value:unknown)=>void;
 const pending=runCurrentContactAction(()=>current,()=>new Promise(resolve=>{finish=resolve}));
 current=false;finish({});assert.equal(await pending,false);
});
test('late failure cannot replace the next account status',async()=>{
 let current=true,fail!:(error:Error)=>void;
 const pending=runCurrentContactAction(()=>current,()=>new Promise((_,reject)=>{fail=reject}));
 current=false;fail(new Error('old account transport failure'));assert.equal(await pending,false);
});
test('current failure is not hidden as success',async()=>{
 await assert.rejects(runCurrentContactAction(()=>true,async()=>{throw new Error('unconfirmed delivery')}),/unconfirmed/);
});
test('ignored abort is bounded without claiming server rollback',async()=>{
 let signal:AbortSignal|undefined;
 await assert.rejects(runCurrentContactAction(()=>true,async value=>{signal=value;return new Promise(()=>{})},5),/delivery is not confirmed/);
 assert.equal(signal?.aborted,true);
});
