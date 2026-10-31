// Normal zero-input acquisition. No callback/ENV/JSON authority installer.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dispatchOriginalSourceV2} from './original-auth-source-v2-dispatch.mjs';
import {OriginalIDEDeploymentV2Kernel} from './original-ide-deployment-v2-kernel.mjs';
import {IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,fail} from './original-ide-deployment-v2-contract.mjs';
import {OriginalIDEDeploymentV2OnceJournal} from './original-ide-deployment-v2-journal.mjs';
import {sha,canonical} from './original-auth-identity-source-verifier.mjs';
const releaseSelectedDeploymentV2=Object.freeze([]);
// Actual fixed native adapter: all calls name dedicated E11 operations. There
// is no raw-message signer or arbitrary key/provider/path selector.
class OriginalDeploymentV2NativeAdapter{
 #native;#owner;#first;#closeSelected=false;#closeFirst;#journal=null;#row;#source;
 constructor(native,owner,row){this.#native=native;this.#owner=owner;this.#row=row;}
 async refreshSource(){const input=this.#native.copyOriginalIDEDeploymentV2SourceInput(this.#owner);if(input.policy.signatureContract.purpose!==IDE_DEPLOYMENT_V2_SOURCE_PURPOSE)fail('IDE_DEPLOYMENT_V2_DEDICATED_SOURCE_REQUIRED');const result=await dispatchOriginalSourceV2(input);const p=JSON.parse(Buffer.from(JSON.parse(input.profileRaw).body,'base64url')),r=JSON.parse(input.rootRaw);this.#native.retainOriginalIDEDeploymentV2SourceCurrent(this.#owner,result.currentRaw);this.#source={...result,purpose:IDE_DEPLOYMENT_V2_SOURCE_PURPOSE,networkId:r.networkId,profileIssuedAtMs:p.issuedAtMs,profileExpiresAtMs:p.expiresAtMs};return this.#source;}
 copyRegisteredOriginals(){return this.#native.copyOriginalIDEDeploymentV2RegisteredOriginals(this.#owner);}
 assertOriginalCurrent(expected){const r=this.#native.assertOriginalIDEDeploymentV2Current(this.#owner,expected);if(r!==0)fail('IDE_DEPLOYMENT_V2_NATIVE_CURRENT');this.#journal?.assertOriginalCurrent();}
 reserveOriginal(payload,current){const io=createRequire(import.meta.url)(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-source-current-dirfd.node',import.meta.url)));this.#journal=new OriginalIDEDeploymentV2OnceJournal(io,this.#row.journal);const p=this.#source.projection,s=p.selection.ideDeploymentV2;return this.#journal.reserveOriginal({sourceId:p.sourceId,instanceId:p.instanceId,requestId:s.requestId,payloadBinding:s.payloadBinding,scopeDigest:sha(canonical(s)),sourceCurrentSHA256:sha(current)});}
 captureOriginalReleaseKey(payload,artifact){return this.#native.captureOriginalIDEDeploymentV2ReleaseKey(this.#owner,payload,artifact);}
 invokeOriginalE11(){try{return this.#native.invokeOriginalIDEDeploymentV2E11(this.#owner);}catch(cause){const partial=this.#native.copyOriginalIDEDeploymentV2PublicPartial(this.#owner);return{...partial,status:partial.status||1,cause};}}
 completeOriginal(payload,member,current){return this.#journal.completeOriginal(Buffer.from(member).toString('base64url'),sha(current));}
 retire(){this.#native.retireOriginalIDEDeploymentV2(this.#owner);this.#journal?.retire();}
 join(){if(this.#native.joinOriginalIDEDeploymentV2(this.#owner)!==0)fail('IDE_DEPLOYMENT_V2_JOIN_PENDING');this.#journal?.join();}
 close(){if(this.#closeSelected){if(this.#closeFirst)throw this.#closeFirst;return;}this.#closeSelected=true;try{if(this.#native.closeOriginalIDEDeploymentV2(this.#owner)!==0)fail('IDE_DEPLOYMENT_V2_FIRST_CLOSE_UNKNOWN');this.#journal?.close();}catch(e){this.#closeFirst=e;throw e;}}
}
export function acquireOriginalIDEDeploymentV2Signer(){
 if(arguments.length)fail('IDE_DEPLOYMENT_V2_CALLER_FACTORY_FORBIDDEN');
 const row=releaseSelectedDeploymentV2[0];if(!row)fail('IDE_DEPLOYMENT_V2_ROOT_PROFILE_NOT_SUPPLIED');
 const native=createRequire(import.meta.url)(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-ide-deployment-v2.node',import.meta.url)));
 const opened=native.acquireOriginalIDEDeploymentV2();
 if(!opened.owner)fail('IDE_DEPLOYMENT_V2_NATIVE_ROOT_PROFILE_NOT_SUPPLIED');
 // Retain even a nonnull error partial before interpreting status.
 const adapter=new OriginalDeploymentV2NativeAdapter(native,opened.owner,row),owner=new OriginalIDEDeploymentV2Kernel(adapter);
 return Object.freeze({owner,error:opened.status===0?null:Object.assign(Error('IDE_DEPLOYMENT_V2_ACQUISITION_PARTIAL'),{code:'IDE_DEPLOYMENT_V2_ACQUISITION_PARTIAL',nativeStatus:opened.status})});
}
