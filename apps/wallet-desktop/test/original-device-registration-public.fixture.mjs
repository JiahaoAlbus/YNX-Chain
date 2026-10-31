// PUBLIC test worker only. Module redirects are installed ONLY for the new
// controller's fixed SDK import and authority's V4 prepare/sign/verify imports.
// This does NOT exercise Native/Source, cryptographic signatures or HTTP.
import {EventEmitter} from 'node:events';
import {canonicalJSON,createProductSessionRequest,productSessionRequestDigest,productPlatformBinding,ynxAddressFromEVM} from '@ynx-chain/wallet-auth';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
import {prepareProductSessionApprovalV4Data} from '@ynx-chain/wallet-auth/product-session-pq-v4-codec';
import assert from 'node:assert/strict';
export * from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
export * from '@ynx-chain/wallet-auth/product-session-pq-v4-codec';
let f;
export const configurePUBLICRegistration=value=>{f=value;};
export function createPUBLICSelection(account,networkId){
 const b=productPlatformBinding(f.registry,'developer','macos');
 return Object.freeze({identityBinding:Object.freeze({networkId,canonicalOwner:account,account:ynxAddressFromEVM(account),productId:b.productId,clientId:b.clientId,
  platform:b.platform,applicationId:b.applicationId,bundleId:b.bundleId,packageId:b.packageId,origin:b.origin,callback:b.callback,deviceId:'PUBLIC-original-device'}),
  generation:'1',publicPair:Object.freeze({pkA:Buffer.alloc(2592,0x33),pkB:Buffer.alloc(64,0x44)})});
}
function view(){
 const s=f.selection,i=s.identityBinding,at=f.at;
 const record={version:'4',registrationId:'00000000-0000-4000-8000-000000000002',networkId:i.networkId,canonicalOwner:i.canonicalOwner,
  productId:i.productId,clientId:i.clientId,platform:i.platform,applicationId:i.applicationId,bundleId:i.bundleId,packageId:i.packageId,
  origin:i.origin,callback:i.callback,deviceId:i.deviceId,generation:s.generation,revision:'1',pkA:Buffer.from(s.publicPair.pkA).toString('hex'),pkB:Buffer.from(s.publicPair.pkB).toString('hex'),
  registeredAt:new Date(+at-1000).toISOString(),expiresAt:new Date(+at+600000).toISOString(),revokedAt:null};
 const registrationOriginal=canonicalJSON(record),registrationDigest=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal)).registrationDigest;
 const b=productPlatformBinding(f.registry,i.productId,i.platform),request=createProductSessionRequest(f.registry,{productId:i.productId,platform:i.platform,deviceId:i.deviceId,
  deviceAlgorithm:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',deviceRegistrationId:record.registrationId,deviceRegistrationRevision:'1',deviceRegistrationDigest:registrationDigest,
  scopes:[b.scopes[0]],purpose:'PUBLIC independent account approval',nonce:'n'.repeat(43),state:'s'.repeat(43)},at);
 return Object.freeze({scope:Object.freeze({pendingId:'PUBLIC-pair-original',registrationOriginal}),record:Object.freeze(record),request,
  requestDigest:productSessionRequestDigest(f.registry,request,at),originalWindow:Object.freeze({beginsAt:request.issuedAt,expiresAt:request.expiresAt}),
  approvedAccount:false,authorized:false,registered:false,SourceAdmission:false,NativeAdmission:false});
}
export async function openOriginalProductDeviceV4RegistrationClient(...args){
 assert.equal(args.length,0);f.counts.open++;
 if(f.mode==='open-partial'){const e=Object.assign(Error('PUBLIC source acquisition'),{code:'PUBLIC_ACQUIRE'});e.partial={retire(){f.counts.partialRetire++;},async join(){f.counts.partialJoin++;},async close(){f.counts.partialClose++;}};throw e;}
 const original=view();f.view=original;let packet,ctx,raw=null,entered=false,closed=false;
 return Object.freeze({
  readOriginalRegistrationReviewDATA(selected){assert.deepEqual(selected,f.selection);f.counts.readReview++;return original;},
  async prepareOriginalPairSubmission(input){f.counts.prepare++;assert.equal(f.sourceRetired,false,'original account policy is alive during SDK prepare');
   assert.equal(input.approvalOriginal,f.approvalOriginal);assert.ok(input.policyRef);ctx=input.abortContext;assert.equal(Object.isFrozen(ctx),true);
   if(f.mode==='prepare-false')throw false;
   if(f.mode==='source-revoked-after-prepare')f.sourceRevoked=true;
   packet=Object.freeze({PUBLIC:true});return packet;},
  readOriginalPairRequestDATA(ref){assert.equal(ref,packet);const approval=JSON.parse(f.approvalOriginal);
   return Object.freeze({operationId:original.scope.pendingId,requestDigest:original.requestDigest,registrationOriginal:original.scope.registrationOriginal,
    originalBody:canonicalJSON({operationId:original.scope.pendingId,request:original.request,registrationOriginal:original.scope.registrationOriginal,registrationMember:'AA',approval}),
    dataOnly:true,registered:false,SourceAdmission:false,NativeAdmission:false});},
  async submitPreparedPair(ref,context){assert.equal(ref,packet);assert.equal(context,ctx);assert.equal(entered,false);entered=true;f.counts.submit++;
   assert.equal(f.sourceRetired,false,'original account Source is still alive at actual fixed SDK submit');
   const stored=await f.readDisk();assert.equal(stored.sessionOriginals[0].pairSubmission.entered,true);assert.ok(stored.sessionOriginals[0].approval.original);
   if(f.onSubmit)await f.onSubmit();
   if(f.mode==='http-false')throw false;
   if(f.mode==='http-error-close-false')throw Object.assign(Error('PUBLIC HTTP first failure'),{code:'PUBLIC_HTTP_FIRST'});
   if(f.mode==='lost-late-abort'){f.lifecycle.lock();throw Object.assign(Error('PUBLIC SDK gateway lost original'),{code:'PAIR_V4_HTTP_OUTCOME_UNKNOWN'});}
   raw=Object.freeze({original:canonicalJSON({registrationOriginal:original.scope.registrationOriginal,challenge:{version:'4',account:original.request.account??f.selection.identityBinding.account,requestDigest:original.requestDigest}})});
   if(f.mode==='late-lock')f.lifecycle.lock();
   if(f.mode==='non-http-partial'){raw=Object.freeze({partial:{retire(){}}});throw Object.assign(Error('PUBLIC no HTTP envelope'),{code:'PAIR_V4_HTTP_OUTCOME_UNKNOWN'});}
   return Object.freeze({operationId:original.scope.pendingId,responseOriginal:raw.original,registered:false,newSession:false,operationVerified:false});},
  readStatusDATA(){return Object.freeze({originalResponseRetained:raw!==null,originalResponse:raw,httpEntered:entered,registered:false,newSession:false});},
  async close(){if(closed)return;closed=true;f.counts.clientClose++;if(['client-close-false','http-error-close-false'].includes(f.mode))throw false;}
 });
}
export function preparePQProductSessionApprovalV4(...args){f.counts.plan++;const data=prepareProductSessionApprovalV4Data(...args);return {PUBLICUnsigned:data.unsigned};}
export function signPQWalletProductSessionApprovalV4(_handle,plan){f.counts.sign++;
 const approval=Object.freeze({...plan.PUBLICUnsigned,walletProof:'AA'});f.approvalOriginal=canonicalJSON(approval);return approval;}
export function verifyProductSessionApprovalV4Data(_registry,_request,approval){f.counts.verify++;return Object.freeze({approval,dataOnly:true,SourceAdmission:false,NativeAdmission:false});}
const windows=new WeakMap();
export const BrowserWindow={fromWebContents:sender=>windows.get(sender)};
export function createPUBLICRegistrationEvent(url){const sender=new EventEmitter();sender.mainFrame={url};sender.isDestroyed=()=>false;
 const window={isDestroyed:()=>false};windows.set(sender,window);return {sender,senderFrame:sender.mainFrame};}
