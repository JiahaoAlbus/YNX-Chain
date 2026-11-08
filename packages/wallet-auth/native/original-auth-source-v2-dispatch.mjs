import{SERVER_TLS_SOURCE_PURPOSE as TLS_PURPOSE,SERVER_TLS_SOURCE_SELECTION_KEY as TLS_KEY,SERVER_TLS_SOURCE_OPERATIONS as TLS_OPS,inspectOriginalServerTLSIdentityScopeV1DATA}from'./original-server-tls-source-contract.mjs';
import{DESKTOP_GRANT_SOURCE_PURPOSE as DGA_PURPOSE,DESKTOP_GRANT_SOURCE_SELECTION_KEY as DGA_KEY,DESKTOP_GRANT_SOURCE_OPERATIONS as DGA_OPS,inspectOriginalDesktopGrantAuthorityScopeV1DATA}from'./original-desktop-task-grant-source-contract.mjs';
import{snapshotWPRJSONDATA,captureWPRBatchDATA,sealWPRRegistrationCaptureDATA}from'./original-wallet-product-registration-capture.mjs';
import{WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE as WM_PURPOSE,WALLET_MOBILE_QUALIFIED_SOURCE_SELECTION_KEY as WM_KEY,WALLET_MOBILE_QUALIFIED_SOURCE_OPERATIONS as WM_OPS,inspectWalletMobileQualifiedSourceScopeV1DATA}from'./original-wallet-mobile-qualified-source-contract.mjs';
import{NETWORK_CURRENT_PUBLISHER_SOURCE_PURPOSE as NCP_PURPOSE,NETWORK_CURRENT_PUBLISHER_SELECTION_KEY as NCP_KEY,NETWORK_CURRENT_PUBLISHER_OPERATIONS as NCP_OPS,inspectOriginalNetworkCurrentPublisherScopeV1DATA}from'./original-network-current-publisher-source-contract.mjs';
import{NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE as NPR_PURPOSE,NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY as NPR_KEY,inspectOriginalNetworkPendingConsentSourceScopeV1DATA,captureOriginalNetworkPendingConsentOriginalsV1DATA,assertOriginalNetworkPendingConsentOriginalsCurrentV1DATA}from'./original-network-resource-pending-source-contract.mjs';
import{NETWORK_RESOURCE_SOURCE_PURPOSE as NR_PURPOSE,NETWORK_RESOURCE_SOURCE_SELECTION_KEY as NR_KEY,NETWORK_RESOURCE_SOURCE_OPERATIONS as NR_OPS,inspectOriginalNetworkResourceSourceScopeV2DATA,captureOriginalNetworkResourceOriginalsV1DATA,assertOriginalNetworkResourceOriginalsCurrentV1DATA}from'./original-network-resource-source-v2-contract.mjs';
import{WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE as WPR_PURPOSE}from'./original-wallet-product-source-contract.mjs';
import{BROWSER_SELECTED_PAGES_SOURCE_PURPOSE as BROWSER_PURPOSE}from'./original-browser-selected-pages-source-contract.mjs';
import{WALLET_NATIVE_PAY_CLIENT_SOURCE_PURPOSE as WPC_PURPOSE}from'./original-wallet-pay-client-source-contract.mjs';
import{AI_NATIVE_TASK_ACTION_V6_SOURCE_PURPOSE as AI_PURPOSE}from'./original-ai-task-action-v6-source-contract.mjs';
import{PAY_NATIVE_CLOUD_BILL_SOURCE_PURPOSE as PAY_PURPOSE}from'./original-pay-cloud-bill-source-contract.mjs';
// Same ORIGINAL bounded CLI, sole SDK327 Source v2 mathematics. No Source,
// Root, account, signer, arbitrary endpoint or granting callback is created.
import {randomBytes} from 'node:crypto';
import {canonical,sha,fetchSourceCurrentV2} from './original-auth-identity-source-verifier.mjs';
import {fetchOriginalNativeAuthorization} from './original-ide-auth-proof-dispatch.mjs';
import {verifyOriginalAuthSourceTransitionV2,verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {PQ_HOST_CATALOG_SOURCE_PURPOSE} from './original-pq-host-catalog-source-contract.mjs';
import {PRODUCT_DEVICE_V4_SOURCE_PURPOSE} from './original-product-device-v4-source-contract.mjs';
import {PRODUCT_DEVICE_V4_PENDING_PURPOSE} from './original-product-device-v4-pending-source-contract.mjs';
import {PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE} from './original-product-device-v4-provisioning-source-contract.mjs';
import {PRODUCT_DEVICE_V4_QUERY_PURPOSE} from './original-product-device-v4-query-source-contract.mjs';
import {PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE} from './original-product-device-v4-registered-finalization-source-contract.mjs';
import {PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE} from './original-product-session-http-v5-source-contract.mjs';
const devicePurposes=Object.freeze([PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE,PRODUCT_DEVICE_V4_QUERY_PURPOSE,PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE,PRODUCT_SESSION_HTTP_PROOF_V5_SOURCE_PURPOSE]);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_SOURCE_V2_DISPATCH_SCHEMA');
 const descriptors=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(descriptors);
 if(own.length!==keys.length||own.some(k=>!keys.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))fail('AUTH_SOURCE_V2_DISPATCH_SCHEMA');
};
function parsed(raw,cap){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>cap)fail('AUTH_SOURCE_V2_DISPATCH_CAPACITY');
 let value;try{value=JSON.parse(raw);}catch{fail('AUTH_SOURCE_V2_DISPATCH_CANONICAL');}
 if(canonical(value)!==raw)fail('AUTH_SOURCE_V2_DISPATCH_CANONICAL');return value;
}
// Untrusted hints select ONLY fixed-node public GETs; sole SDK subsequently
// verifies pinned originals, four current role registrations and full pairs.
function hint(raw){
 const e=parsed(raw,393216);if(e?.version!==2||e.algorithmVersion!=='YNX-BATCH/v0.1'||typeof e.body!=='string'||e.body.length>87384||!/^[A-Za-z0-9_-]+$/.test(e.body))fail('AUTH_SOURCE_V2_DISPATCH_ENVELOPE');
 const bytes=Buffer.from(e.body,'base64url');if(!bytes.length||bytes.length>65536||bytes.toString('base64url')!==e.body)fail('AUTH_SOURCE_V2_DISPATCH_ENCODING');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('AUTH_SOURCE_V2_DISPATCH_ENCODING');}return parsed(text,65536);
}
async function registrations(node,owners,networkId,get,capture,phase){
 const raw=await Promise.all(owners.map(owner=>get(node,owner)));
 const actual=capture?captureWPRBatchDATA(raw):raw;if(capture)capture[phase]=actual;
 const views=actual.map((dto,i)=>parsePQAccountAuthorization(dto,{chainId:networkId,nativeChainId:node.nativeChainId,owner:owners[i]}));
 const height=views[0].executionHeight;if(views.some(v=>v.executionHeight!==height))fail('AUTH_SOURCE_V2_DISPATCH_ROLE_HEIGHT_MISMATCH');
 return {root:views[0],profile:views[1],current:views[2],subject:views[3]};
}
// Optional getters are explicit PUBLIC DATA test seams only. The stdin branch
// NEVER accepts a function/module/provider/clock selector and passes neither.
export async function dispatchOriginalSourceV2(input,get=fetchOriginalNativeAuthorization,getCurrent=fetchSourceCurrentV2,networkOriginals){return runOriginalSourceV2(input,get,getCurrent,networkOriginals);}
// Private fixed WPR NodeHost capture. Not exposed by stdin or package exports.
// Optional getters remain PUBLIC test seams, never accepted over RPC/stdin.
export async function captureOriginalWalletProductSourceV2(input,get=fetchOriginalNativeAuthorization,getCurrent=fetchSourceCurrentV2){const detached=snapshotWPRJSONDATA(input,2097152);if(detached?.policy?.signatureContract?.purpose!==WPR_PURPOSE)fail('WPR_CAPTURE_PURPOSE');return runOriginalSourceV2(detached,get,getCurrent,undefined,{});}
async function runOriginalSourceV2(input,get,getCurrent,networkOriginals,capture){
 const pending=input?.policy?.signatureContract?.purpose===NPR_PURPOSE,nr=pending||input?.policy?.signatureContract?.purpose===NR_PURPOSE;const held=nr?(pending?captureOriginalNetworkPendingConsentOriginalsV1DATA:captureOriginalNetworkResourceOriginalsV1DATA)(networkOriginals):undefined;const fence=()=>{if(nr)(pending?assertOriginalNetworkPendingConsentOriginalsCurrentV1DATA:assertOriginalNetworkResourceOriginalsCurrentV1DATA)(held);};
 exact(input,['operation','node','rootRaw','enrollmentRaw','profileRaw','headRaw','policy','previous']);
 if(input.operation!=='auth-source-v2-native-node/v1')fail('AUTH_SOURCE_V2_DISPATCH_OPERATION');
 exact(input.node,['origin','spki','nativeChainId']);
 exact(input.policy.signatureContract,['purpose','enrollmentFrame','profileFrame','currentFrame']);
 // SAME original native-node entry as the dedicated Source verifier. Only
 // its independently release-selected purpose carries applicationId; legacy
 // purposes keep their exact five-field schema. The original N1 verifier
 // still checks the application against signed enrollment/profile originals.
 const ai=input.policy.signatureContract.purpose===AI_PURPOSE;
 const pay=[DGA_PURPOSE,TLS_PURPOSE,WM_PURPOSE,NCP_PURPOSE,NPR_PURPOSE,NR_PURPOSE,PAY_PURPOSE,WPC_PURPOSE,BROWSER_PURPOSE,WPR_PURPOSE].includes(input.policy.signatureContract.purpose);
 const pqCatalog=input.policy.signatureContract.purpose===PQ_HOST_CATALOG_SOURCE_PURPOSE;
 const device=devicePurposes.includes(input.policy.signatureContract.purpose);
 exact(input.policy,ai?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform','sourceRole']:pay?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId','platform']:device?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId','productId',...(input.policy.signatureContract.purpose===PRODUCT_DEVICE_V4_SOURCE_PURPOSE&&Object.hasOwn(input.policy,'platform')?['platform']:[])]:pqCatalog?['rootDigest','enrollmentDigest','endpoint','spki','signatureContract','applicationId']:['rootDigest','enrollmentDigest','endpoint','spki','signatureContract']);
 if(device&&Object.hasOwn(input.policy,'platform')&&input.policy.platform!=='linux')fail('AUTH_SOURCE_V2_DEVICE_PLATFORM');
 exact(input.previous,['sequence','floor','head','timeFloor','executionHeight']);
 const p=input.previous;
 if(!Number.isSafeInteger(p.sequence)||p.sequence<0||!Number.isSafeInteger(p.floor)||p.floor<0||p.floor>p.sequence||!Number.isSafeInteger(p.timeFloor)||p.timeFloor<0||Date.now()<p.timeFloor||!(p.head===''||typeof p.head==='string'&&/^[0-9a-f]{64}$/.test(p.head))||typeof p.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(p.executionHeight)||BigInt(p.executionHeight)>0xffffffffffffffffn)fail('AUTH_SOURCE_V2_DISPATCH_PREVIOUS');
 if(sha(input.rootRaw)!==input.policy.rootDigest||sha(input.enrollmentRaw)!==input.policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
 const root=parsed(input.rootRaw,16384),enrollment=hint(input.enrollmentRaw),profile=hint(input.profileRaw),head=hint(input.headRaw);
 if(root?.version!==2||root.algorithmVersion!=='YNX-BATCH/v0.1'||typeof root.networkId!=='string'||!/^[0-9a-f]{64}$/.test(root.networkId))fail('AUTH_SOURCE_V2_DISPATCH_ROOT');
 const owners=[root.rootOwner,enrollment.profileOwner,enrollment.currentOwner,profile.subjectOwner];
 if(owners.some(v=>typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v)))fail('AUTH_SOURCE_V2_DISPATCH_OWNER');
 const before=await registrations(input.node,owners,root.networkId,get,capture,'before');fence();
 // The held baseline is immutable and may predate a successful prior fetch.
 // Verify its own signed history from zero, then merge it with retained Native
 // watermarks. Passing a later Native sequence as the historical head's prior
 // would make every second current check spuriously fail as rollback.
 const baselineAtMs=Date.now();
 const baseline=verifyOriginalAuthSourceTransitionV2(input.rootRaw,input.enrollmentRaw,input.profileRaw,input.headRaw,input.policy,before,head.nonce,{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'},baselineAtMs,...(nr?[held]:[]));fence();
 if(baseline.historical!==true||baseline.dataOnly!==true||baseline.nativeAdmission!==false)fail('AUTH_SOURCE_V2_DISPATCH_BASELINE_RESULT');
 if(baseline.status!=='active')fail('AUTH_SOURCE_V2_DISPATCH_TERMINAL_BASELINE');
 if(BigInt(before.root.executionHeight)<BigInt(p.executionHeight))fail('AUTH_SOURCE_V2_DISPATCH_OBSERVATION_ROLLBACK');
 if(baseline.sequence===p.sequence&&p.head&&p.head!==baseline.head)fail('AUTH_SOURCE_V2_DISPATCH_EQUIVOCATION');
 const previous={sequence:Math.max(input.previous.sequence,baseline.sequence),floor:Math.max(input.previous.floor,baseline.floor),head:baseline.sequence>input.previous.sequence?baseline.head:input.previous.head,timeFloor:Math.max(input.previous.timeFloor,baseline.timeFloor),executionHeight:baseline.executionHeight};
 const nonce=randomBytes(32).toString('base64url');
 const currentRaw=await getCurrent(input.policy.endpoint,input.policy.spki,sha(input.profileRaw),nonce);
 const atMs=Date.now();
 const projection=verifyOriginalAuthSourceCurrentV2(input.rootRaw,input.enrollmentRaw,input.profileRaw,currentRaw,input.policy,before,nonce,previous,atMs,...(nr?[held]:[]));fence();
 const after=await registrations(input.node,owners,root.networkId,get,capture,'after');fence();
 for(const role of ['root','profile','current','subject']){
  assertPQAuthorizationCurrent(before[role],after[role]);
  if(before[role].executionHeight!==after[role].executionHeight)fail('AUTH_SOURCE_V2_DISPATCH_HEIGHT_CHANGED');
 }
 const now=Date.now();if(now<projection.timeFloor||now>=projection.expiresAtMs||projection.status!=='active'||projection.dataOnly!==true||projection.nativeAdmission!==false)fail('AUTH_SOURCE_V2_DISPATCH_POST_CURRENT_EXPIRED');
 fence();if(capture)return sealWPRRegistrationCaptureDATA({input,context:{node:input.node,networkId:root.networkId,owners},before:capture.before,after:capture.after,nonce,previous,baselineAtMs,atMs,afterAtMs:now,projection,currentRaw});return Object.freeze({projection,currentRaw});
}
