import {inspectIDEArtifactManifestData} from '@ynx-chain/wallet-auth/ide-artifact-manifest';
// Public semantics only, from the exact retained invocation. The original SDK
// owns canonical six-field validation; never normalize/re-serialize a request
// into a different signable original. A parsed manifest is NOT evidence that
// artifact bytes, publisher registration/current, Source or approval exist.
export function inspectWalletIDEPublicationReviewData(purpose,invocationOriginal){
 if(purpose!=='AUTH-PROTECTED-KEY-CALL')return null;
 if(typeof invocationOriginal!=='string'||!invocationOriginal.length||Buffer.byteLength(invocationOriginal)>16384||Buffer.from(invocationOriginal).toString()!==invocationOriginal)return null;
 let manifest;
 try{manifest=inspectIDEArtifactManifestData(new Uint8Array(Buffer.from(invocationOriginal)));}
 catch(cause){if(cause?.code==='IDE_ARTIFACT_MANIFEST_INVALID')return null;throw cause;}
 return Object.freeze({...manifest,dataOnly:true,artifactVerified:false,publisherCurrent:false,publicationAuthorized:false});
}
