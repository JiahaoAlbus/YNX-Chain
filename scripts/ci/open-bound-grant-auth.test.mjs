// New shared-wire integration against the actual original Auth policy code.
// Source, proof acceptance, signing, stores and resource effects are PUBLIC
// fixtures, not production adapters or real cryptographic/Shop acceptance.
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{pathToFileURL}from'node:url';
import*as codec from'../../packages/open-protocol/src/bound-grant.js';
const authPath=new URL('./fixtures/open-bound-grant-original-auth/original-bound-grant-policy.mjs',import.meta.url);
const{OriginalBoundGrantPolicyKernel:Kernel,bindGrantBytesDATA}=await import(authPath);
const vector=JSON.parse(fs.readFileSync(new URL('../../packages/open-protocol/test/fixtures/bound-grant-v1.json',import.meta.url))).vectors[0],clone=structuredClone;
function fixture(){
 const g=clone(vector.grant),issuerProof=Object.freeze({PUBLIC:'original-issuer-proof-fixture'}),holderProof=Object.freeze({PUBLIC:'original-holder-proof-fixture'}),counts={sign:0,dispatch:0,reservations:0,holderVerification:0,captured:0,commitAuthority:0},issuance={entered:false,binding:null,original:null},effects=new Map();
 const state={observedAt:'1000',expires:'10000',policyRevision:'7',issuer:{ref:g.issuer,epoch:g.issuerEpoch,kind:'human',status:'active',registered:true},holder:{ref:g.holder,epoch:g.holderEpoch,status:'active'},task:{ref:g.binding.task,status:'READY',generation:g.binding.generation,holder:g.holder,holderEpoch:g.holderEpoch},session:{status:'active',holder:g.holder,holderEpoch:g.holderEpoch,binding:g.binding.holderSession},catalog:{id:g.binding.tool.id,version:g.binding.tool.version,schema:g.binding.tool.schema,status:'active',audience:g.audience,operation:g.operation,purpose:g.binding.purpose,risk:g.binding.risk,egress:false},authorizedResources:g.resources,sources:g.binding.sources,grant:{status:'active',rev:g.rev,value:g},budget:{status:'ready',cap:g.cap,spent:'2',reserved:'1',requested:'1'}};
 const independentlyHeld=clone(state);let effectState='COMMITTED';
 const approval=grant=>({id:grant.approvalId,principal:grant.issuer,principalKind:'human',purpose:'AUTH-GRANT-ISSUE',grantId:grant.id,grantRevision:grant.rev,binding:bindGrantBytesDATA(codec.encodeBoundGrant(grant)),expires:'8000',nonce:'legacy-approval-nonce'});
 const freshHeld=()=>({fenceKind:'SAME_RESOURCE_TRANSACTION',assertCurrent(){},readCurrent:()=>clone(independentlyHeld),assertGrantAuthorityAtCommit(expected){counts.commitAuthority++;assert.equal(expected.policyRevision,independentlyHeld.policyRevision);assert.equal(expected.generation,independentlyHeld.task.generation);assert.deepEqual(expected.task,independentlyHeld.task.ref);assert.deepEqual(expected.session,independentlyHeld.session.binding);},retire(){},join(){},close(){},
  verifyIssuerApproval(a,terms){assert.deepEqual(a.binding,bindGrantBytesDATA(terms));},verifyIssuerProof(p,terms){assert.equal(p,issuerProof);assert.deepEqual(Buffer.from(terms),Buffer.from(codec.encodeBoundGrant(independentlyHeld.grant.value)));},
  signBoundGrant(){counts.sign++;return{original:Object.freeze({PUBLIC:'typed-signer-original'}),errorPresent:false}},verifyIssuedGrant(_g,original,terms){assert.equal(original.PUBLIC,'typed-signer-original');assert.deepEqual(Buffer.from(terms),Buffer.from(codec.encodeBoundGrant(independentlyHeld.grant.value)));},
  verifyGrantProof(grant){assert(issuance.original);assert.deepEqual(issuance.binding,bindGrantBytesDATA(codec.encodeBoundGrant(grant)));},verifyHolderProof(p,bytes){assert.equal(p,holderProof);counts.holderVerification++;assert.deepEqual(Buffer.from(bytes),Buffer.from(codec.encodeGrantEffect(independentlyHeld.grant.value,independentlyHeld.grant.value.binding)));},
  verifyDisclosureAtEffect(){},
  commitAtEffectFence(expected,check){
   check(clone(independentlyHeld));
   // PUBLIC same-resource fixture derives a stable logical slot; changed
   // input digests/request IDs do not create new resource slots.
   const slot=JSON.stringify([g.realm,g.tenant,expected.grantId,expected.grantRevision,expected.task,expected.generation,expected.stepId,expected.tool.id,expected.tool.version,expected.operation]),binding=bindGrantBytesDATA(codec.encodeGrantEffect(independentlyHeld.grant.value,independentlyHeld.grant.value.binding));
   if(effects.has(slot)){const prior=effects.get(slot);if(JSON.stringify(prior.binding)!==JSON.stringify(binding))throw Object.assign(Error('CONFLICT'),{code:'CONFLICT'});return prior.receipt}
   counts.dispatch++;counts.reservations++;const receipt=Object.freeze({state:effectState,scope:'same-resource-transaction',effectRef:'PUBLIC-original-order-effect'});effects.set(slot,{binding,receipt});return receipt;
  }
 });
 const source={acquireGrantIssuance:freshHeld,acquireGrantEffect:freshHeld},store={reserveGrantIssuanceOnce({binding}){if(issuance.entered){if(JSON.stringify(issuance.binding)!==JSON.stringify(binding))throw Object.assign(Error('CONFLICT'),{code:'CONFLICT'});return{recoveryOnly:true,original:issuance.original}}issuance.entered=true;issuance.binding=clone(binding);return{recoveryOnly:false,ticket:issuance}},captureSignedGrantOriginal(ticket,original){assert.equal(ticket,issuance);counts.captured++;issuance.original=original;},commitGrantIssuance(ticket,result,options){assert.equal(ticket,issuance);options.assertCurrent(result.expectedAuthority);issuance.original=result.original;return result.original}};
 return{g,state:independentlyHeld,issuerProof,holderProof,counts,issuance,approval,kernel:new Kernel(source,store,codec,()=>2000),setEffectState:s=>{effectState=s}};
}
test('new real shared ports replace PUBLIC JSON codec in actual Auth issuance to holder proof to final shop-read fixture fence',async()=>{
 const f=fixture(),issued=await f.kernel.signBoundGrant(f.g,f.approval(f.g),f.issuerProof);assert.equal(issued.newGrant,true);assert.equal(issued.sourceAdmission,false);const result=await f.kernel.authorizeAtEffect(f.g,f.g.binding,f.holderProof,f.g.rev);assert.equal(result.state,'COMMITTED');assert.equal(f.counts.sign,1);assert.equal(f.counts.captured,1);assert.equal(f.counts.commitAuthority,1);assert.equal(f.counts.holderVerification,1);assert.equal(f.counts.dispatch,1);
});
test('actual Auth with shared codec keeps UNKNOWN original semantic slot and changed terms cannot reissue or redispatch',async()=>{
 const f=fixture();await f.kernel.signBoundGrant(f.g,f.approval(f.g),f.issuerProof);f.setEffectState('UNKNOWN');const first=await f.kernel.authorizeAtEffect(f.g,f.g.binding,f.holderProof,f.g.rev),second=await f.kernel.authorizeAtEffect(f.g,f.g.binding,f.holderProof,f.g.rev);assert.strictEqual(first,second);assert.equal(first.state,'UNKNOWN');assert.equal(f.counts.dispatch,1);assert.equal(f.counts.reservations,1);
 const changed=clone(f.g);changed.binding.input.sha512='c'.repeat(128);f.state.grant.value=clone(changed);await assert.rejects(f.kernel.signBoundGrant(changed,f.approval(changed),f.issuerProof),e=>e.cause?.code==='CONFLICT');assert.equal(f.counts.sign,1);assert.equal(f.counts.dispatch,1);
});
test('codec DATA risk/wallet/VAULT acceptance does not bypass actual Auth policy or disclosure at the real kernel boundary',async()=>{
 for(const modify of [x=>{x.binding.risk='asset'},x=>{x.operation='wallet.approve'},x=>{x.binding.sources[0].label='VAULT'}]){const f=fixture();await f.kernel.signBoundGrant(f.g,f.approval(f.g),f.issuerProof);modify(f.g);codec.encodeBoundGrant(f.g);f.state.grant.value=clone(f.g);f.state.catalog.risk=f.g.binding.risk;f.state.catalog.operation=f.g.operation;f.state.sources=clone(f.g.binding.sources);await assert.rejects(f.kernel.authorizeAtEffect(f.g,f.g.binding,f.holderProof,f.g.rev));assert.equal(f.counts.dispatch,0)}
 const f=fixture();await f.kernel.signBoundGrant(f.g,f.approval(f.g),f.issuerProof);f.state.catalog.egress=true;await assert.rejects(f.kernel.authorizeAtEffect(f.g,f.g.binding,f.holderProof,f.g.rev),e=>e.cause?.code==='GRANT_DISCLOSURE_REQUIRED');assert.equal(f.counts.dispatch,0);
});
