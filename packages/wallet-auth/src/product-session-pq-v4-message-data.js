// Sole ORIGINAL v4 message grammar moved from Node facade; DATA only. No
// signing, member verifier, registered approval or new signature domain.
import{encodeFields,u32}from'@ynx/batch-v01-candidate/browser';
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{parseProductSessionChallenge}from'./product-session-v2.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'./product-session-device-registration-v4.js';
import{evmAddressFromYNX}from'./crypto.js';
import{pqHexBytes}from'./pq-public-bytes.js';
export const PRODUCT_SESSION_APPROVAL_DOMAIN_V4='YNX-PRODUCT-SESSION-APPROVAL/v4';
export const PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4='YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4';
export const PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4='YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4';
const fail=code=>{throw new WalletAuthError(code,code);};
export function originalV4RegistrationForRequestDATA(request,original,account,at){
 const view=inspectProductSessionDeviceRegistrationOriginalV4Data(original),r=view.record;
 if(request.version!=='4'||r.canonicalOwner!==evmAddressFromYNX(account)||r.registrationId!==request.deviceRegistrationId||r.revision!==request.deviceRegistrationRevision||view.registrationDigest!==request.deviceRegistrationDigest||r.revokedAt!==null||r.registeredAt>at.toISOString()||r.expiresAt<=at.toISOString())fail('PQ_PAIRING_ORIGINAL_MISMATCH');
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(r[k]!==request[k])fail('PQ_PAIRING_ORIGINAL_MISMATCH');return r;
}
function E5(domain,networkId,owner,body){const raw=encodeFields([domain,u32(4),pqHexBytes(networkId,32),owner,canonicalJSON(body)]);if(raw.length>16384)fail('PQ_SESSION_MESSAGE_TOO_LARGE');return raw;}
export{E5 as encodeOriginalProductSessionV4E5DATA};
export function encodeProductSessionDeviceChallengeV4Message(challenge,registrationOriginal){
 const c=parseProductSessionChallenge(challenge),r=originalV4RegistrationForRequestDATA(c,registrationOriginal,c.account,new Date(c.issuedAt));if(c.version!=='4'||c.expiresAt>r.expiresAt||c.sessionExpiresAt>r.expiresAt||c.accountAuthorization.networkId!==r.networkId)fail('PQ_PAIRING_ORIGINAL_MISMATCH');
 return E5(PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,r.networkId,r.canonicalOwner,{challenge:c,registration:r});
}
export function encodeProductSessionDeviceRegistrationV4Message(registrationOriginal){const r=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal).record;return E5(PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4,r.networkId,r.canonicalOwner,r);}
