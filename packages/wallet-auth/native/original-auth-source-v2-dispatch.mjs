// Same ORIGINAL bounded CLI, sole SDK327 Source v2 mathematics. No Source,
// Root, account, signer, arbitrary endpoint or granting callback is created.
import {randomBytes} from 'node:crypto';
import {canonical,sha,fetchSourceCurrentV2} from './original-auth-identity-source-verifier.mjs';
import {fetchOriginalNativeAuthorization} from './original-ide-auth-proof-dispatch.mjs';
import {verifyOriginalAuthSourceTransitionV2,verifyOriginalAuthSourceCurrentV2} from './original-auth-identity-source-v2-verifier.mjs';
import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
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
async function registrations(node,owners,networkId,get){
 const raw=await Promise.all(owners.map(owner=>get(node,owner)));
 const views=raw.map((dto,i)=>parsePQAccountAuthorization(dto,{chainId:networkId,nativeChainId:node.nativeChainId,owner:owners[i]}));
 const height=views[0].executionHeight;if(views.some(v=>v.executionHeight!==height))fail('AUTH_SOURCE_V2_DISPATCH_ROLE_HEIGHT_MISMATCH');
 return {root:views[0],profile:views[1],current:views[2],subject:views[3]};
}
// Optional getters are explicit PUBLIC DATA test seams only. The stdin branch
// NEVER accepts a function/module/provider/clock selector and passes neither.
export async function dispatchOriginalSourceV2(input,get=fetchOriginalNativeAuthorization,getCurrent=fetchSourceCurrentV2){
 exact(input,['operation','node','rootRaw','enrollmentRaw','profileRaw','headRaw','policy','previous']);
 if(input.operation!=='auth-source-v2-native-node/v1')fail('AUTH_SOURCE_V2_DISPATCH_OPERATION');
 exact(input.node,['origin','spki','nativeChainId']);
 exact(input.policy,['rootDigest','enrollmentDigest','endpoint','spki','signatureContract']);
 exact(input.policy.signatureContract,['purpose','enrollmentFrame','profileFrame','currentFrame']);
 exact(input.previous,['sequence','floor','head','timeFloor','executionHeight']);
 const p=input.previous;
 if(!Number.isSafeInteger(p.sequence)||p.sequence<0||!Number.isSafeInteger(p.floor)||p.floor<0||p.floor>p.sequence||!Number.isSafeInteger(p.timeFloor)||p.timeFloor<0||Date.now()<p.timeFloor||!(p.head===''||typeof p.head==='string'&&/^[0-9a-f]{64}$/.test(p.head))||typeof p.executionHeight!=='string'||!/^(0|[1-9][0-9]*)$/.test(p.executionHeight)||BigInt(p.executionHeight)>0xffffffffffffffffn)fail('AUTH_SOURCE_V2_DISPATCH_PREVIOUS');
 if(sha(input.rootRaw)!==input.policy.rootDigest||sha(input.enrollmentRaw)!==input.policy.enrollmentDigest)fail('AUTH_SOURCE_V2_NOT_PINNED');
 const root=parsed(input.rootRaw,16384),enrollment=hint(input.enrollmentRaw),profile=hint(input.profileRaw),head=hint(input.headRaw);
 if(root?.version!==2||root.algorithmVersion!=='YNX-BATCH/v0.1'||typeof root.networkId!=='string'||!/^[0-9a-f]{64}$/.test(root.networkId))fail('AUTH_SOURCE_V2_DISPATCH_ROOT');
 const owners=[root.rootOwner,enrollment.profileOwner,enrollment.currentOwner,profile.subjectOwner];
 if(owners.some(v=>typeof v!=='string'||!/^0x[0-9a-f]{40}$/.test(v)))fail('AUTH_SOURCE_V2_DISPATCH_OWNER');
 const before=await registrations(input.node,owners,root.networkId,get);
 // The held baseline is immutable and may predate a successful prior fetch.
 // Verify its own signed history from zero, then merge it with retained Native
 // watermarks. Passing a later Native sequence as the historical head's prior
 // would make every second current check spuriously fail as rollback.
 const baseline=verifyOriginalAuthSourceTransitionV2(input.rootRaw,input.enrollmentRaw,input.profileRaw,input.headRaw,input.policy,before,head.nonce,{sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'},Date.now());
 if(baseline.historical!==true||baseline.dataOnly!==true||baseline.nativeAdmission!==false)fail('AUTH_SOURCE_V2_DISPATCH_BASELINE_RESULT');
 if(baseline.status!=='active')fail('AUTH_SOURCE_V2_DISPATCH_TERMINAL_BASELINE');
 if(BigInt(before.root.executionHeight)<BigInt(p.executionHeight))fail('AUTH_SOURCE_V2_DISPATCH_OBSERVATION_ROLLBACK');
 if(baseline.sequence===p.sequence&&p.head&&p.head!==baseline.head)fail('AUTH_SOURCE_V2_DISPATCH_EQUIVOCATION');
 const previous={sequence:Math.max(input.previous.sequence,baseline.sequence),floor:Math.max(input.previous.floor,baseline.floor),head:baseline.sequence>input.previous.sequence?baseline.head:input.previous.head,timeFloor:Math.max(input.previous.timeFloor,baseline.timeFloor),executionHeight:baseline.executionHeight};
 const nonce=randomBytes(32).toString('base64url');
 const currentRaw=await getCurrent(input.policy.endpoint,input.policy.spki,sha(input.profileRaw),nonce);
 const projection=verifyOriginalAuthSourceCurrentV2(input.rootRaw,input.enrollmentRaw,input.profileRaw,currentRaw,input.policy,before,nonce,previous,Date.now());
 const after=await registrations(input.node,owners,root.networkId,get);
 for(const role of ['root','profile','current','subject']){
  assertPQAuthorizationCurrent(before[role],after[role]);
  if(before[role].executionHeight!==after[role].executionHeight)fail('AUTH_SOURCE_V2_DISPATCH_HEIGHT_CHANGED');
 }
 const now=Date.now();if(now<projection.timeFloor||now>=projection.expiresAtMs||projection.status!=='active'||projection.dataOnly!==true||projection.nativeAdmission!==false)fail('AUTH_SOURCE_V2_DISPATCH_POST_CURRENT_EXPIRED');
 return Object.freeze({projection,currentRaw});
}
