// Private offline collector DATA. Auth alone captures these values under its
// opaque SAME actor/Root/release/App/UID owner. No JS input establishes origin.
// This reuses the sole complete Source-v2 schema and registered N1 verifier;
// it does not implement a Root source, IO, keys, platform loader or Core bridge.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {verifyOriginalAuthSourceTransitionV2,verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {PRODUCT_DEVICE_V4_SOURCE_PURPOSE as PRIMARY} from './original-product-device-v4-source-contract.mjs';
import {PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE as PROVISION} from './original-product-device-v4-provisioning-source-contract.mjs';
import {PRODUCT_DEVICE_V4_QUERY_PURPOSE as QUERY} from './original-product-device-v4-query-source-contract.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('DEVICE_SOURCE_CAPTURE_SCHEMA');};
const parsed=(raw,max)=>{if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>max)fail('DEVICE_SOURCE_CAPTURE_CAPACITY');let v;try{v=JSON.parse(raw);}catch{fail('DEVICE_SOURCE_CAPTURE_CANONICAL');}if(canonical(v)!==raw)fail('DEVICE_SOURCE_CAPTURE_CANONICAL');return v;};
function hint(raw){const v=parsed(raw,393216);if(typeof v.body!=='string'||!/^[A-Za-z0-9_-]+$/.test(v.body))fail('DEVICE_SOURCE_CAPTURE_ENVELOPE');const b=Buffer.from(v.body,'base64url');if(!b.length||b.length>65536||b.toString('base64url')!==v.body)fail('DEVICE_SOURCE_CAPTURE_ENVELOPE');let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{fail('DEVICE_SOURCE_CAPTURE_UTF8');}return parsed(text,65536);}
function phase(raw,owners,node,network){if(!Array.isArray(raw)||raw.length!==4)fail('DEVICE_SOURCE_CAPTURE_REGISTRATION_BATCH');const names=['root','profile','current','subject'],views=raw.map((text,i)=>parsePQAccountAuthorization(parsed(text,393216),{chainId:network,nativeChainId:node.nativeChainId,owner:owners[i]}));if(views.some(x=>x.executionHeight!==views[0].executionHeight))fail('DEVICE_SOURCE_CAPTURE_ROLE_HEIGHT');return Object.fromEntries(names.map((k,i)=>[k,views[i]]));}
/** Canonical detached JSON from a private Native capture, never an App Source
 * installer. Primitive strings are snapshotted before parsing; no getters or
 * callbacks are read. Raw registrations are re-parsed against independent
 * selected context using the sole SDK branded parser, not copied JS brands. */
export function collectOriginalDeviceSourceV2CapturedDATA(captureOriginal){
 if(arguments.length!==1)fail('DEVICE_SOURCE_CAPTURE_ARGUMENTS');
 const c=parsed(captureOriginal,2097152);
 exact(c,['input','beforeRaw4','afterRaw4','currentRaw','nonce','baselineAtMs','currentAtMs','afterAtMs']);
 const i=c.input;exact(i,['operation','node','rootRaw','enrollmentRaw','profileRaw','headRaw','policy','previous']);
 if(i.operation!=='auth-source-v2-native-node/v1')fail('DEVICE_SOURCE_CAPTURE_OPERATION');
 exact(i.node,['origin','spki','nativeChainId']);
 // Purpose membership only narrows this collector. The SOLE verifier still
 // applies its exact policy/platform/enrollment/profile/operation schemas.
 if(![PRIMARY,PROVISION,QUERY].includes(i.policy?.signatureContract?.purpose))fail('DEVICE_SOURCE_CAPTURE_PURPOSE');
 exact(i.previous,['sequence','floor','head','timeFloor','executionHeight']);
 const p=i.previous;
 if(!Number.isSafeInteger(p.sequence)||p.sequence<0||!Number.isSafeInteger(p.floor)||p.floor<0||p.floor>p.sequence||!Number.isSafeInteger(p.timeFloor)||p.timeFloor<0||!(p.head===''||typeof p.head==='string'&&/^[0-9a-f]{64}$/.test(p.head))||typeof p.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(p.executionHeight)||BigInt(p.executionHeight)>0xffffffffffffffffn)fail('DEVICE_SOURCE_CAPTURE_PREVIOUS');
 for(const k of ['baselineAtMs','currentAtMs','afterAtMs'])if(!Number.isSafeInteger(c[k])||c[k]<p.timeFloor)fail('DEVICE_SOURCE_CAPTURE_CLOCK');
 if(c.currentAtMs<c.baselineAtMs||c.afterAtMs<c.currentAtMs)fail('DEVICE_SOURCE_CAPTURE_CLOCK');
 if(typeof c.nonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(c.nonce)||Buffer.from(c.nonce,'base64url').length!==32||Buffer.from(c.nonce,'base64url').toString('base64url')!==c.nonce)fail('DEVICE_SOURCE_CAPTURE_NONCE');
 if(sha(i.rootRaw)!==i.policy.rootDigest||sha(i.enrollmentRaw)!==i.policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
 const root=parsed(i.rootRaw,16384),enrollment=hint(i.enrollmentRaw),profile=hint(i.profileRaw),head=hint(i.headRaw);
 if(root?.version!==2||root.algorithmVersion!=='YNX-BATCH/v0.1'||typeof root.networkId!=='string'||!/^[0-9a-f]{64}$/.test(root.networkId))fail('DEVICE_SOURCE_CAPTURE_ROOT');
 const owners=[root.rootOwner,enrollment.profileOwner,enrollment.currentOwner,profile.subjectOwner];if(owners.some(v=>typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v)))fail('DEVICE_SOURCE_CAPTURE_OWNER');
 const before=phase(c.beforeRaw4,owners,i.node,root.networkId),after=phase(c.afterRaw4,owners,i.node,root.networkId);
 const baseline=verifyOriginalAuthSourceTransitionV2(i.rootRaw,i.enrollmentRaw,i.profileRaw,i.headRaw,i.policy,before,head.nonce,{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'},c.baselineAtMs);
 if(baseline.historical!==true||baseline.dataOnly!==true||baseline.nativeAdmission!==false||baseline.status!=='active')fail('DEVICE_SOURCE_CAPTURE_BASELINE');
 if(BigInt(before.root.executionHeight)<BigInt(p.executionHeight))fail('DEVICE_SOURCE_CAPTURE_OBSERVATION_ROLLBACK');
 if(baseline.sequence===p.sequence&&p.head&&p.head!==baseline.head)fail('DEVICE_SOURCE_CAPTURE_EQUIVOCATION');
 const previous={sequence:Math.max(p.sequence,baseline.sequence),floor:Math.max(p.floor,baseline.floor),head:baseline.sequence>p.sequence?baseline.head:p.head,timeFloor:Math.max(p.timeFloor,baseline.timeFloor),executionHeight:baseline.executionHeight};
 const projection=verifyOriginalAuthSourceCurrentV2(i.rootRaw,i.enrollmentRaw,i.profileRaw,c.currentRaw,i.policy,before,c.nonce,previous,c.currentAtMs);
 for(const role of ['root','profile','current','subject']){assertPQAuthorizationCurrent(before[role],after[role]);if(before[role].executionHeight!==after[role].executionHeight)fail('DEVICE_SOURCE_CAPTURE_HEIGHT_CHANGED');}
 if(c.afterAtMs<projection.timeFloor||c.afterAtMs>=projection.expiresAtMs||projection.status!=='active'||projection.dataOnly!==true||projection.nativeAdmission!==false)fail('DEVICE_SOURCE_CAPTURE_POST_CURRENT_EXPIRED');
 return Object.freeze({projection,currentRaw:c.currentRaw,captureSHA256:sha(captureOriginal),dataOnly:true,RootAdmission:false,SourceAdmission:false,nativeAdmission:false,platformRuntimeVerified:false});
}
