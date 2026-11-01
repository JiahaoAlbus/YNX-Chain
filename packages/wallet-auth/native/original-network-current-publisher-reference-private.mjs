import {retainOriginalNetworkCurrentPublisherViewsV1} from './original-network-current-publisher-views-private.mjs';
import {encodeNetworkResourceCurrentWitnessStatementV1DATA} from './original-network-resource-current-witness-v1.mjs';
import {createRequire} from 'node:module';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {originalNetworkCurrentPublisherRows} from './original-network-current-publisher-selection-private.mjs';
import {NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE,NETWORK_CURRENT_PUBLISHER_SELECTION_KEY} from './original-network-current-publisher-source-contract.mjs';
const inventory=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code});};
function result(r){if(!r||!Object.hasOwn(r,'error')||Object.hasOwn(r,'errorPresent')&&typeof r.errorPresent!=='boolean')fail('NETWORK_PUBLISHER_NATIVE_RESULT');if(r.errorPresent===true||r.error!==null)throw r.error;}
function state(reference){const s=inventory.get(reference);if(!s)fail('NETWORK_CURRENT_REGISTERED_CAPTURE_REQUIRED');return s;}
function check(s){
 if(s.retired)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED');
 const now=Date.now();if(!Number.isSafeInteger(now)||now<0||now<s.clock)fail('NETWORK_PUBLISHER_CLOCK_ROLLBACK');s.clock=now;
 const original=s.capture.readOriginals(),i=s.capture.readFreshIssuerSourceInputs();
 if(!i||i.policy?.signatureContract?.purpose!==NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE||sha(i.rootRaw)!==s.row.rootDigest||sha(i.enrollmentRaw)!==s.row.enrollmentDigest||sha(i.profileRaw)!==s.row.profileDigest||canonical(i.policy)!==canonical(s.row.policy))fail('NETWORK_PUBLISHER_COMPILED_SELECTION_DIFFERS');
 const frozen=canonical({rootRaw:i.rootRaw,enrollmentRaw:i.enrollmentRaw,profileRaw:i.profileRaw,policy:i.policy});
 if(s.original!==undefined&&s.original!==frozen)fail('NETWORK_PUBLISHER_SOURCE_CAPTURE_CHANGED');
 const projection=verifyOriginalAuthSourceCurrentV2(i.rootRaw,i.enrollmentRaw,i.profileRaw,i.currentRaw,i.policy,i.registrations,i.expectedNonce,i.previous,now);
 const scope=projection.selection[NETWORK_CURRENT_PUBLISHER_SELECTION_KEY];
 if(canonical(scope.descriptor)!==canonical(original.descriptor)||i.registrations.current.owner!==original.registeredCurrent.owner||original.registeredCurrent.owner!==scope.subjectOwner)fail('NETWORK_PUBLISHER_DESCRIPTOR_OR_ROLE_CHANGED');
 if(s.views)for(const k of Object.keys(s.views))assertPQAuthorizationCurrent(s.views[k],i.registrations[k]);
 s.original=frozen;s.views={...i.registrations};s.projection=projection;
 return projection;
}
// Async physical current fence; completion is checked after every await.
export async function assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference){
 const s=state(reference);if(s.busy)fail('NETWORK_PUBLISHER_CAPTURE_BUSY');s.busy=true;
 try{if(s.retired)fail('NETWORK_PUBLISHER_CAPTURE_RETIRED');result(await s.capture.current());check(s);result(s.capture.assertCompletedCurrent());return check(s);}finally{s.busy=false;}
}
// The existing release-selected key loader must match the SAME commissioned
// whole entry, including key-file custody pins and original node selection.
export function assertOriginalNetworkCurrentPublisherLoaderEntryV1(reference,entry){
 const s=state(reference);check(s);
 if(typeof s.row.loaderEntryDigest!=='string'||!/^[a-f0-9]{64}$/.test(s.row.loaderEntryDigest)||sha(canonical(entry))!==s.row.loaderEntryDigest)fail('NETWORK_PUBLISHER_LOADER_ENTRY_NOT_SELECTED');
}
export function readOriginalNetworkCurrentPublisherRegisteredViewV1(reference){
 const s=state(reference);check(s);return s.capture.readOriginals().registeredCurrent;
}
// Fixed E8 only: even the private key adapter cannot sign arbitrary bytes.
export function assertOriginalNetworkCurrentPublisherMessageV1(reference,message,binding){
 const s=state(reference);check(s);const original=s.capture.readOriginals();
 if(canonical(binding)!==canonical(original.binding))fail('NETWORK_PUBLISHER_SIGNING_BINDING_CHANGED');
 const expected=encodeNetworkResourceCurrentWitnessStatementV1DATA(original.descriptor,original.binding,original.current9);
 if(!(message instanceof Uint8Array)||!Buffer.from(message).equals(Buffer.from(expected.messageOriginal)))fail('NETWORK_PUBLISHER_SIGNING_MESSAGE_CHANGED');
}
// Single receiver handoff. Merely importing this module cannot mint a brand.
export function readOriginalNetworkResourceCurrentPublisherReferenceV1(reference){
 const s=state(reference);check(s);if(s.claimed)fail('NETWORK_PUBLISHER_RECEIVER_ALREADY_SELECTED');s.claimed=true;
 return Object.freeze({capture:s.capture,store:s.store});
}
// No arguments, module overrides, provider callbacks, paths or public register.
// The fixed Native producer must retain partial capture/store before returning.
export async function acquireOriginalNetworkResourceCurrentPublisherReferenceV1(){
 if(arguments.length)fail('NETWORK_PUBLISHER_ZERO_INPUT');
 if(originalNetworkCurrentPublisherRows.length!==1)fail('NETWORK_CURRENT_NO_ROOT_SELECTION');
 const row=originalNetworkCurrentPublisherRows[0];
 const native=createRequire(import.meta.url)('../../../apps/wallet-desktop/native/original-auth-identity.node');
 if(typeof native.acquireOriginalNetworkCurrentPublisherCaptureV1!=='function')fail('NETWORK_PUBLISHER_NATIVE_CAPTURE_NOT_SUPPLIED');
 let reference,s;
 try{
  const r=await native.acquireOriginalNetworkCurrentPublisherCaptureV1();
  // Adopt the SAME partial first, even when Native reports a late error.
  if(r?.partial!==null&&r?.partial!==undefined){
   const {capture,store}=r.partial;s={capture,store,row,clock:-1,retired:false,busy:false,claimed:false,stage:0,closeSelected:false,closePromise:null};
   reference=Object.freeze({
    async retire(){s.retired=true;while(s.stage<2){result(await [()=>capture.retire(),()=>store.retire()][s.stage]());s.stage++;}},
    async join(){if(s.stage<2)fail('NETWORK_PUBLISHER_RETIRE_DEBT');while(s.stage<4){result(await [()=>capture.join(),()=>store.join()][s.stage-2]());s.stage++;}},
    close(){if(s.closeSelected)return s.closePromise;s.closeSelected=true;s.retired=true;return s.closePromise=(async()=>{if(s.stage<4)fail('NETWORK_PUBLISHER_DRAIN_DEBT');result(await store.close());s.stage=5;result(await capture.close());s.stage=6;})();}
   });inventory.set(reference,s);
  }
  result(r);if(!s)fail('NETWORK_PUBLISHER_NATIVE_CAPTURE_NOT_SUPPLIED');
  for(const [port,names] of [[s.capture,['current','assertCompletedCurrent','readOriginals','readFreshIssuerSourceInputs','clockMs','retainSigningIntentOnce','querySameOriginal','retire','join','close']],[s.store,['retainPublicationIntentOnce','publishOriginalPairOnce','readOriginalPair','querySameOriginal','retire','join','close']]])if(names.some(n=>typeof port?.[n]!=='function'))fail('NETWORK_PUBLISHER_NATIVE_PORT_NOT_SUPPLIED');
  s.capture=await retainOriginalNetworkCurrentPublisherViewsV1(s.capture,row);
  await assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference);return reference;
 }catch(error){if(reference)throw Object.freeze({code:'NETWORK_PUBLISHER_CAPTURE_ACQUIRE_FAILED',errorPresent:true,error,cause:error,partial:reference});throw error;}
}
