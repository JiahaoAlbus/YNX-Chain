// Private fixed-realm entry. Native names below are Main's agreed interface.
// No package export/App provider, NativeModules/global setter, pointer DTO,
// Root bit or replacement context. Actual installer/tag enforcement is Main's.
import{createOriginalDeviceV4RegistrationClientFromFixedParts}from'../src/original-product-device-v4-registration-core.js';
import{originalV4PrivateVerificationDATA as verification}from'../src/product-session-pq-v4-verification-private.mjs';
import{inspectOriginalProductDeviceV4PendingReviewDATA}from'../src/original-product-device-v4-pending-review-core.js';
import{createOriginalDeviceIdentityDATA,inspectOriginalDeviceCreateIntentDATA,ORIGINAL_DEVICE_CREATE_IDENTITY_INPUT_FIELDS}from'../src/original-device-create-intent-data-core.js';
import{captureProductSessionAccountPolicy}from'../src/product-session-account-policy.js';
import{captureVerifiedPQSessionApproval}from'../src/product-session-account-private.js';
import{canonicalJSON,WalletAuthError}from'../src/canonical.js';
import{pqBase64url}from'../src/pq-wallet-contract.js';
import{SourceUTF8Encoder}from'./original-source-private-utf8.mjs';
import{createOriginalRegistrationHTTPFromFixedNative}from'./original-device-v4-registration-http-private.mjs';
import{inspectOriginalDeviceV4HTTPResponseDATA}from'../src/original-product-device-v4-http-response-data.js';
import{inspectNativeFailureDATA,inspectNativeDrainDATA,inspectNativeResponseDATA}from'./original-device-v4-registration-native-data.mjs';
const utf8=new SourceUTF8Encoder(),fail=c=>{throw new WalletAuthError(c,c)},ta=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(ta,Symbol.toStringTag).get,len=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,abl=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,set=Uint8Array.prototype.set;
const record=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('DEVICE_REGISTRATION_EXACT_DATA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('DEVICE_REGISTRATION_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));};
function bytes(v,n){let size,b;try{if(tag.call(v)==='Uint8Array'){size=len.call(v);b=buffer.call(v);abl.call(b);}else{size=abl.call(v);b=v;}}catch{fail('DEVICE_REGISTRATION_ORIGINAL_BYTES')}if(n?size!==n:!size||size>1048576)fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');const out=new Uint8Array(size);try{set.call(out,new Uint8Array(b,tag.call(v)==='Uint8Array'?Object.getOwnPropertyDescriptor(ta,'byteOffset').get.call(v):0,size))}catch{fail('DEVICE_REGISTRATION_ORIGINAL_BYTES')}return out;}
const copy=v=>typeof v==='string'?utf8.encode(v):bytes(v),hex=b=>{let h='';for(const v of b)h+=v.toString(16).padStart(2,'0');return h};
function parseOriginal(raw,max){if(typeof raw!=='string'||!raw.length||utf8.encode(raw).length>max)fail('DEVICE_REGISTRATION_ORIGINAL_REQUIRED');const v=JSON.parse(raw);if(canonicalJSON(v)!==raw)fail('DEVICE_REGISTRATION_CANONICAL_REQUIRED');return v;}
const hostMethods=Object.freeze(['acquireOriginalProductSessionDeviceV4PendingSource','captureOriginalDeviceV4AbortContext','assertOriginalDeviceV4AbortCurrent','closeOriginalDeviceV4AbortContext','readOriginalDeviceV4IndependentDATA','readOriginalDeviceV4UserApprovalDATA','submitOriginalDeviceV4Pair','submitOriginalDeviceV4Completion','readOriginalDeviceV4PairResponseDATA','isOriginalSource','isOriginalOperation','isOriginalHttp','isOriginalAbort']);
export default function originalAndroidDeviceV4RegistrationPrivateFactory(nativeHost){
 if(arguments.length!==1)fail('DEVICE_REGISTRATION_PRIVATE_BINDING_ARGUMENTS');
 // Only the fixed private C++ bootstrap may supply this lexical object; this
 // reflection is not a claimed generic trap-free App object/brand detector.
 for(const name of hostMethods)if(typeof Object.getOwnPropertyDescriptor(nativeHost,name)?.value!=='function')fail('DEVICE_REGISTRATION_NATIVE_HOST_NOT_SUPPLIED');
 const call=(name,...args)=>Reflect.apply(Object.getOwnPropertyDescriptor(nativeHost,name).value,nativeHost,args),intrinsic=(kind,ref)=>call('isOriginal'+kind,ref)===true;
 const invoke=(kind,ref,name,...args)=>{if(!intrinsic(kind,ref))fail('DEVICE_REGISTRATION_NATIVE_'+kind.toUpperCase()+'_REQUIRED');const fn=ref[name];if(typeof fn!=='function')fail('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED');return Reflect.apply(fn,ref,args)};
 const bad=f=>inspectNativeFailureDATA(f).present,nativeError=f=>Object.assign(new WalletAuthError('DEVICE_REGISTRATION_NATIVE_FAILURE','Original Native failure'),{originalFailure:f});
 const drain=inspectNativeDrainDATA;
 return async function openOriginalProductDeviceV4RegistrationClient(...args){
  if(args.length)fail('DEVICE_REGISTRATION_ZERO_INPUT');
  const source=await call('acquireOriginalProductSessionDeviceV4PendingSource'); // SAME Native partial/exception remains Native-owned before classification.
  if(!intrinsic('Source',source))throw Object.assign(new WalletAuthError('DEVICE_REGISTRATION_NATIVE_SOURCE_REQUIRED','Genuine Source required'),{partial:source});
  const ops=[],ownedMember=new Map();let context,identity,identitySnapshot,approvalSnapshot,contextCaptured=false,prepareEntered=false,closed=false,firstPresent=false,first,sourceClosed=false,contextClosed=false;
  const remember=e=>{if(!firstPresent){firstPresent=true;first=e}},alive=()=>{if(closed)fail('DEVICE_REGISTRATION_RETIRED')};
  const addOp=op=>{if(op!==null&&op!==undefined&&!ops.some(r=>r.owner===op))ops.push({owner:op,retired:false,joined:false,closed:false})};
  const originalContext=v=>{alive();if(v!==context||!intrinsic('Abort',v))fail('DEVICE_REGISTRATION_ORIGINAL_CONTEXT_CHANGED');if(call('assertOriginalDeviceV4AbortCurrent',v)!==undefined)fail('DEVICE_REGISTRATION_ORIGINAL_ABORT_CONTEXT');alive();return v;};
  const sourceCurrent=()=>{alive();if(invoke('Source',source,'assertCurrent')!==undefined)fail('DEVICE_REGISTRATION_NATIVE_CURRENT_REFUSED');alive();};
  const pending=Object.freeze({readOriginalReview(){sourceCurrent();const raw=bytes(invoke('Source',source,'readOriginalReview'));sourceCurrent();return raw},assertCurrent:sourceCurrent,async produceRegistrationProof(ctx){return produce('produceRegistrationProof',ctx)},async produceChallengeProof(ctx){return produce('produceChallengeProof',ctx)},retire(){invoke('Source',source,'retire')},async close(){return closeResources()}});
  async function produce(name,ctx){originalContext(ctx);let op;try{op=await invoke('Source',source,name,ctx);addOp(op);}catch(e){const d=e!==null&&(typeof e==='object'||typeof e==='function')?Object.getOwnPropertyDescriptor(e,'partial'):undefined;if(d&&Object.hasOwn(d,'value'))addOp(d.value);remember(e);throw e;}if(!intrinsic('Operation',op))throw Object.assign(new WalletAuthError('DEVICE_REGISTRATION_NATIVE_OPERATION_REQUIRED','Genuine operation required'),{partial:op});return op;}
  function operationMethod(op,name){if(name==='readOriginalMember'){if(ownedMember.has(op))return new Uint8Array(ownedMember.get(op));const member=bytes(invoke('Operation',op,name));if(!member.length||member.length>98304)fail('DEVICE_REGISTRATION_ORIGINAL_BYTES');ownedMember.set(op,member);return new Uint8Array(member)}return invoke('Operation',op,name);}
  function independent(){sourceCurrent();const d=record(call('readOriginalDeviceV4IndependentDATA'),['originalCreationIntent','heldStableIdentity','deviceGeneration','originalOperation','account','network','canonicalOwner','pkA','pkB','notBeforeMs','expiresAtMs']),networkId=hex(bytes(d.network,32));if(![d.notBeforeMs,d.expiresAtMs].every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<=18446744073709551615n)||BigInt(d.notBeforeMs)>=BigInt(d.expiresAtMs)||BigInt(Date.now())<BigInt(d.notBeforeMs)||BigInt(Date.now())>=BigInt(d.expiresAtMs))fail('DEVICE_REGISTRATION_NATIVE_IDENTITY_WINDOW');const intent=inspectOriginalDeviceCreateIntentDATA(utf8.encode(d.originalCreationIntent)),t=intent.terms;alive();if(typeof d.originalOperation!=='string'||!/^([0-9a-f]{64})$/.test(d.originalOperation))fail('DEVICE_REGISTRATION_NATIVE_OPERATION_ID');if(intent.approvedTerms!==d.originalCreationIntent||intent.stableDeviceIdentity!==d.heldStableIdentity||t.generation!==d.deviceGeneration||t.account!==d.account||t.networkId!==networkId||t.canonicalOwner!==d.canonicalOwner)fail('DEVICE_REGISTRATION_NATIVE_IDENTITY_MISMATCH');
   const identityBinding=Object.freeze(Object.fromEntries(ORIGINAL_DEVICE_CREATE_IDENTITY_INPUT_FIELDS.map(k=>[k,t[k]]))),pair={pkA:d.pkA,pkB:d.pkB},selection=Object.freeze({identityBinding,generation:d.deviceGeneration,publicPair:Object.freeze({pkA:bytes(pair.pkA,2592),pkB:bytes(pair.pkB,64)})}),snapshot=canonicalJSON({identityBinding,generation:d.deviceGeneration,pkA:hex(selection.publicPair.pkA),pkB:hex(selection.publicPair.pkB),originalOperation:d.originalOperation,originalCreationIntent:d.originalCreationIntent,notBeforeMs:d.notBeforeMs,expiresAtMs:d.expiresAtMs});if(identitySnapshot&&identitySnapshot!==snapshot)fail('DEVICE_REGISTRATION_SELECTION_CHANGED');identitySnapshot=snapshot;identity=selection;sourceCurrent();return selection;
  }
  function userApproval(){sourceCurrent();const originals=call('readOriginalDeviceV4UserApprovalDATA',source);alive();if(approvalSnapshot&&(originals.approvalOriginal!==approvalSnapshot.approvalOriginal||originals.policyOriginal!==approvalSnapshot.policyOriginal))fail('ACCOUNT_POLICY_CHANGED');sourceCurrent();return originals;}
  // Wallet's policyOriginal documents the signing instant only. It cannot
  // become a fresh observation, even if signed PROFILE/CURRENT also exists.
  let policyLoan,policyRetired=false,policyJoined=false,policyClosed=false,policyCloseSelected=false,policyAcquiring=false;
  let policyBinding;
  const policyFlights=new Set();
  function withPolicyFlight(work){
   const flight=Promise.resolve().then(work);policyFlights.add(flight);
   flight.then(()=>policyFlights.delete(flight),()=>policyFlights.delete(flight));
   return flight;
  }
  const policyResource={
   readOriginal(){this.assertCurrent();return parseOriginal(invoke('AccountPolicy',policyLoan,'readOriginalPolicyDATA'),524288)},
   assertCurrent(){sourceCurrent();originalContext(context);if(invoke('AccountPolicy',policyLoan,'assertOriginalCurrent',policyBinding)!==undefined)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_NOT_CURRENT');sourceCurrent();originalContext(context);},
   async recheck(){this.assertCurrent();if(await invoke('AccountPolicy',policyLoan,'recheckOriginalCurrent',policyBinding)!==undefined)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_NOT_CURRENT');this.assertCurrent();},
   retire(){return invoke('AccountPolicy',policyLoan,'retire')},
   join(){return invoke('AccountPolicy',policyLoan,'join')},
   close(){return invoke('AccountPolicy',policyLoan,'close')}
  };
  async function closePolicy(){
   if(policyAcquiring)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_JOIN_PENDING');
   if(!policyLoan||policyClosed)return;
   if(!policyRetired){policyRetired=true;policyResource.retire();}
   if(!policyJoined){const j=drain(await policyResource.join());if(bad(j.failure))remember(nativeError(j.failure));if(!j.physical_done)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_JOIN_PENDING');policyJoined=true;}
   if(policyCloseSelected)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_CLOSE_UNKNOWN');
   policyCloseSelected=true;
   const d=drain(await policyResource.close());policyClosed=d.physical_done===1;if(bad(d.failure))remember(nativeError(d.failure));
   if(!policyClosed)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_CLOSE_UNKNOWN');
  }
  const gateway=createOriginalRegistrationHTTPFromFixedNative(nativeHost,source,originalContext);
  async function finishProof(){for(const r of ops){if(r.closed)continue;if(!r.retired){r.retired=true;invoke('Operation',r.owner,'retire')}if(!r.joined){const joined=drain(await invoke('Operation',r.owner,'join'));if(bad(joined.failure))remember(nativeError(joined.failure));if(!joined.physical_done)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_PENDING','Original proof still active');r.joined=true;}const done=drain(await invoke('Operation',r.owner,'close'));r.closed=done.physical_done===1;if(bad(done.failure))remember(nativeError(done.failure));if(!r.closed)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_UNKNOWN','Original proof custody remains');}if(firstPresent)throw first;}
  async function closeResources(){const http=await gateway.drain();if(http.firstCausePresent)remember(http.firstCause);if(!http.physicalDone)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_UNKNOWN','Original HTTP custody remains');try{await finishProof()}catch(e){remember(e)}if(ops.some(r=>!r.closed))throw first;try{await closePolicy();}catch(e){remember(e);throw first;}if(!sourceClosed){const joined=drain(await invoke('Source',source,'join'));if(bad(joined.failure))remember(nativeError(joined.failure));if(!joined.physical_done)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_PENDING','Original source active');const d=drain(await invoke('Source',source,'close'));sourceClosed=d.physical_done===1;if(bad(d.failure))remember(nativeError(d.failure));if(!sourceClosed)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_UNKNOWN','Original source held');}if(contextCaptured&&!contextClosed){const d=drain(await call('closeOriginalDeviceV4AbortContext',context));contextClosed=d.physical_done===1;if(bad(d.failure))remember(nativeError(d.failure));if(!contextClosed)throw firstPresent?first:new WalletAuthError('DEVICE_REGISTRATION_CLEANUP_UNKNOWN','Original context held');}if(firstPresent)throw first;}
  const client=createOriginalDeviceV4RegistrationClientFromFixedParts(Object.freeze({pending,gateway,record,originalContext,bytes,operationMethod,parseOriginal,isProxy:()=>false,copyBytes:copy,byteLength:s=>utf8.encode(s).length,toHex:hex,toBase64url:pqBase64url,nowMS:()=>Date.now(),createOriginalDeviceIdentityDATA,...verification,captureVerifiedPQSessionApproval,inspectOriginalProductDeviceV4PendingReviewDATA,finishProofForTransport:finishProof,closeOriginalResources:closeResources}));
  async function prepare(completion){
   alive();if(prepareEntered)fail('DEVICE_REGISTRATION_PROOF_ALREADY_ENTERED');
   for(const method of ['acquireOriginalDeviceV4AccountPolicy','isOriginalAccountPolicy'])if(typeof Object.getOwnPropertyDescriptor(nativeHost,method)?.value!=='function')fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_NOT_SUPPLIED');
   prepareEntered=true;independent();
   const review=inspectOriginalProductDeviceV4PendingReviewDATA(pending.readOriginalReview()),s=review.scope;
   if(s.operation!==(completion?'challenge-completion':'registration-pop')||s.expected.networkId!==identity.identityBinding.networkId||s.expected.account!==identity.identityBinding.account||s.expected.canonicalOwner!==identity.identityBinding.canonicalOwner)fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_BINDING');
   approvalSnapshot=userApproval();parseOriginal(approvalSnapshot.approvalOriginal,196608);parseOriginal(approvalSnapshot.policyOriginal,524288);
   if(!contextCaptured){context=call('captureOriginalDeviceV4AbortContext');contextCaptured=true;}originalContext(context);
   policyBinding=Object.freeze({operation:s.operation,operationId:s.pendingId,requestDigest:review.requestDigest,approvalDigest:s.approvalDigest,networkId:s.expected.networkId,account:s.expected.account,canonicalOwner:s.expected.canonicalOwner});
   policyAcquiring=true;
   try{policyLoan=await call('acquireOriginalDeviceV4AccountPolicy',source,context,policyBinding);}
   catch(e){const d=e!==null&&(typeof e==='object'||typeof e==='function')?Object.getOwnPropertyDescriptor(e,'partial'):undefined;if(d&&Object.hasOwn(d,'value')&&intrinsic('AccountPolicy',d.value))policyLoan=d.value;remember(e);throw e;}
   finally{policyAcquiring=false;}
   if(!intrinsic('AccountPolicy',policyLoan)){policyLoan=undefined;fail('DEVICE_REGISTRATION_INDEPENDENT_POLICY_NOT_SUPPLIED');}
   await policyResource.recheck();
   userApproval();const policyRef=captureProductSessionAccountPolicy(policyResource,{networkId:identity.identityBinding.networkId,account:identity.identityBinding.account},new Date(Date.now()));
   return completion?client.prepareOriginalCompletionSubmission({approvalOriginal:approvalSnapshot.approvalOriginal,policyRef,abortContext:context}):client.prepareOriginalPairSubmission({approvalOriginal:approvalSnapshot.approvalOriginal,policyRef,abortContext:context});
  }
  return Object.freeze({readOriginalRegistrationReviewDATA(){return client.readOriginalRegistrationReviewDATA(independent())},readOriginalCompletionReviewDATA(){const selected=independent(),raw=inspectNativeResponseDATA(call('readOriginalDeviceV4PairResponseDATA'));alive();if(raw.responsePresent!==true)fail('DEVICE_REGISTRATION_INDEPENDENT_CHALLENGE_NOT_SUPPLIED');if(bad(raw.failure))throw nativeError(raw.failure);const decoded=inspectOriginalDeviceV4HTTPResponseDATA(raw.httpStatus,bytes(raw.bytes)),original=record(parseOriginal(decoded.original,196608),['registrationOriginal','challenge']);const fresh=inspectOriginalProductDeviceV4PendingReviewDATA(pending.readOriginalReview());if(original.registrationOriginal!==fresh.scope.registrationOriginal)fail('DEVICE_REGISTRATION_CACHED_REGISTRATION_ORIGINAL_MISMATCH');return client.readOriginalCompletionReviewDATA({...selected,challengeOriginal:canonicalJSON(original.challenge)})},prepareOriginalPairSubmission(){return withPolicyFlight(()=>prepare(false))},prepareOriginalCompletionSubmission(){return withPolicyFlight(()=>prepare(true))},readOriginalPairRequestDATA:client.readOriginalPairRequestDATA,readOriginalCompletionRequestDATA:client.readOriginalCompletionRequestDATA,submitPreparedPair(ref){return withPolicyFlight(async()=>{client.readOriginalPairRequestDATA(ref);await policyResource.recheck();return client.submitPreparedPair(ref,originalContext(context));});},submitPreparedCompletion(ref){return withPolicyFlight(async()=>{client.readOriginalCompletionRequestDATA(ref);await policyResource.recheck();return client.submitPreparedCompletion(ref,originalContext(context));});},readStatusDATA:client.readStatusDATA,readOriginalTransportStatusDATA:gateway.readOriginalTransportStatusDATA,close(){closed=true;return Promise.allSettled([...policyFlights]).then(()=>client.close())}});
 };
}
