// Owning lifecycle CODE. Test seams here are PUBLIC only; normal consumers
// cannot install adapters/signers/Source callbacks through the public facade.
import {createVerifier,decodeMember} from '@ynx/batch-v01-candidate';
import {decodeDeploymentManifestV2DATA,assertDeploymentArtifactV2DATA,bindDeploymentV2Bytes} from '@ynx-chain/open-protocol/deployment-v2';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {types} from 'node:util';
import {IDE_DEPLOYMENT_V2_SOURCE_PURPOSE as PURPOSE,IDE_DEPLOYMENT_V2_SIGNATURE_PURPOSE as SIGNATURE_PURPOSE,inspectOriginalIDEDeploymentV2ScopeDATA as inspect,exact,same,wire,fail} from './original-ide-deployment-v2-contract.mjs';
const attempts=new Map();
const freeze=v=>{const x=structuredClone(v);const f=o=>{if(o&&typeof o==='object'){for(const v of Object.values(o))f(v);Object.freeze(o);}return o;};return f(x);};
const typed=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(typed,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(typed,'buffer').get,setBytes=Uint8Array.prototype.set;
function capture(v,max,allowEmpty=false){if(types.isProxy(v)||!types.isUint8Array(v))fail('IDE_DEPLOYMENT_V2_BYTES');const n=getLength.call(v),buffer=getBuffer.call(v);if(types.isSharedArrayBuffer(buffer)||n>max||!n&&!allowEmpty)fail('IDE_DEPLOYMENT_V2_BYTES');const out=new Uint8Array(n);setBytes.call(out,v);return out;}
export class OriginalIDEDeploymentV2Kernel{
 #adapter;#entered=false;#used=false;#retired=false;#unknown=false;#first;#closeSelected=false;#closeFirst;#closed=false;#floor=-1;#mono=-1;#end=Infinity;#deadline=Infinity;#startedWall=0;#startedMono=0;#partial;#view;#source;
 constructor(adapter){this.#adapter=adapter;}
 #clock(){const n=Date.now(),m=performance.now();if(!Number.isSafeInteger(n)||n<this.#floor||m<this.#mono||n>=this.#end||m>=this.#deadline)fail('IDE_DEPLOYMENT_V2_FINAL_WINDOW');this.#floor=n;this.#mono=m;return n;}
 #alive(){if(this.#retired||this.#closed||this.#unknown)fail('IDE_DEPLOYMENT_V2_UNRESOLVED');this.#clock();}
 #remember(e){this.#unknown=true;this.#first??=e;return Object.assign(new Error(this.#first.code??'IDE_DEPLOYMENT_V2_UNKNOWN_RECONCILE'),{code:this.#first.code??'IDE_DEPLOYMENT_V2_UNKNOWN_RECONCILE',cause:this.#first,partial:freeze(this.#partial??{}),retryAllowed:false});}
 #inspect(state){
  const p=state.projection;
  if(state.purpose!==PURPOSE||!p||p.dataOnly!==true||p.nativeAdmission!==false||p.status!=='active'||!p.sourceId||!p.instanceId||!p.profileDigest||this.#clock()<p.timeFloor||this.#floor>=p.expiresAtMs)fail('IDE_DEPLOYMENT_V2_SOURCE_CURRENT');
  const s=p.selection;exact(s,['association','expectedRequest','originalHostStatePath','originalHostTerminalDirectory','ideDeploymentV2']);
  const v=inspect(s.ideDeploymentV2,s.association,state.networkId,p.subjectOwner,p.sourceId,p.instanceId,p.generation,state.profileIssuedAtMs,state.profileExpiresAtMs,this.#clock());
  this.#end=Math.min(this.#end,p.expiresAtMs,v.expiresAtMs);this.#deadline=Math.min(this.#deadline,this.#startedMono+this.#end-this.#startedWall);this.#clock();return v;
 }
 async #refresh(){this.#alive();const state=await this.#adapter.refreshSource();this.#partial.sourceCurrentOriginal=state.currentRaw??'';const view=this.#inspect(state);if(this.#source){for(const k of ['profileDigest','sourceId','instanceId','generation','sequence','floor','head','subjectOwner','subjectKeyVersion'])same(this.#source.projection[k],state.projection[k],'IDE_DEPLOYMENT_V2_SOURCE_CHANGED');same(this.#source.projection.selection,state.projection.selection,'IDE_DEPLOYMENT_V2_SELECTION_CHANGED');}this.#source=freeze(state);this.#view=view;return state;}
 #registered(){const rows=this.#adapter.copyRegisteredOriginals();exact(rows,['publisherOriginal','issuerOriginal','projectOriginal','resourceOriginal','approvalOriginal']);const scope=this.#source.projection.selection.ideDeploymentV2;for(const k of Object.keys(rows))if(rows[k]!==scope[k])fail('IDE_DEPLOYMENT_V2_REGISTERED_ORIGINAL_CHANGED');return rows;}
 #fence(){this.#alive();const expected={purpose:PURPOSE,profileDigest:this.#source.projection.profileDigest,sourceId:this.#source.projection.sourceId,instanceId:this.#source.projection.instanceId,head:this.#source.projection.head,sourceCurrentOriginal:this.#source.currentRaw,payloadBinding:bindDeploymentV2Bytes(wire(this.#partial.payloadOriginal,16384)),publisherEpoch:this.#view.publisher.epoch,issuerEpoch:this.#view.issuer.epoch};this.#adapter.assertOriginalCurrent(expected);this.#registered();this.#clock();this.#alive();}
 async signOriginalE11(payloadOriginal,actualArtifact){
  if(this.#used||this.#entered)fail('IDE_DEPLOYMENT_V2_ALREADY_ATTEMPTED_RECONCILE');this.#used=true;this.#entered=true;
  try{
   this.#alive();this.#startedWall=this.#clock();this.#startedMono=performance.now();const payload=capture(payloadOriginal,16384),artifact=capture(actualArtifact,67108864,true),dto=decodeDeploymentManifestV2DATA(payload),binding=bindDeploymentV2Bytes(payload);assertDeploymentArtifactV2DATA(payload,artifact);
   this.#partial={phase:'CAPTURED',payloadOriginal:Buffer.from(payload).toString('base64url'),payloadBinding:binding,artifactBinding:bindDeploymentV2Bytes(artifact),sourceCurrentOriginal:'',reservationOriginal:'',memberOriginal:'',coreStatus:null,cleanupStatus:null,reportedStatus:null,signed:false,sourceGranted:false,nativeAdmission:false,deployed:false};
   await this.#refresh();same(dto,this.#view.dto,'IDE_DEPLOYMENT_V2_EXPECTED_E11_CHANGED');same(binding,this.#source.projection.selection.ideDeploymentV2.payloadBinding);if(!Buffer.from(payload).equals(this.#view.payload))fail('IDE_DEPLOYMENT_V2_APPROVED_PAYLOAD_CHANGED');
   this.#registered();this.#fence();
   const key=canonical({sourceId:this.#source.projection.sourceId,instanceId:this.#source.projection.instanceId,requestId:this.#source.projection.selection.ideDeploymentV2.requestId});
   if(attempts.has(key))throw Object.assign(new Error('IDE_DEPLOYMENT_V2_DURABLE_UNKNOWN_RECONCILE'),{code:'IDE_DEPLOYMENT_V2_DURABLE_UNKNOWN_RECONCILE',partial:attempts.get(key)});attempts.set(key,freeze(this.#partial));
   const retain=()=>attempts.set(key,freeze(this.#partial));
   try{
    // Native supplies actual durable once reservation. Retain its PUBLIC
    // original BEFORE interpreting status; no UNKNOWN retry/re-sign.
    const reservation=this.#adapter.reserveOriginal(payload,this.#source.currentRaw);this.#partial.reservationOriginal=reservation.reservationOriginal??'';this.#partial.phase='RESERVED_PARTIAL';retain();if(reservation.status!==0)fail('IDE_DEPLOYMENT_V2_RESERVATION_UNKNOWN');
    this.#fence();const captured=this.#adapter.captureOriginalReleaseKey(payload,artifact);this.#partial.phase='KEY_CAPTURED_PARTIAL';retain();if(captured.status!==0)fail('IDE_DEPLOYMENT_V2_RELEASE_CUSTODY_UNAVAILABLE');this.#fence();
    const signed=this.#adapter.invokeOriginalE11();
    // Original output is retained before status, signature or late fences.
    if(signed.memberOriginal?.length)this.#partial.memberOriginal=Buffer.from(capture(signed.memberOriginal,262144)).toString('base64url');this.#partial.coreStatus=signed.coreStatus??null;this.#partial.cleanupStatus=signed.cleanupStatus??null;this.#partial.reportedStatus=signed.status;this.#partial.phase='SIGNED_PUBLIC_PARTIAL';retain();if(signed.status!==0)fail('IDE_DEPLOYMENT_V2_SIGN_UNKNOWN');
    const member=wire(this.#partial.memberOriginal),pub=this.#view.publisher,m=decodeMember(member),c=m.certificate;
    if(c.N!==1||m.index!==0||c.owner!==pub.subjectOwner||c.purpose!==SIGNATURE_PURPOSE||!c.pkA.equals(wire(pub.pkA,2592))||!c.pkB.equals(wire(pub.pkB,64))||!m.message.equals(Buffer.from(payload)))fail('IDE_DEPLOYMENT_V2_SIGNATURE_BINDING');
    const verifier=createVerifier({provider:'portable',chainId:Buffer.from(pub.networkId,'hex'),purpose:SIGNATURE_PURPOSE,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:'YNX-BATCH/v0.1',enabled:true,owner:pub.subjectOwner,purpose:SIGNATURE_PURPOSE,policyRevision:pub.epoch,chainId:Buffer.from(pub.networkId,'hex'),pkA:wire(pub.pkA,2592),pkB:wire(pub.pkB,64),activeFrom:0,revokedAt:null})});
    try{if(!verifier.verifyOne(member,{height:0}))fail('IDE_DEPLOYMENT_V2_DUAL_SIGNATURE');}finally{verifier.clear();}
    await this.#refresh();this.#fence();
    const terminal=this.#adapter.completeOriginal(payload,member,this.#source.currentRaw);this.#partial.phase='TERMINAL_PUBLIC_PARTIAL';retain();if(terminal.status!==0)fail('IDE_DEPLOYMENT_V2_TERMINAL_UNKNOWN');
    this.#fence();this.#partial.signed=true;this.#partial.phase='RETURNED';retain();return freeze(this.#partial);
   }catch(e){retain();throw e;}
  }catch(e){throw this.#remember(e);}finally{this.#entered=false;}
 }
 retire(){this.#retired=true;this.#adapter.retire();}
 join(){if(this.#entered)fail('IDE_DEPLOYMENT_V2_JOIN_PENDING');this.#adapter.join();}
 close(){if(this.#closeSelected){if(this.#closeFirst)throw this.#closeFirst;return;}this.retire();this.join();this.#closeSelected=true;try{this.#adapter.close();this.#closed=true;}catch(e){this.#closeFirst=e;throw e;}}
 status(){return freeze({used:this.#used,unknown:this.#unknown,firstCause:this.#first?.code??null,closeSelected:this.#closeSelected,closeFirst:this.#closeFirst?.code??null,closed:this.#closed,partial:this.#partial??null});}
}
