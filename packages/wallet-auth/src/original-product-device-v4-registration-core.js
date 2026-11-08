// Sole registration orchestration, extracted ONCE. Static Node/private compile
// facades bind fixed originals/transport/maths. This internal module is NOT a
// public provider/Source constructor, and its WeakMap packets are ephemeral
// same-owner handles, never durable recovery/approval authority.
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{parseProductSessionChallenge,productSessionApprovalDigest}from'./product-session-v2.js';
import registry from'../product-session-registry.json'with{type:'json'};
const packets=new WeakMap(),fail=c=>{throw new WalletAuthError(c,c);};
export function createOriginalDeviceV4RegistrationClientFromFixedParts({pending,gateway,record,originalContext,bytes,operationMethod,parseOriginal,isProxy,copyBytes,byteLength,toHex,toBase64url,nowMS,createOriginalDeviceIdentityDATA,verifyProductSessionApprovalV4Data,verifyProductSessionDeviceRegistrationProofV4Data,verifyProductSessionV4CompletionData,captureVerifiedPQSessionApproval,inspectOriginalProductDeviceV4PendingReviewDATA,finishProofForTransport,closeOriginalResources}){
 const flights=new Set(),owner={};let review,selection,selected=false,closed=false,closing,prepareFlight,prepareEntered=false,submitFlight,hasCause=false,firstCause,retainedMember=null,preparedRef=null,clockFloor=0;
 const remember=e=>{if(!hasCause){hasCause=true;firstCause=e;}};
 const alive=()=>{if(closed)fail('DEVICE_REGISTRATION_RETIRED');};
 const now=()=>{alive();const n=nowMS();if(!Number.isSafeInteger(n)||n<clockFloor)fail('DEVICE_REGISTRATION_CLOCK_ROLLBACK');clockFloor=n;return new Date(n);};
 const packet=ref=>{const p=packets.get(ref);if(!p||p.owner!==owner)fail('DEVICE_REGISTRATION_ORIGINAL_PACKET_REQUIRED');return p;};
 function readReview(independent,operation='registration-pop'){
  alive();if(selected)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');pending.assertCurrent();
  const i=record(independent,['identityBinding','generation','publicPair',...(operation==='challenge-completion'?['challengeOriginal']:[])]),identity=createOriginalDeviceIdentityDATA(i.identityBinding),pair=record(i.publicPair,['pkA','pkB']),pkA=toHex(bytes(pair.pkA,2592)),pkB=toHex(bytes(pair.pkB,64));
  const view=inspectOriginalProductDeviceV4PendingReviewDATA(pending.readOriginalReview());pending.assertCurrent();alive();
  if(view.scope.operation!==operation||view.scope.expected.generation!==i.generation||view.record.pkA!==pkA||view.record.pkB!==pkB)fail('DEVICE_REGISTRATION_SELECTED_PAIR_MISMATCH');
  if(operation==='challenge-completion'&&(typeof i.challengeOriginal!=='string'||i.challengeOriginal!==view.scope.challengeOriginal))fail('DEVICE_REGISTRATION_SELECTED_CHALLENGE_MISMATCH');
  for(const k of ['networkId','canonicalOwner','account','productId','clientId','deviceId'])if(view.scope.expected[k]!==identity.identity[k])fail('DEVICE_REGISTRATION_SELECTED_IDENTITY_MISMATCH');
  for(const[k,v]of Object.entries(identity.applicationBinding))if(view.scope.expected[k]!==v)fail('DEVICE_REGISTRATION_SELECTED_APPLICATION_MISMATCH');
  // Independent Main identity + actual new public pair are compared directly;
  // registrationId/revision/digest are Source originals, not self-filled expected16.
  const capture=canonicalJSON({identity:identity.identity,applicationBinding:identity.applicationBinding,generation:i.generation,pkA,pkB,scope:view.scope});if(selection&&selection!==capture)fail('DEVICE_REGISTRATION_SELECTION_CHANGED');alive();selection=capture;review=view;return view;
 }
 async function preparePair(input){
  alive();const i=record(input,['approvalOriginal','policyRef','abortContext']),context=originalContext(i.abortContext);if(!review||review.scope.operation!=='registration-pop')fail('DEVICE_REGISTRATION_REVIEW_REQUIRED');if(selected)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');
  pending.assertCurrent();const approval=parseOriginal(i.approvalOriginal,196608),at=now(),verified=verifyProductSessionApprovalV4Data(registry,review.request,approval,i.policyRef,copyBytes(review.scope.registrationOriginal),at);if(productSessionApprovalDigest(approval)!==review.scope.approvalDigest)fail('DEVICE_REGISTRATION_APPROVAL_ORIGINAL_MISMATCH');pending.assertCurrent();alive();originalContext(context);
  selected=true;let op,failed=false,cause,wire;const first=e=>{if(!failed){failed=true;cause=e;remember(e);}};
  try{
   try{op=await pending.produceRegistrationProof(context);}catch(e){if(e!==null&&(typeof e==='object'||typeof e==='function')&&!isProxy(e)){const d=Object.getOwnPropertyDescriptor(e,'partial');if(d&&Object.hasOwn(d,'value'))op=d.value;}throw e;}
   // Read and retain original output before a late current or interpretation error.
   if(!op||isProxy(op))fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');wire=bytes(operationMethod(op,'readOriginalMember'));retainedMember=copyBytes(wire);
   if(operationMethod(op,'assertCurrent')!==undefined)fail('DEVICE_REGISTRATION_NATIVE_CURRENT_REFUSED');pending.assertCurrent();originalContext(context);
   verifyProductSessionDeviceRegistrationProofV4Data(copyBytes(review.scope.registrationOriginal),wire,now());
   captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  }catch(e){first(e);if(op&&!retainedMember)try{retainedMember=bytes(operationMethod(op,'readOriginalMember'));}catch{}}
  try{await finishProofForTransport();}catch(e){first(e);}
  if(failed)throw cause;alive();originalContext(context);captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  const body={operationId:review.scope.pendingId,request:review.request,registrationOriginal:review.scope.registrationOriginal,registrationMember:toBase64url(wire),approval},bodyOriginal=canonicalJSON(body);if(byteLength(bodyOriginal)>393216)fail('DEVICE_REGISTRATION_HTTP_BODY_LIMIT');
  const ref=Object.freeze({});packets.set(ref,{kind:'pair',owner,body,bodyOriginal,context,verified:verified.verifiedApproval,entered:false,responsePresent:false,response:null,outcome:null});preparedRef=ref;return ref;
 }
 function readPacket(ref){const p=packet(ref);if(p.kind!=='pair')fail('DEVICE_REGISTRATION_PACKET_PHASE_MISMATCH');return Object.freeze({operationId:p.body.operationId,originalBody:p.bodyOriginal,requestDigest:review.requestDigest,registrationOriginal:review.scope.registrationOriginal,dataOnly:true,registered:false,SourceAdmission:false,NativeAdmission:false});}
 async function submit(ref,context){
  alive();const p=packet(ref);if(p.kind!=='pair')fail('DEVICE_REGISTRATION_PACKET_PHASE_MISMATCH');if(p.entered)fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');if(originalContext(context)!==p.context)fail('DEVICE_REGISTRATION_ORIGINAL_CONTEXT_CHANGED');
  captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());p.entered=true;
  try{
   p.response=await gateway.pairDeviceV4({originalBody:p.bodyOriginal,abortContext:p.context});p.responsePresent=true; // Retain before late current/status checks.
   originalContext(p.context);captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());
   const result=p.response;if(typeof result?.original!=='string'||result.recoveryOnly===true)fail('DEVICE_REGISTRATION_ORIGINAL_OUTCOME_UNRESOLVED');
   const original=record(parseOriginal(result.original,196608),['registrationOriginal','challenge']);if(original.registrationOriginal!==review.scope.registrationOriginal)fail('DEVICE_REGISTRATION_ORIGINAL_RECORD_CHANGED');
   const challenge=parseProductSessionChallenge(original.challenge);if(challenge.version!=='4'||challenge.account!==p.body.approval.account||challenge.requestDigest!==review.requestDigest||challenge.approvalDigest!==productSessionApprovalDigest(p.body.approval))fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   const currentTime=now().toISOString();if(challenge.issuedAt<p.body.approval.issuedAt||challenge.issuedAt>currentTime||challenge.expiresAt<=currentTime||challenge.expiresAt>p.body.approval.expiresAt||challenge.sessionExpiresAt>p.body.approval.expiresAt||challenge.sessionExpiresAt>review.record.expiresAt)fail('DEVICE_REGISTRATION_CHALLENGE_WINDOW');
   for(const k of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','nonce','state'])if(challenge[k]!==review.request[k])fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   if(canonicalJSON(challenge.scopes)!==canonicalJSON(review.request.scopes)||canonicalJSON(challenge.accountAuthorization)!==canonicalJSON(p.body.approval.accountAuthorization))fail('DEVICE_REGISTRATION_CHALLENGE_MISMATCH');
   p.outcome=Object.freeze({operationId:p.body.operationId,responseOriginal:result.original,registrationOriginal:original.registrationOriginal,challenge,dataOnly:true,operationVerified:false,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false});return p.outcome;
  }catch(e){retainResponseFailure(p,e);remember(e);throw e;}
 }

 function retainResponseFailure(p,cause){
  if(!cause||isProxy(cause)||!(cause instanceof WalletAuthError)||Object.getOwnPropertyDescriptor(cause,'code')?.value!=='PAIR_V4_HTTP_OUTCOME_UNKNOWN')return;
  const seen=new Set();for(let e=cause,n=0;n<4&&e!==null&&(typeof e==='object'||typeof e==='function')&&!isProxy(e)&&!seen.has(e);n++){
   seen.add(e);for(const key of ['originalResponse']){const d=Object.getOwnPropertyDescriptor(e,key);if(d&&Object.hasOwn(d,'value')&&!p.responsePresent){p.response=d.value;p.responsePresent=true;}}
   const d=Object.getOwnPropertyDescriptor(e,'cause');if(!d||!Object.hasOwn(d,'value'))break;e=d.value;
  }
 }
 function track(work,prepare=false){let resolve,reject;const flight=new Promise((a,b)=>{resolve=a;reject=b});flights.add(flight);flight.then(()=>flights.delete(flight),e=>{if(prepare)remember(e);flights.delete(flight);});try{Promise.resolve(work()).then(resolve,reject)}catch(e){reject(e)}return flight;}
 async function prepareCompletion(input){
  alive();const i=record(input,['approvalOriginal','policyRef','abortContext']),context=originalContext(i.abortContext);if(!review||review.scope.operation!=='challenge-completion')fail('DEVICE_REGISTRATION_COMPLETION_REVIEW_REQUIRED');if(selected)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');
  pending.assertCurrent();const approval=parseOriginal(i.approvalOriginal,196608),at=now(),verified=verifyProductSessionApprovalV4Data(registry,review.request,approval,i.policyRef,copyBytes(review.scope.registrationOriginal),at);
  if(productSessionApprovalDigest(approval)!==review.scope.approvalDigest||canonicalJSON(review.challenge)!==review.scope.challengeOriginal)fail('DEVICE_REGISTRATION_COMPLETION_ORIGINAL_MISMATCH');pending.assertCurrent();alive();originalContext(context);
  selected=true;let op,failed=false,cause,wire,target;const first=e=>{if(!failed){failed=true;cause=e;remember(e);}};
  try{
   try{op=await pending.produceChallengeProof(context);}catch(e){if(e!==null&&(typeof e==='object'||typeof e==='function')&&!isProxy(e)){const d=Object.getOwnPropertyDescriptor(e,'partial');if(d&&Object.hasOwn(d,'value'))op=d.value;}throw e;}
   if(!op||isProxy(op))fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');wire=bytes(operationMethod(op,'readOriginalMember'));retainedMember=copyBytes(wire);
   if(operationMethod(op,'assertCurrent')!==undefined)fail('DEVICE_REGISTRATION_NATIVE_CURRENT_REFUSED');pending.assertCurrent();originalContext(context);
   target=verifyProductSessionV4CompletionData(registry,review.request,approval,{challenge:review.challenge,deviceMember:toBase64url(wire)},i.policyRef,copyBytes(review.scope.registrationOriginal),now());
   captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  }catch(e){first(e);if(op&&!retainedMember)try{retainedMember=bytes(operationMethod(op,'readOriginalMember'));}catch{}}
  try{await finishProofForTransport();}catch(e){first(e);}if(failed)throw cause;
  alive();originalContext(context);captureVerifiedPQSessionApproval(verified.verifiedApproval,approval,review.requestDigest,now());
  const completion={challenge:review.challenge,deviceMember:toBase64url(wire)},body={operationId:review.scope.pendingId,request:review.request,registrationOriginal:review.scope.registrationOriginal,approval,completion},bodyOriginal=canonicalJSON(body);if(byteLength(bodyOriginal)>393216)fail('DEVICE_REGISTRATION_HTTP_BODY_LIMIT');
  const ref=Object.freeze({});packets.set(ref,{kind:'completion',owner,body,bodyOriginal,context,verified:verified.verifiedApproval,entered:false,responsePresent:false,response:null,outcome:null,target,member:copyBytes(wire)});preparedRef=ref;return ref;
 }
 function readCompletionPacket(ref){const p=packet(ref);if(p.kind!=='completion')fail('DEVICE_REGISTRATION_PACKET_PHASE_MISMATCH');return Object.freeze({operationId:p.body.operationId,originalBody:p.bodyOriginal,requestDigest:review.requestDigest,registrationOriginal:review.scope.registrationOriginal,challengeOriginal:review.scope.challengeOriginal,memberOriginal:copyBytes(p.member),dataOnly:true,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false});}
 function completionWindow(p){const at=now().toISOString(),c=p.body.completion.challenge;if(c.issuedAt>at||c.expiresAt<=at||c.sessionExpiresAt<=at||p.target.session.expiresAt<=at)fail('DEVICE_REGISTRATION_COMPLETION_WINDOW');}
 async function submitCompletion(ref,context){
  alive();const p=packet(ref);if(p.kind!=='completion')fail('DEVICE_REGISTRATION_PACKET_PHASE_MISMATCH');if(p.entered)fail('DEVICE_REGISTRATION_QUERY_ORIGINAL_ONLY');if(originalContext(context)!==p.context)fail('DEVICE_REGISTRATION_ORIGINAL_CONTEXT_CHANGED');
  try{captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());completionWindow(p);}catch(e){remember(e);throw e;}p.entered=true;
  try{
   p.response=await gateway.completeDeviceV4({originalBody:p.bodyOriginal,abortContext:p.context});p.responsePresent=true;
   originalContext(p.context);captureVerifiedPQSessionApproval(p.verified,p.body.approval,review.requestDigest,now());completionWindow(p);
   const result=p.response;if(typeof result?.original!=='string'||result.recoveryOnly===true)fail('DEVICE_REGISTRATION_ORIGINAL_OUTCOME_UNRESOLVED');
   const session=parseOriginal(result.original,196608);if(canonicalJSON(session)!==canonicalJSON(p.target.session))fail('DEVICE_REGISTRATION_COMPLETION_SESSION_MISMATCH');
   if(session.expiresAt<=now().toISOString())fail('DEVICE_REGISTRATION_COMPLETION_SESSION_EXPIRED');
   p.outcome=Object.freeze({operationId:p.body.operationId,responseOriginal:result.original,registrationOriginal:review.scope.registrationOriginal,challengeOriginal:review.scope.challengeOriginal,session:p.target.session,dataOnly:true,operationVerified:false,registered:false,connected:false,newSession:false,SourceAdmission:false,NativeAdmission:false});return p.outcome;
  }catch(e){retainResponseFailure(p,e);remember(e);throw e;}
 }
 return Object.freeze({
  readOriginalRegistrationReviewDATA(independent){return readReview(independent);},
  readOriginalCompletionReviewDATA(independent){return readReview(independent,'challenge-completion');},
  prepareOriginalPairSubmission(input){if(prepareEntered)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');prepareEntered=true;prepareFlight=track(()=>preparePair(input),true);return prepareFlight;},
  readOriginalPairRequestDATA:readPacket,
  prepareOriginalCompletionSubmission(input){if(prepareEntered)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');prepareEntered=true;prepareFlight=track(()=>prepareCompletion(input),true);return prepareFlight;},
  readOriginalCompletionRequestDATA:readCompletionPacket,
  submitPreparedCompletion(ref,context){return track(()=>submitCompletion(ref,context));},
  submitPreparedPair(ref,context){const flight=track(()=>submit(ref,context));submitFlight=flight;return flight;},
  readStatusDATA(){const p=preparedRef?packet(preparedRef):null;return Object.freeze({proofSelected:selected,originalMemberRetained:retainedMember!==null,originalMember:retainedMember?copyBytes(retainedMember):null,httpEntered:p?.entered??false,originalResponseRetained:p?.responsePresent??false,originalResponse:p?.response??null,firstCausePresent:hasCause,firstCause,registered:false,newSession:false,SourceAdmission:false,NativeAdmission:false});},
  close(){closed=true;if(!closing)closing=(async()=>{let retireFailed=false,retireCause;try{pending.retire();}catch(e){retireFailed=true;retireCause=e;remember(e);}await Promise.allSettled([...flights]);try{await closeOriginalResources();}catch(e){remember(e);if(!retireFailed)throw e;}if(retireFailed)throw retireCause;})();return closing;},
 });
}
