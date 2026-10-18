// Device-bound pending data only. There is deliberately no local issuer or
// PQ verifier here: completion/outcome enter the existing fixed Auth service.
import {p256} from '@noble/curves/nist.js';
import {decodeBase64url} from './base64url.js';
import {canonicalJSON,digestHex,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSessionRequest,parseProductSessionChallenge,parseProductSession,productSessionRequestDigest} from './product-session-v2.js';
export const REFERENCE_COMPLETION_VERSION='YNX-PRODUCT-SESSION-RETURN-REFERENCE/v1';
const fail=(code,message)=>{throw new WalletAuthError(code,message);};
export function assertReferenceChallenge(registry,requestInput,input){
 const challenge=parseProductSessionChallenge(input),request=parseProductSessionRequest(registry,requestInput,new Date(challenge.issuedAt));
 for(const key of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceKey','nonce','state'])if(challenge[key]!==request[key])fail('SESSION_BINDING_MISMATCH','Original reference challenge changed its request binding');
 if(challenge.requestDigest!==productSessionRequestDigest(registry,request,new Date(challenge.issuedAt))||canonicalJSON(challenge.scopes)!==canonicalJSON(request.scopes)||canonicalJSON(challenge.serviceConsent??null)!==canonicalJSON(request.serviceConsent??null)||challenge.expiresAt>request.expiresAt||request.serviceConsent&&challenge.sessionExpiresAt!==request.serviceConsent.expiresAt)fail('SESSION_BINDING_MISMATCH','Original reference challenge changed its digest, scopes or lifetime');
 return Object.freeze({request,challenge});
}
export function inspectReferenceCompletion(registry,raw,requireSigned=false){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16384)fail('INVALID_SESSION_STORE','Original reference completion exceeds its bound');
 let value;try{value=JSON.parse(raw);}catch{fail('INVALID_SESSION_STORE','Original reference completion is invalid JSON');}
 exactFields(value,['version','reference','request','completion'],'Original reference completion');
 if(canonicalJSON(value)!==raw||value.version!==REFERENCE_COMPLETION_VERSION||!/^ynxpsr1_[A-Za-z0-9_-]{43}$/.test(value.reference))fail('INVALID_SESSION_STORE','Original reference completion is invalid');
 exactFields(value.completion,['challenge','deviceSignature'],'Original reference device proof');
 const {request,challenge}=assertReferenceChallenge(registry,value.request,value.completion.challenge),signature=value.completion.deviceSignature;
 if(signature===null){if(requireSigned)fail('ORIGINAL_PRIVATE_OUTCOME_UNKNOWN','Original device signing is unresolved; no replacement is permitted');}
 else{
  let valid=false;try{valid=p256.verify(decodeBase64url(signature,'deviceSignature'),new TextEncoder().encode('YNX_PRODUCT_SESSION_CHALLENGE_V2\n'+canonicalJSON(challenge)),decodeBase64url(challenge.deviceKey,'deviceKey'),{format:'der',lowS:false});}catch{}
  if(!valid)fail('INVALID_DEVICE_PROOF','Original reference device signature is invalid');
 }
 return Object.freeze({version:value.version,reference:value.reference,request,completion:Object.freeze({challenge,deviceSignature:signature}),accountVerified:false});
}
export function assertReferenceSession(record,input){
 const session=parseProductSession(input),challenge=record.completion.challenge;
 if(session.version!=='3'||session.sessionBinding!==digestHex('YNX_PRODUCT_SESSION_BINDING_V2',challenge))fail('SESSION_BINDING_MISMATCH','Auth returned a different reference session');
 for(const key of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','account','deviceId','deviceAlgorithm','deviceKey','nonce','state','requestDigest','approvalDigest','issuedAt'])if(session[key]!==challenge[key])fail('SESSION_BINDING_MISMATCH','Auth returned a different reference binding');
 if(session.expiresAt!==challenge.sessionExpiresAt||canonicalJSON(session.scopes)!==canonicalJSON(challenge.scopes)||canonicalJSON(session.serviceConsent??null)!==canonicalJSON(challenge.serviceConsent??null))fail('SESSION_BINDING_MISMATCH','Auth returned a different reference scope or lifetime');
 return session;
}
