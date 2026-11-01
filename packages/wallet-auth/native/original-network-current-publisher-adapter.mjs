// Auth owning codec/once/lifetime implementation. Imports stay in the sole SDK
// package; none of these DATA checks mint a Native/Root capability.
import {canonical} from './original-auth-identity-source-verifier.mjs';
import {verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {inspectNetworkResourceCurrentPublisherDescriptorV1DATA,encodeNetworkResourceCurrentWitnessStatementV1DATA,encodeNetworkResourceCurrentWitnessEnvelopeV1DATA,inspectNetworkResourceCurrentWitnessV1DATA} from './original-network-resource-current-witness-v1.mjs';
import {assertOriginalP09CurrentSnapshotContinuesV1DATA} from './original-p09-current-snapshot-continuation.mjs';
import {readOriginalNetworkResourceCurrentPublisherReferenceV1,assertOriginalNetworkResourceCurrentPublisherReferenceV1} from './original-network-current-publisher-reference-private.mjs';
import {NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE as PUBLISHER_PURPOSE,NETWORK_CURRENT_PUBLISHER_SELECTION_KEY as PUBLISHER_SELECTION,NETWORK_CURRENT_PUBLISHER_OPERATIONS} from './original-network-current-publisher-source-contract.mjs';
import {acquireOriginalNetworkResourceCurrentPublisherNormalV1} from './original-network-current-publisher-loader-private.mjs';
import {inspectPQAuthorizationView,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
import {types} from 'node:util';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const typed=Object.getPrototypeOf(Uint8Array.prototype),lengthOf=Object.getOwnPropertyDescriptor(typed,'byteLength').get,bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const copy=b=>{if(types.isProxy(b)||!types.isUint8Array(b)||types.isSharedArrayBuffer(bufferOf.call(b)))fail('NETWORK_CURRENT_PUBLIC_BYTES');const n=lengthOf.call(b);if(!n||n>393216)fail('NETWORK_CURRENT_PUBLIC_BYTES');const out=new Uint8Array(n);Uint8Array.prototype.set.call(out,b);return out;};
const same=(a,b)=>Buffer.from(a).equals(Buffer.from(b));
const text=s=>new Uint8Array(Buffer.from(s,'utf8'));

// This testable kernel is not a factory for authority. Supplying ports, even
// correct mathematical originals, never brands it as a normal Root capture.
// The only normal signer receiver below requires an unforgeable registered ref.
export class OriginalNetworkCurrentCodecAdapter {
 #capture; #signer; #store; #attempt=false; #busy=false; #closed=false; #retired=false;
 #first={present:false,value:undefined}; #prepared; #member; #envelope; #readback;
 #intent=false; #effect=false; #result; #clock=-1; #children; #stage=0; #closeAmbiguous=false;
 constructor(capture,signer,store){
  for(const [object,names] of [[capture,['current','assertCompletedCurrent','clockMs','readOriginals','readFreshIssuerSourceInputs','retainSigningIntentOnce','querySameOriginal','retire','join','close']],[signer,['assertCurrent','signCurrent','retire','join','close']],[store,['retainPublicationIntentOnce','publishOriginalPairOnce','readOriginalPair','querySameOriginal','retire','join','close']]])for(const name of names)if(typeof object?.[name]!=='function')fail('NETWORK_CURRENT_TYPED_PORT_REQUIRED');
  this.#capture=capture;this.#signer=signer;this.#store=store;
  // Debt order: retire all effects, join capture/signing activity, then close
  // signer, store and finally capture. Never pass an unresolved child stage.
  this.#children=[()=>capture.retire(),()=>signer.retire(),()=>store.retire(),()=>capture.join(),()=>signer.join(),()=>store.join(),()=>signer.close(),()=>store.close(),()=>capture.close()];
 }
 #remember(e){if(!this.#first.present)this.#first={present:true,value:e};}
 #throwFirst(){if(this.#first.present)throw this.#first.value;}
 #at(){const at=this.#capture.clockMs();if(!Number.isSafeInteger(at)||at<0||at<this.#clock)fail('NETWORK_CURRENT_CLOCK_ROLLBACK');this.#clock=at;return at;}
 async #fence(){
  // Only null is success; undefined/false/0 are failures, not absent errors.
  const result=await this.#capture.current();this.#acceptVoid(result);
  const p=this.#prepared,at=this.#at();if(!p)return at;
  this.#originalTuple(at);
  this.#acceptVoid(await this.#signer.assertCurrent(p.view));
  this.#acceptVoid(this.#capture.assertCompletedCurrent());
  // Re-AND EVERY captured operand after the await, even if clock is unchanged.
  // A Native current boolean cannot replace exact original input binding.
  const after=this.#at();this.#originalTuple(after);return after;
 }
 #originalTuple(at){
  const p=this.#prepared;
  const original=this.#capture.readOriginals();
  assertOriginalP09CurrentSnapshotContinuesV1DATA(p.current9,original.current9,at);
  if(canonical(original.descriptor)!==canonical(p.descriptor)||canonical(original.binding)!==canonical(p.binding)||original.registeredCurrent!==p.view)fail('NETWORK_CURRENT_CAPTURE_CHANGED');
  // Root3/policy and target binding are immutable. Current17/nonce/previous and
  // observed height come ONLY from the same private capture's fresh getter.
  for(const key of ['rootRaw','enrollmentRaw','profileRaw'])if(original.issuerSourceInputs[key]!==p.inputs[key])fail('NETWORK_CURRENT_SOURCE_CHANGED');
  if(canonical(original.issuerSourceInputs.policy)!==p.policyText)fail('NETWORK_CURRENT_SOURCE_POLICY_CHANGED');
  const fresh=this.#capture.readFreshIssuerSourceInputs();
  exactPQRecord(fresh,['rootRaw','enrollmentRaw','profileRaw','currentRaw','policy','registrations','expectedNonce','previous'],'NETWORK_CURRENT_FRESH_ISSUER_SCHEMA');
  for(const key of ['rootRaw','enrollmentRaw','profileRaw'])if(fresh[key]!==p.inputs[key])fail('NETWORK_CURRENT_FRESH_ROOT_CHANGED');
  if(canonical(fresh.policy)!==p.policyText)fail('NETWORK_CURRENT_FRESH_POLICY_CHANGED');
  for(const role of ['root','profile','current','subject']){
   assertPQAuthorizationCurrent(p.inputs.registrations[role],fresh.registrations[role]);
   if(p.latestViews)assertPQAuthorizationCurrent(p.latestViews[role],fresh.registrations[role]);
  }
  const inputs={...fresh,atMs:at},liveView=fresh.registrations.current;
  if(inputs.policy.signatureContract.purpose!==PUBLISHER_PURPOSE)fail('NETWORK_CURRENT_DEDICATED_PUBLISHER_SOURCE_REQUIRED');
  // Sole common verifier owns this finite publisher scope. No consumer NR13,
  // resource9 current floor or pending-execution selection is passed here.
  const projection=verifyOriginalAuthSourceCurrentV2(inputs.rootRaw,inputs.enrollmentRaw,inputs.profileRaw,inputs.currentRaw,inputs.policy,inputs.registrations,inputs.expectedNonce,inputs.previous,at);
  if(p.lastProjection){const last=p.lastProjection;verifyOriginalAuthSourceCurrentV2(inputs.rootRaw,inputs.enrollmentRaw,inputs.profileRaw,inputs.currentRaw,inputs.policy,inputs.registrations,inputs.expectedNonce,{sequence:last.sequence,floor:last.floor,head:last.head,timeFloor:last.timeFloor,executionHeight:last.executionHeight},at);}
  const d=p.descriptor,scope=projection.selection[PUBLISHER_SELECTION];
  if(canonical(scope.descriptor)!==canonical(d)||scope.operation!==NETWORK_CURRENT_PUBLISHER_OPERATIONS[0]||scope.networkId!==d.networkId||scope.subjectOwner!==p.view.owner||scope.sourceId!==projection.sourceId||scope.instanceId!==projection.instanceId||JSON.parse(inputs.rootRaw).networkId!==d.networkId||projection.executionHeight!==liveView.executionHeight)fail('NETWORK_CURRENT_ROOT_DESCRIPTOR_MISMATCH');
  // Existing current-role refresh path only. A different mathematically valid
  // publisher pair is NOT independently delegated by this enrollment.
  if(liveView.owner!==d.publisherOwner||JSON.parse(Buffer.from(JSON.parse(inputs.enrollmentRaw).body,'base64url').toString('utf8')).currentOwner!==d.publisherOwner)fail('NETWORK_CURRENT_ISSUER_ROLE_NOT_DELEGATED');
  if(inputs.policy.signatureContract.currentFrame===d.resourceCurrentFrame)fail('NETWORK_CURRENT_DISTINCT_FRAME_REQUIRED');
  const now=inspectPQAuthorizationView(liveView),issued=inspectPQAuthorizationView(p.view,p.binding.executionHeight);
  if(!now.pqSigningEnabled||!now.activeRecord||now.authorizationStatus==='revoked'||!issued.activeRecord||issued.authorizationStatus==='revoked'||issued.activeRecord.revision!==p.binding.keyVersion||now.activeRecord.revision!==p.binding.keyVersion||BigInt(p.binding.executionHeight)>BigInt(liveView.executionHeight))fail('NETWORK_CURRENT_REGISTERED_ISSUER_NOT_CURRENT');
  p.latestViews={...fresh.registrations};p.lastProjection=projection;
 }
 #acceptVoid(result){if(!result||!Object.hasOwn(result,'error')||(Object.hasOwn(result,'errorPresent')&&typeof result.errorPresent!=='boolean'))fail('NETWORK_CURRENT_RESULT_SCHEMA');if(result.errorPresent===true||result.error!==null)throw result.error;}
 #publicResult(){return Object.freeze({state:this.#result??(this.#effect||this.#intent?'UNKNOWN':'REJECTED'),memberOriginal:this.#member?copy(this.#member):null,envelopeOriginal:this.#envelope?copy(this.#envelope):null,error:this.#first.present?this.#first.value:null,errorPresent:this.#first.present,signingSelected:this.#intent,publicationSelected:this.#effect,executionGranted:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});}
 async publishOnce(){
  if(this.#retired||this.#closed||this.#busy||this.#attempt)fail('NETWORK_CURRENT_ONCE');this.#attempt=true;this.#busy=true;
  try{
   await this.#fence();const original=this.#capture.readOriginals();
   const descriptor=inspectNetworkResourceCurrentPublisherDescriptorV1DATA(original.descriptor),binding=Object.freeze({...original.binding});
   const statement=encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,binding,original.current9),current9=JSON.parse(statement.currentOriginal);
   const policyText=canonical(original.issuerSourceInputs.policy),previousText=canonical(original.issuerSourceInputs.previous);
   this.#prepared={descriptor,current9,binding,inputs:{...original.issuerSourceInputs,policy:JSON.parse(policyText),previous:JSON.parse(previousText),registrations:{...original.issuerSourceInputs.registrations}},policyText,previousText,view:original.registeredCurrent,currentText:statement.currentOriginal,message:copy(statement.messageOriginal)};
   await this.#fence();
   // Durable once selected BEFORE invoking the primitive. Any ambiguous intent
   // response conservatively forbids another sign, even if no member returned.
   this.#intent=true;this.#acceptVoid(await this.#capture.retainSigningIntentOnce(text(statement.currentOriginal),copy(statement.messageOriginal)));
   await this.#fence();
   let signed;try{signed=await this.#signer.signCurrent(copy(this.#prepared.message),binding,this.#prepared.view);}catch(error){if(error&&Object.hasOwn(error,'partial')&&error.partial!==null&&error.partial!==undefined)try{this.#member=copy(error.partial);}catch{/* Preserve the primitive's original failure over malformed late public data. */}throw error;}
   // Public partials must be retained BEFORE interpreting a late/falsy error.
   let partialError;if(signed?.partial!==null&&signed?.partial!==undefined)try{this.#member=copy(signed.partial);}catch(error){partialError={error};}
   this.#acceptVoid(signed);if(partialError)throw partialError.error;if(!this.#member)fail('NETWORK_CURRENT_MEMBER_NOT_RETURNED');
   await this.#fence();
   this.#envelope=encodeNetworkResourceCurrentWitnessEnvelopeV1DATA(descriptor,binding,current9,this.#member);
   await this.#verifyEnvelope();
   this.#effect=true;this.#acceptVoid(await this.#store.retainPublicationIntentOnce(text(statement.currentOriginal),copy(this.#envelope)));
   await this.#fence();this.#acceptVoid(await this.#store.publishOriginalPairOnce(text(statement.currentOriginal),copy(this.#envelope)));
   await this.#fence();const read=await this.#store.readOriginalPair();
   // Readback may itself return a non-null partial with a late error. Retain it
   // under the original store owner; it is not a fresh sign/publish opportunity.
   let readPartialError;if(read?.partial!==null&&read?.partial!==undefined)try{this.#readback={currentOriginal:copy(read.partial.currentOriginal),envelopeOriginal:copy(read.partial.envelopeOriginal)};}catch(error){readPartialError={error};}
   this.#acceptVoid(read);if(readPartialError)throw readPartialError.error;if(!this.#readback)fail('NETWORK_CURRENT_READBACK_REQUIRED');
   if(!same(this.#readback.currentOriginal,text(statement.currentOriginal))||!same(this.#readback.envelopeOriginal,this.#envelope))fail('NETWORK_CURRENT_READBACK_CHANGED');
   await this.#verifyEnvelope();this.#result='PUBLISHED';
  }catch(e){this.#remember(e);}finally{this.#busy=false;}
  return this.#publicResult();
 }
 async #verifyEnvelope(){const at=await this.#fence(),p=this.#prepared;inspectNetworkResourceCurrentWitnessV1DATA(this.#envelope,p.descriptor,p.latestViews.current,{currentOriginal:text(p.currentText),atMs:at,expectedBinding:p.binding});await this.#fence();}
 async querySameOriginal(){
  // Query intentionally does not renew expired live Source or revive a signer.
  if(this.#closed||this.#busy||!this.#attempt)fail('NETWORK_CURRENT_QUERY_STATE');this.#busy=true;
  try{return Object.freeze({capture:await this.#capture.querySameOriginal(),store:await this.#store.querySameOriginal(),publication:this.#publicResult(),readOnly:true});}finally{this.#busy=false;}
 }
 async drain(){if(this.#busy)fail('NETWORK_CURRENT_BUSY');this.#retired=true;this.#busy=true;try{while(this.#stage<this.#children.length&&!this.#closeAmbiguous){try{const result=await this.#children[this.#stage]();this.#acceptVoid(result);this.#stage++;}catch(e){this.#remember(e);if(this.#stage>=6)this.#closeAmbiguous=true;break;}}this.#closed=this.#stage===this.#children.length;return Object.freeze({closed:this.#closed,hasCustodyDebt:!this.#closed,closeAmbiguous:this.#closeAmbiguous,stage:this.#stage,error:this.#first.present?this.#first.value:null,errorPresent:this.#first.present});}finally{this.#busy=false;}}
 status(){return this.#publicResult();}
}

// Fixed lexical-signer receiver. No generic raw-sign service is exported. A
// JSON/callback/correct DATA record cannot create a registered capture ref.
// The normal factory is currently closed because the original Native typed
// capture/paired-store producer and independent issuer selection are not supplied.
export function receiveOriginalNetworkCurrentSignerV1(reference,lexicalSigner){
 const held=readOriginalNetworkResourceCurrentPublisherReferenceV1(reference);
 // Original loader methods return void/bytes, not the explicit partial-result
 // envelopes used by the fixed orchestration boundary. Adapt ONLY here; never
 // treat an absent error from arbitrary callers as success.
 const signer=Object.freeze({
  async assertCurrent(view){await assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference);await lexicalSigner.assertCurrent(view);await assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference);return{error:null};},
  async signCurrent(message,binding,view){
   let member=null;try{await assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference);member=copy(await lexicalSigner.signCurrent(message,binding,view));await assertOriginalNetworkResourceCurrentPublisherReferenceV1(reference);return{partial:member,errorPresent:false,error:null};}
   catch(error){if(!member&&error&&Object.hasOwn(error,'partial')&&error.partial!=null)try{member=copy(error.partial);}catch{}return{partial:member,errorPresent:true,error};}
  },
  async retire(){await lexicalSigner.retire();return{error:null};},
  async join(){await lexicalSigner.join();return{error:null};},
  async close(){await lexicalSigner.close();return{error:null};}
 });
 return new OriginalNetworkCurrentCodecAdapter(held.capture,signer,held.store);
}
export function acquireOriginalNetworkResourceCurrentPublisherV1(...args){
 if(args.length)fail('NETWORK_CURRENT_ZERO_INPUT');
 return acquireOriginalNetworkResourceCurrentPublisherNormalV1();
}

