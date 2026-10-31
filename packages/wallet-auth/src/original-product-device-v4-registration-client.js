// Main-only normal registration orchestration. Fixed Native Source and Auth
// origin; no key, signer, dispatcher, provider, endpoint or approved setter.
import{types}from'node:util';
import{openOriginalProductSessionDeviceV4PendingProofClient}from'./original-product-device-v4-pending-client.js';
import{inspectOriginalProductDeviceV4PendingReviewDATA}from'./original-product-device-v4-pending-review-data.js';
import{createOriginalDeviceIdentityDATA}from'./original-device-create-intent.js';
import{verifyProductSessionApprovalV4Data,verifyProductSessionDeviceRegistrationProofV4Data}from'./product-session-pq-v4-codec.js';
import{captureVerifiedPQSessionApproval}from'./product-session-account-private.js';
import{ProductSessionGatewayFetchAdapter}from'./product-session-gateway-client.js';
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{parseProductSessionChallenge,productSessionApprovalDigest}from'./product-session-v2.js';
import registry from'../product-session-registry.json'with{type:'json'};
const origin='https://wallet-auth.ynxweb4.com',originalFetch=globalThis.fetch,packets=new WeakMap();
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,reason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason').get;
const ta=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(ta,'byteLength').get,bufferOf=Object.getOwnPropertyDescriptor(ta,'buffer').get,setBytes=Uint8Array.prototype.set;
const fail=c=>{throw new WalletAuthError(c,c);};
const record=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('DEVICE_REGISTRATION_EXACT_DATA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('DEVICE_REGISTRATION_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));};
const originalContext=v=>{if(!v||types.isProxy(v)||!Object.isFrozen(v))fail('DEVICE_REGISTRATION_ORIGINAL_ABORT_CONTEXT');const c=record(v,['signal']);let stop;try{stop=aborted.call(c.signal);}catch{fail('DEVICE_REGISTRATION_ORIGINAL_ABORT_CONTEXT');}if(stop)throw reason.call(c.signal);return v;};
const bytes=(v,n)=>{if(types.isProxy(v)||!types.isUint8Array(v)||types.isSharedArrayBuffer(bufferOf.call(v)))fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');const length=lengthOf.call(v);if(n?length!==n:!length||length>98304)fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');const out=Buffer.alloc(length);try{setBytes.call(out,v);}catch{fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');}return out;};
const parseOriginal=(raw,max)=>{if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>max)fail('DEVICE_REGISTRATION_ORIGINAL_REQUIRED');const v=JSON.parse(raw);if(canonicalJSON(v)!==raw)fail('DEVICE_REGISTRATION_CANONICAL_REQUIRED');return v;};

/** Zero input. A failure's original Native partial remains caller-owned.
 * Main must retain its independent account permission/current scope and durable
 * approval/whole-request journal before submitPreparedPair. This module does
 * not certify a caller's disk durability or provide cross-process replay rights.
 */
export async function openOriginalProductDeviceV4RegistrationClient(...args){
 if(args.length)fail('DEVICE_REGISTRATION_ZERO_INPUT');
 const pending=await openOriginalProductSessionDeviceV4PendingProofClient();
 const gateway=new ProductSessionGatewayFetchAdapter({endpoint:origin,fetch:(...a)=>originalFetch(...a),walletInstalled:async()=>false,schemeRegistered:async()=>false,timeoutMs:30000});
 const owner={};let review,selection,selected=false,closed=false,closing,prepareFlight,submitFlight,hasCause=false,firstCause,retainedMember=null,preparedRef=null,clockFloor=0;
 const remember=e=>{if(!hasCause){hasCause=true;firstCause=e;}};
 const alive=()=>{if(closed)fail('DEVICE_REGISTRATION_RETIRED');};
 const now=()=>{alive();const n=Date.now();if(!Number.isSafeInteger(n)||n<clockFloor)fail('DEVICE_REGISTRATION_CLOCK_ROLLBACK');clockFloor=n;return new Date(n);};
 const packet=ref=>{const p=packets.get(ref);if(!p||p.owner!==owner)fail('DEVICE_REGISTRATION_ORIGINAL_PACKET_REQUIRED');return p;};
 function readReview(independent){
  alive();if(selected)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');pending.assertCurrent();
  const i=record(independent,['identityBinding','generation','publicPair']),identity=createOriginalDeviceIdentityDATA(i.identityBinding),pair=record(i.publicPair,['pkA','pkB']),pkA=bytes(pair.pkA,2592).toString('hex'),pkB=bytes(pair.pkB,64).toString('hex');
  const view=inspectOriginalProductDeviceV4PendingReviewDATA(pending.readOriginalReview());pending.assertCurrent();
  if(view.scope.operation!=='registration-pop'||view.scope.expected.generation!==i.generation||view.record.pkA!==pkA||view.record.pkB!==pkB)fail('DEVICE_REGISTRATION_SELECTED_PAIR_MISMATCH');
  for(const k of ['networkId','canonicalOwner','account','productId','clientId','deviceId'])if(view.scope.expected[k]!==identity.identity[k])fail('DEVICE_REGISTRATION_SELECTED_IDENTITY_MISMATCH');
  for(const[k,v]of Object.entries(identity.applicationBinding))if(view.scope.expected[k]!==v)fail('DEVICE_REGISTRATION_SELECTED_APPLICATION_MISMATCH');
  // Independent Main identity + actual new public pair are compared directly;
  // registrationId/revision/digest are Source originals, not self-filled expected16.
  const capture=canonicalJSON({identity:identity.identity,applicationBinding:identity.applicationBinding,generation:i.generation,pkA,pkB,scope:view.scope});if(selection&&selection!==capture)fail('DEVICE_REGISTRATION_SELECTION_CHANGED');selection=capture;review=view;return view;
 }
 async function preparePair(input){
  alive();const i=record(input,['approvalOriginal','policyRef','abortContext']),context=originalContext(i.abortContext);if(!review)fail('DEVICE_REGISTRATION_REVIEW_REQUIRED');if(selected)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');
  pending.assertCurrent();const approval=parseOriginal(i.approvalOriginal,196608),at=now(),verified=verifyProductSessionApprovalV4Data(registry,review.request,approval,i.policyRef,Buffer.from(review.scope.registrationOriginal),at);pending.assertCurrent();
  selected=true;let op,failed=false,cause,wire;const first=e=>{if(!failed){failed=true;cause=e;remember(e);}};
  try{
   try{op=await pending.produceRegistrationProof(context);}catch(e){if(e!==null&&(typeof e==='object'||typeof e==='function')&&!types.isProxy(e)){const d=Object.getOwnPropertyDescriptor(e,'partial');if(d&&Object.hasOwn(d,'value'))op=d.value;}throw e;}
   // Read and retain original output before a late current or interpretation error.
   if(!op||types.isProxy(op))fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');wire=bytes(op.readOriginalMember());retainedMember=Buffer.from(wire);
   if(op.assertCurrent()!==undefined)fail('DEVICE_REGISTRATION_NATIVE_CURRENT_REFUSED');pending.assertCurrent();originalContext(context);
   verifyProductSessionDeviceRegistrationProofV4Data(Buffer.from(review.scope.registrationOriginal),wire,now());
   captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  }catch(e){first(e);if(op&&!retainedMember)try{retainedMember=bytes(op.readOriginalMember());}catch{}}
  try{await pending.close();}catch(e){first(e);}
  if(failed)throw cause;alive();originalContext(context);captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  const body={operationId:review.scope.pendingId,request:review.request,registrationOriginal:review.scope.registrationOriginal,registrationMember:wire.toString('base64url'),approval},bodyOriginal=canonicalJSON(body);if(Buffer.byteLength(bodyOriginal)>393216)fail('DEVICE_REGISTRATION_HTTP_BODY_LIMIT');
  const ref=Object.freeze({});packets.set(ref,{owner,body,bodyOriginal,context,verified:verified.verifiedApproval,entered:false,response:null,outcome:null});preparedRef=ref;return ref;
 }
 function readPacket(ref){const p=packet(ref);return Object.freeze({operationId:p.body.operationId,originalBody:p.bodyOriginal,requestDigest:review.requestDigest,registrationOriginal:review.scope.registrationOriginal,dataOnly:true,registered:false,SourceAdmission:false,NativeAdmission:false});}
 async function submit(ref,context){
  alive();const p=packet(ref);if(originalContext(context)!==p.context)fail('DEVICE_REGISTRATION_ORIGINAL_CONTEXT_CHANGED');if(p.entered)fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');
  captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());p.entered=true;
  try{
   p.response=await gateway.pairDeviceV4({originalBody:p.bodyOriginal,abortContext:p.context}); // Retain before late current/status checks.
   originalContext(p.context);captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());
   const result=p.response;if(typeof result?.original!=='string'||result.recoveryOnly===true)fail('DEVICE_REGISTRATION_ORIGINAL_OUTCOME_UNRESOLVED');
   const original=record(parseOriginal(result.original,196608),['registrationOriginal','challenge']);if(original.registrationOriginal!==review.scope.registrationOriginal)fail('DEVICE_REGISTRATION_ORIGINAL_RECORD_CHANGED');
   const challenge=parseProductSessionChallenge(original.challenge);if(challenge.version!=='4'||challenge.account!==p.body.approval.account||challenge.requestDigest!==review.requestDigest||challenge.approvalDigest!==productSessionApprovalDigest(p.body.approval))fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   const currentTime=now().toISOString();if(challenge.issuedAt<p.body.approval.issuedAt||challenge.issuedAt>currentTime||challenge.expiresAt<=currentTime||challenge.expiresAt>p.body.approval.expiresAt||challenge.sessionExpiresAt>p.body.approval.expiresAt||challenge.sessionExpiresAt>review.record.expiresAt)fail('DEVICE_REGISTRATION_CHALLENGE_WINDOW');
   for(const k of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','nonce','state'])if(challenge[k]!==review.request[k])fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   if(canonicalJSON(challenge.scopes)!==canonicalJSON(review.request.scopes)||canonicalJSON(challenge.accountAuthorization)!==canonicalJSON(p.body.approval.accountAuthorization))fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   p.outcome=Object.freeze({operationId:p.body.operationId,responseOriginal:result.original,registrationOriginal:original.registrationOriginal,challenge,dataOnly:true,operationVerified:false,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false});return p.outcome;
  }catch(e){remember(e);throw e;}
 }
 return Object.freeze({
  readOriginalRegistrationReviewDATA:readReview,
  prepareOriginalPairSubmission(input){if(prepareFlight)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');prepareFlight=preparePair(input);return prepareFlight;},
  readOriginalPairRequestDATA:readPacket,
  submitPreparedPair(ref,context){const flight=submit(ref,context);submitFlight=flight;return flight;},
  readStatusDATA(){const p=preparedRef?packet(preparedRef):null;return Object.freeze({proofSelected:selected,originalMemberRetained:retainedMember!==null,httpEntered:p?.entered??false,originalResponseRetained:p?.response!==null&&p?.response!==undefined,originalResponse:p?.response??null,firstCausePresent:hasCause,firstCause,registered:false,newSession:false,SourceAdmission:false,NativeAdmission:false});},
  close(){closed=true;if(!closing)closing=(async()=>{try{if(prepareFlight)await prepareFlight;}catch{}try{if(submitFlight)await submitFlight;}catch{}await pending.close();})();return closing;},
 });
}
