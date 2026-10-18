import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canonicalJSON} from '../src/canonical.js';
import {decodeOriginalWalletServicePrivateRequest} from '../src/original-wallet-service-private-dispatch.js';
import {originalPrivateReferenceBudget,sameOriginalReferenceCompletion} from '../src/original-wallet-service-private-reference.js';
const fixture=JSON.parse(readFileSync(new URL('../testdata/private-reference-carrier-r29a.json',import.meta.url),'utf8'));
// Exact supplier raw strings, not re-encoded substitutes. Public structural
// vectors deliberately have no valid request/signature or Native admission.
test('same eight Native/SDK byte vectors distinguish raw framing from authenticated registration',()=>{
 for(const vector of fixture.vectors){
  const shapeOnly=vector.budget>0||['noncanonical_outer','no_profile_registration'].includes(vector.name),rawOnly=vector.budget>0||vector.name==='no_profile_registration',value=JSON.parse(vector.raw);
  if(shapeOnly){const budget=originalPrivateReferenceBudget(value);assert.equal(budget.envelope,65536,vector.name);assert.equal(budget.reference,true);assert.equal('granted' in budget,false);}else assert.throws(()=>originalPrivateReferenceBudget(value),undefined,vector.name);
  if(rawOnly){const decoded=decodeOriginalWalletServicePrivateRequest(vector.raw);assert.equal(decoded.referenceAction,value.referenceAction,vector.name);}else assert.throws(()=>decodeOriginalWalletServicePrivateRequest(vector.raw),undefined,vector.name);
  if(vector.name==='no_profile_registration'){assert.equal(vector.registered,false);assert.equal(vector.budget,0);/* Actual Native Source gate, not this pure parser, denies this case. */}
 }
});
test('only distinct exact-original complete/outcome can match reconciliation framing, never challenge or write replay',()=>{
 const write=JSON.parse(fixture.vectors.find(x=>x.name==='structural_complete').raw),read={...write,requestId:'req_native_readonly_new01',referenceAction:'outcome'};
 assert.equal(sameOriginalReferenceCompletion(write,read),true);
 for(const changed of [{...read,requestId:write.requestId},{...read,referenceAction:'complete'},{...read,body:canonicalJSON({...JSON.parse(read.body),reference:'ynxpsr1_'+'x'.repeat(43)})},{...read,proofHeader:'arbitrary'}])assert.equal(sameOriginalReferenceCompletion(write,changed),false);
});
