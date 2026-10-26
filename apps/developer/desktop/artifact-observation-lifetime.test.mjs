import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtifactPublicationHost} from './artifact-publication-host.mjs';
const id='11111111-2222-4333-8444-555555555555';
const next='22222222-3333-4444-8555-666666666666';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
test('an explicit retry after a failed factory acquires a fresh owner',async()=>{
 let opens=0,closes=0;const failure=Error('first acquisition failed');
 const h=createArtifactPublicationHost({context:{},openObservation:async()=>{if(++opens===1)throw failure;return{resume:async()=>({queryOnly:true}),close:async()=>{closes++;}};}});
 await assert.rejects(h.observe(id),e=>e===failure);
 assert.deepEqual(await h.observe(id),{queryOnly:true});assert.equal(opens,2);assert.equal(closes,1);await h.close();
});
test('each explicit query closes its own read permission and never reuses it',async()=>{
 let opens=0,closes=0;const h=createArtifactPublicationHost({context:{},openObservation:async()=>{const owner=++opens;return{resume:async()=>({owner}),close:async()=>{closes++;}};}});
 assert.equal((await h.observe(id)).owner,1);assert.equal(closes,1);
 assert.equal((await h.observe(next)).owner,2);assert.equal(closes,2);await h.close();assert.equal(closes,2);
});
test('cancelled late acquisition cannot run and blocks replacement until cleaned',async()=>{
 const entered=deferred(),held=deferred();let opens=0,resumes=0,closes=0;
 const h=createArtifactPublicationHost({context:{},openObservation:()=>{opens++;entered.resolve();return held.promise;}});
 const reading=h.observe(id,{observationId:next}),rejected=assert.rejects(reading,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await entered.promise;
 await h.cancelObservation(next);await rejected;
 await assert.rejects(h.observe(id));assert.equal(opens,1);
 held.resolve({resume:async()=>{resumes++;},close:async()=>{closes++;}});await tick();
 assert.equal(resumes,0);assert.equal(closes,1);await h.close();assert.equal(closes,1);
});
test('cleanup failure stays selected and blocks new owner without retrying close',async()=>{
 let opens=0,closes=0;const h=createArtifactPublicationHost({context:{},openObservation:async()=>{opens++;return{resume:async()=>({}),close:async()=>{closes++;throw false;}};}});
 await assert.rejects(h.observe(id),e=>e===false);await assert.rejects(h.observe(next),e=>e===false);
 await assert.rejects(h.close(),e=>e===false);await assert.rejects(h.close(),e=>e===false);assert.equal(opens,1);assert.equal(closes,1);
});
test('query first cause survives cleanup failure and cleanup debt remains',async()=>{
 const original=Error('query failed');let closes=0;
 const h=createArtifactPublicationHost({context:{},openObservation:async()=>({resume:async()=>{throw original;},close:async()=>{closes++;throw false;}})});
 await assert.rejects(h.observe(id),e=>e===original);await assert.rejects(h.observe(next),e=>e===false);await assert.rejects(h.close(),e=>e===false);assert.equal(closes,1);
});
test('malformed request identifiers cannot acquire an observer',async()=>{
 let opens=0;const h=createArtifactPublicationHost({context:{},openObservation:async()=>{opens++;return{resume:async()=>{},close:async()=>{}};}});
 await assert.rejects(h.observe('bad request'));assert.equal(opens,0);await h.close();
});

test('closing during a held query joins cleanup and never grants a second query',async()=>{
 const entered=deferred(),held=deferred(),cleaned=deferred();let closes=0;
 const h=createArtifactPublicationHost({context:{},openObservation:async()=>({resume:()=>{entered.resolve();return held.promise;},close:async()=>{closes++;await cleaned.promise;}})});
 const read=h.observe(id),rejected=assert.rejects(read,{code:'IDE_PUBLICATION_NOT_SUPPLIED'});await entered.promise;
 let closed=false;const closing=h.close().then(()=>closed=true);
 await rejected;held.resolve({late:true});await tick();assert.equal(closes,1);assert.equal(closed,false);
 await assert.rejects(h.observe(next));cleaned.resolve();await closing;assert.equal(closed,true);await h.close();assert.equal(closes,1);
});
test('cancel targets only its observation and an uncooperative query cannot regain permission',async()=>{
 const entered=deferred(),held=deferred();let opens=0,closes=0;
 const h=createArtifactPublicationHost({context:{},openObservation:async()=>{opens++;return{resume:()=>{entered.resolve();return held.promise;},close:async()=>{closes++;}};}});
 const read=h.observe(id,{observationId:next}),rejected=assert.rejects(read,{code:'IDE_PUBLICATION_OBSERVATION_CANCELLED'});await entered.promise;
 assert.equal((await h.cancelObservation(id)).cancelled,false);
 assert.equal((await h.cancelObservation(next)).cancelled,true);await rejected;
 await assert.rejects(h.observe(id));assert.equal(opens,1);
 held.resolve({late:true});await tick();assert.equal(closes,1);await h.close();
});
test('factory receives only the fixed local context and a malformed owner is retained for cleanup',async()=>{
 const context=Object.freeze({id:'PUBLIC-local',workspace:'/PUBLIC/workspace'});let closes=0;
 const h=createArtifactPublicationHost({context,openObservation:async(...args)=>{assert.deepEqual(args,[context]);return{close:async()=>{closes++;}};}});
 await assert.rejects(h.observe(id),{code:'IDE_PUBLICATION_NOT_SUPPLIED'});assert.equal(closes,1);await h.close();
});

test('host close joins a late factory and reports cleanup rather than its retired query error',async()=>{
 const entered=deferred(),held=deferred();let resumes=0,closes=0;
 const h=createArtifactPublicationHost({context:{},openObservation:()=>{entered.resolve();return held.promise;}});
 const read=h.observe(id),rejected=assert.rejects(read,{code:'IDE_PUBLICATION_NOT_SUPPLIED'});await entered.promise;
 const closing=h.close();await rejected;
 held.resolve({resume:async()=>{resumes++;},close:async()=>{closes++;}});
 await closing;assert.equal(closes,1);assert.equal(resumes,0);
});
