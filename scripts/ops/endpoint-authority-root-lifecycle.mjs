// Pure reviewed-root preparation. No private key, signature, clock mutation,
// checkpoint write, network request or service activation occurs here.
import {createHash} from 'node:crypto';
import {assertAuthorityV2TrustRoot,assertAuthorityV2IssuancePolicy,canonicalAuthorityV2,verifySignedEndpointAuthority} from '../../sdk/js/endpoint-authority-v2.js';
import {validateAuthorityV2ReceiptFiles} from './endpoint-authority-v2.mjs';
const check=(ok,code)=>{if(!ok)throw new Error(code);};
const clone=x=>JSON.parse(canonicalAuthorityV2(x));
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function prepareEndpointAuthorityRootSuccessor({previousRoot,expectedPreviousRootSHA256,previousCheckpoint,anchorManifest,consumer,newPublicKey,nowMs}={}){
 const old=assertAuthorityV2TrustRoot(previousRoot);
 check(sha(canonicalAuthorityV2(old))===expectedPreviousRootSHA256,'AUTHORITY_V2_TRUST_ROOT_PIN_MISMATCH');
 check(Number.isSafeInteger(nowMs)&&nowMs>=0,'AUTHORITY_V2_CLOCK_REQUIRED');
 const previous=clone(previousCheckpoint),document=clone(anchorManifest);
 check(previous.rootVersion===old.rootVersion&&Number.isSafeInteger(previous.sequence)&&previous.sequence>0&&previous.sequence===document.sequence&&previous.payloadSha256===document.integrity?.payloadSha256,'AUTHORITY_V2_ANCHOR_CONFLICT');
 const issued=Date.parse(document.issuedAt);check(Number.isSafeInteger(issued)&&issued<=nowMs,'AUTHORITY_V2_HISTORY_FUTURE');
 // Historical authentication only. Expired prior authority is never active.
 await verifySignedEndpointAuthority(document,{trustRoot:old,checkpoint:previous,consumer,nowMs:issued});
 const key=clone(newPublicKey);
 check(key.algorithm==='Ed25519'&&key.revoked===false&&!old.keys.some(k=>k.keyId===key.keyId||k.publicKeyBase64url===key.publicKeyBase64url),'AUTHORITY_V2_NEW_FINITE_KEY_REQUIRED');
 const start=Date.parse(key.notBefore),end=Date.parse(key.notAfter);
 check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=nowMs&&start>=nowMs-60000&&end>nowMs+3600000&&end-start<=86400000,'AUTHORITY_V2_NEW_FINITE_KEY_WINDOW');
 const root=assertAuthorityV2TrustRoot({...clone(old),rootVersion:old.rootVersion+1,anchor:{...previous,rootVersion:old.rootVersion+1},keys:[...clone(old.keys),key]});
 check(canonicalAuthorityV2(root.keys.slice(0,-1))===canonicalAuthorityV2(old.keys)&&canonicalAuthorityV2(root.consumers)===canonicalAuthorityV2(old.consumers)&&root.maxValiditySeconds===old.maxValiditySeconds,'AUTHORITY_V2_ROOT_POLICY_CHANGED');
 return Object.freeze({trustRoot:root,canonicalSHA256:sha(canonicalAuthorityV2(root)),previousCheckpoint:previous,historicalAnchorAuthenticated:true,currentAuthorityVerified:false,signed:false,activated:false});
}
export function validateEndpointAuthorityLifecycleDraft({draft,trustRoot,checkpoint,consumer,nowMs,evidenceDirectory}={}){
 const {manifest,root}=assertAuthorityV2IssuancePolicy(draft,{trustRoot,checkpoint,consumer,nowMs});
 const receiptHashes=validateAuthorityV2ReceiptFiles(manifest,evidenceDirectory);
 return Object.freeze({payloadSHA256:manifest.integrity.payloadSha256,rootCanonicalSHA256:sha(canonicalAuthorityV2(root)),receiptHashes,receiptValidatorPassed:true,signed:false,activated:false});
}
