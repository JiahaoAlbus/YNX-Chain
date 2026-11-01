// Explicit NEW Source purpose. Fixed SDK v4 codecs, not new signature domains.
import {readFileSync} from 'node:fs';
import {canonicalJSON} from '../src/canonical.js';
import {evmAddressFromYNX} from '../src/crypto.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '../src/product-session-device-registration-v4.js';
import {parseProductSessionRequest,parseProductSessionChallenge,productSessionRequestDigest} from '../src/product-session-v2.js';
import {encodeProductSessionDeviceChallengeV4Message} from '../src/product-session-pq-v4-codec.js';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
export const PRODUCT_DEVICE_V4_PENDING_PURPOSE='product-session-device-pending-source-v4';
export const PRODUCT_DEVICE_V4_PENDING_OPERATIONS=Object.freeze(['device.registration-pop','device.challenge-completion']);
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_PENDING_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_PENDING_SCOPE'});};
const expectedFields=['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest'];
const parse=(raw,limit)=>{if(typeof raw!=='string'||Buffer.byteLength(raw)>limit)fail();const value=JSON.parse(raw);if(canonicalJSON(value)!==raw)fail();return value;};
export function inspectOriginalProductDeviceV4PendingScopeDATA(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at){
 exactPQRecord(scope,['version','operation','pendingId','expected','registrationOriginal','requestOriginal','approvalDigest','challengeOriginal']);exactPQRecord(scope.expected,expectedFields);exactPQRecord(association,['account','clientId','productId','platform','applicationId','deviceId']);
 const e=scope.expected;if(scope.version!=='4'||!['registration-pop','challenge-completion'].includes(scope.operation)||!/^[a-f0-9]{64}$/.test(scope.pendingId)||!/^[a-f0-9]{64}$/.test(scope.approvalDigest)||e.networkId!==networkId||e.canonicalOwner!==subjectOwner||evmAddressFromYNX(e.account)!==subjectOwner||![profileIssued,profileExpires,at].every(Number.isSafeInteger)||profileExpires<=profileIssued||at<profileIssued||at>=profileExpires)fail();
 const data=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(scope.registrationOriginal??'')),r=data.record;if(Buffer.byteLength(scope.registrationOriginal)>16384||r.revokedAt!==null||data.registrationDigest!==e.registrationDigest)fail();
 for(const k of expectedFields.filter(k=>!['account','registrationDigest'].includes(k)))if(r[k]!==e[k])fail();for(const k of Object.keys(association))if(e[k]!==association[k])fail();
 const q=parseProductSessionRequest(registry,parse(scope.requestOriginal,16384),new Date(at));if(q.version!=='4'||q.deviceRegistrationId!==e.registrationId||q.deviceRegistrationRevision!==e.revision||q.deviceRegistrationDigest!==e.registrationDigest)fail();for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(q[k]!==e[k])fail();
 let begin=Math.max(Date.parse(r.registeredAt),Date.parse(q.issuedAt)),end=Math.min(Date.parse(r.expiresAt),Date.parse(q.expiresAt));
 if(scope.operation==='registration-pop'){if(scope.challengeOriginal!==null)fail();}else{const c=parseProductSessionChallenge(parse(scope.challengeOriginal,16384));if(c.version!=='4'||c.account!==e.account||c.approvalDigest!==scope.approvalDigest||c.requestDigest!==productSessionRequestDigest(registry,q,new Date(at)))fail();for(const k of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','nonce','state'])if(c[k]!==q[k])fail();if(canonicalJSON(c.scopes)!==canonicalJSON(q.scopes)||c.accountAuthorization.canonicalOwner!==subjectOwner||c.accountAuthorization.networkId!==networkId||c.accountAuthorization.pkA===r.pkA||c.accountAuthorization.pkB===r.pkB)fail();encodeProductSessionDeviceChallengeV4Message(c,Buffer.from(scope.registrationOriginal));begin=Math.max(begin,Date.parse(c.issuedAt));end=Math.min(end,Date.parse(c.expiresAt));}
 if(profileIssued<begin||profileExpires>end||at<begin||at>=end)fail();
 return Object.freeze({devicePublic:Object.freeze({pkA:r.pkA,pkB:r.pkB}),expiresAtMs:end,accountAuthorization:scope.operation==='challenge-completion'?JSON.parse(scope.challengeOriginal).accountAuthorization:null,dataOnly:true,approvedAccount:false,registered:false,authorized:false,nativeAdmission:false});
}
