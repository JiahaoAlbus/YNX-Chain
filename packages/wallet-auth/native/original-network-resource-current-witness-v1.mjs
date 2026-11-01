// Registered signed-evidence DATA only. Auth owns fixed typed IO, Root selection
// and actual Native Source/claim continuation. No files/providers/keys are opened.
import {types} from 'node:util';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2,verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {inspectOriginalNetworkResourceCurrent9V1DATA,captureOriginalNetworkResourceOriginalsV1DATA,assertOriginalNetworkResourceOriginalsCurrentV1DATA,NETWORK_RESOURCE_SOURCE_SELECTION_KEY} from './original-network-resource-source-v2-contract.mjs';
import {exactPQRecord,pqDecodeBase64url} from '../src/pq-wallet-contract.js';
import {inspectPQAuthorizationView} from '../src/pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from '../src/pq-registered-member.js';
const ROLE='current',PURPOSE='AUTH-SOURCE-CURRENT',handles=new WeakMap();
const typedArrayProto=Object.getPrototypeOf(Uint8Array.prototype),getByteLength=Object.getOwnPropertyDescriptor(typedArrayProto,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(typedArrayProto,'buffer').get;
const fail=code=>{throw Object.assign(Error(code),{code});};
const ownBytes=(v,max=393216)=>{if(types.isProxy(v)||!types.isUint8Array(v))fail('RESOURCE_CURRENT_WITNESS_OWNED_BYTES');const buffer=getBuffer.call(v),n=getByteLength.call(v);if(types.isSharedArrayBuffer(buffer)||!n||n>max)fail('RESOURCE_CURRENT_WITNESS_CAPACITY');const b=new Uint8Array(n);Uint8Array.prototype.set.call(b,v);return b;};
const text=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const exact=(v,keys)=>exactPQRecord(v,keys,'RESOURCE_CURRENT_WITNESS_SCHEMA');
const token=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(v))fail('RESOURCE_CURRENT_WITNESS_LOCATOR');};
const hex=v=>{if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail('RESOURCE_CURRENT_WITNESS_NETWORK');};
export function inspectNetworkResourceCurrentPublisherDescriptorV1DATA(value){
 exact(value,['version','networkId','sourceId','instanceId','resourceKey','publisherOwner','resourceCurrentFrame','originalLocator']);exact(value.originalLocator,['protectedResourceRef','leaf']);
 if(value.version!=='1'||value.originalLocator.leaf!=='source.current.original'||value.originalLocator.protectedResourceRef!==value.resourceKey)fail('RESOURCE_CURRENT_WITNESS_LOCATOR');hex(value.networkId);for(const k of ['sourceId','instanceId','resourceKey'])token(value[k]);if(typeof value.publisherOwner!=='string'||!/^0x[0-9a-f]{40}$/.test(value.publisherOwner)||typeof value.resourceCurrentFrame!=='string'||!value.resourceCurrentFrame.length||Buffer.byteLength(value.resourceCurrentFrame)>512||value.resourceCurrentFrame.includes('\0'))fail('RESOURCE_CURRENT_WITNESS_DESCRIPTOR');
 return Object.freeze({...value,originalLocator:Object.freeze({...value.originalLocator})});
}
function bodyOriginal(value){const body=inspectOriginalNetworkResourceCurrent9V1DATA(value);return {body,original:canonical(body)};}
function identity(body,d){if(body.sourceId!==d.sourceId||body.instanceId!==d.instanceId||body.resourceKey!==d.resourceKey)fail('RESOURCE_CURRENT_WITNESS_IDENTITY');}
function statement(descriptor,binding,current9){exact(binding,['networkId','owner','keyVersion','executionHeight']);const d=inspectNetworkResourceCurrentPublisherDescriptorV1DATA(descriptor),b=bodyOriginal(current9);identity(b.body,d);if(binding.networkId!==d.networkId||binding.owner!==d.publisherOwner)fail('RESOURCE_CURRENT_WITNESS_SIGNER');const message=encodeOriginalAuthSourceStatementV2(ROLE,d.resourceCurrentFrame,binding,b.original);return {descriptor:d,...b,message};}
/** Publisher pre-sign DATA. It does not supply a signing owner or authorize keys. */
export function encodeNetworkResourceCurrentWitnessStatementV1DATA(descriptor,binding,current9){const s=statement(descriptor,binding,current9);return Object.freeze({role:ROLE,certificatePurpose:PURPOSE,currentOriginal:s.original,messageOriginal:new Uint8Array(s.message),messageSHA256:sha(s.message),dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});}
export function encodeNetworkResourceCurrentWitnessEnvelopeV1DATA(descriptor,binding,current9,memberOriginal){const s=statement(descriptor,binding,current9),wire=ownBytes(memberOriginal,262144);return new Uint8Array(Buffer.from(canonicalOriginalAuthSourceEnvelopeV2(ROLE,binding,s.original,wire),'utf8'));}
/** currentOriginal is an independently retained P09/13 original, not a copy
 * extracted from this received envelope. expectedBinding may be null when no
 * independently verified publication receipt exists; then binding remains
 * untrusted claims until historical+current registered AND mathematics pass. */
export function inspectNetworkResourceCurrentWitnessV1DATA(envelopeOriginal,descriptor,independentRegisteredCurrentView,independent){
 exact(independent,['currentOriginal','atMs','expectedBinding']);const d=inspectNetworkResourceCurrentPublisherDescriptorV1DATA(descriptor),raw=ownBytes(envelopeOriginal),rawText=text(raw);let received;try{received=JSON.parse(rawText);}catch{fail('RESOURCE_CURRENT_WITNESS_CANONICAL');}
 const binding={networkId:received.networkId,owner:received.owner,keyVersion:received.keyVersion,executionHeight:received.executionHeight};let member,bodyText,current;
 try{member=pqDecodeBase64url(received.member,{max:262144});bodyText=text(pqDecodeBase64url(received.body,{max:65536}));current=bodyOriginal(JSON.parse(bodyText));}catch{fail('RESOURCE_CURRENT_WITNESS_BODY_CANONICAL');}
 if(current.original!==bodyText)fail('RESOURCE_CURRENT_WITNESS_BODY_CANONICAL');
 // Roundtrip through the SOLE envelope constructor rejects extra/missing fields,
 // wrong role/suite/version/base64 spelling and noncanonical JSON. No copied parser.
 if(canonicalOriginalAuthSourceEnvelopeV2(ROLE,binding,current.original,member)!==rawText)fail('RESOURCE_CURRENT_WITNESS_CANONICAL');
 const original=text(ownBytes(independent.currentOriginal,65536));if(original!==current.original)fail('RESOURCE_CURRENT_WITNESS_ORIGINAL_MISMATCH');const s=statement(d,binding,current.body);
 if(independent.expectedBinding!==null){exact(independent.expectedBinding,['networkId','owner','keyVersion','executionHeight']);if(canonical(independent.expectedBinding)!==canonical(binding))fail('RESOURCE_CURRENT_WITNESS_RECEIPT_MISMATCH');}
 const view=inspectPQAuthorizationView(independentRegisteredCurrentView);if(independentRegisteredCurrentView.networkId!==d.networkId||independentRegisteredCurrentView.owner!==d.publisherOwner||BigInt(binding.executionHeight)>BigInt(independentRegisteredCurrentView.executionHeight))fail('RESOURCE_CURRENT_WITNESS_REGISTERED_CONTEXT');const issued=inspectPQAuthorizationView(independentRegisteredCurrentView,binding.executionHeight);if(!issued.activeRecord||issued.activeRecord.revision!==binding.keyVersion||issued.authorizationStatus==='revoked')fail('RESOURCE_CURRENT_WITNESS_ISSUANCE_KEY');
 const math=verifyPQRegisteredMemberData(independentRegisteredCurrentView,member,{chainId:d.networkId,owner:d.publisherOwner,keyVersion:binding.keyVersion,executionHeight:independentRegisteredCurrentView.executionHeight,purpose:PURPOSE,message:s.message});
 if(math.memberCount!==1||math.memberIndex!==0)fail('RESOURCE_CURRENT_WITNESS_N1_REQUIRED');const at=independent.atMs;if(!Number.isSafeInteger(at)||at<0||at<current.body.issuedAtMs||at>=current.body.expiresAtMs)fail('RESOURCE_CURRENT_WITNESS_EXPIRED');
 const result=Object.freeze({currentOriginal:current.original,current:Object.freeze({...current.body}),envelopeOriginal:new Uint8Array(raw),binding:Object.freeze({...binding}),signatureMathVerified:true,receiptBindingCompared:independent.expectedBinding!==null,rootContextMathVerified:false,liveUsable:false,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});handles.set(result,{descriptor:d,original:current.original,raw:new Uint8Array(raw),view:independentRegisteredCurrentView,atMs:at,binding:Object.freeze({...binding})});return result;
}
/** AND the same signed current9 to the unchanged thirteen originals, then invoke
 * the original full Root/enrollment/profile/current verifier. A caller boolean,
 * FS JSON, fake inspection result or CLAIMED DTO cannot replace either stage. */
export function verifyNetworkResourceCurrentWitnessWithSourceV1DATA(witness,sourceInputs){
 const held=handles.get(witness);if(!held)fail('RESOURCE_CURRENT_WITNESS_REGISTERED_STAGE_REQUIRED');exact(sourceInputs,['rootRaw','enrollmentRaw','profileRaw','currentRaw','policy','registrations','expectedNonce','previous','atMs','networkOriginals']);if(sourceInputs.atMs!==held.atMs)fail('RESOURCE_CURRENT_WITNESS_CLOCK_CHANGED');
 const capture=captureOriginalNetworkResourceOriginalsV1DATA(sourceInputs.networkOriginals);if(canonical(capture.sourceCurrent)!==held.original)fail('RESOURCE_CURRENT_WITNESS_ORIGINAL_MISMATCH');if(sourceInputs.policy.signatureContract.currentFrame===held.descriptor.resourceCurrentFrame)fail('RESOURCE_CURRENT_WITNESS_DISTINCT_FRAME_REQUIRED');
 const projection=verifyOriginalAuthSourceCurrentV2(sourceInputs.rootRaw,sourceInputs.enrollmentRaw,sourceInputs.profileRaw,sourceInputs.currentRaw,sourceInputs.policy,sourceInputs.registrations,sourceInputs.expectedNonce,sourceInputs.previous,sourceInputs.atMs,capture);assertOriginalNetworkResourceOriginalsCurrentV1DATA(capture);
 const root=JSON.parse(sourceInputs.rootRaw),scope=projection.selection[NETWORK_RESOURCE_SOURCE_SELECTION_KEY],d=held.descriptor;if(root.networkId!==d.networkId||projection.sourceId!==d.sourceId||projection.instanceId!==d.instanceId||scope.resourceScope.protectedResourceRef!==d.resourceKey||projection.executionHeight!==held.view.executionHeight)fail('RESOURCE_CURRENT_WITNESS_ROOT_LOCATOR_MISMATCH');if(capture.sourceCurrent.status!=='active')fail('RESOURCE_CURRENT_WITNESS_NOT_LIVE');
 return Object.freeze({currentOriginal:held.original,envelopeOriginal:new Uint8Array(held.raw),signatureMathVerified:true,rootContextMathVerified:true,wholeThirteenOriginalsMatched:true,resourceEpoch:capture.sourceCurrent.epoch,resourceSequence:capture.sourceCurrent.sequence,sourceGeneration:projection.generation,sourceProjection:projection,dataOnly:true,liveUsable:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
/** No normal Root-selected descriptor/typed reader ABI has been supplied here.
 * Auth's actual fixed ownedReader and C-brand continuation remain owning CODE. */
export function acquireOriginalNetworkResourceCurrentWitnessReaderV1(...args){if(args.length)fail('RESOURCE_CURRENT_WITNESS_ZERO_INPUT');fail('NETWORK_RESOURCE_CURRENT_WITNESS_ROOT_READER_NOT_SUPPLIED');}
