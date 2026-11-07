// Build-only public DATA. No key loader, signer, Native constructor or publication IO.
import {types} from 'node:util';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {verifyOriginalAuthSourceProfileV2,verifyOriginalAuthSourceCurrentV2,verifyOriginalAuthSourceTransitionV2,inspectOriginalWalletProductSourceIssuanceBodyDATA} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {inspectOriginalAuthSourceIssuanceApprovalV2DATA} from './original-auth-source-issuance-approval-data.js';
import {WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE as PURPOSE} from '../native/original-wallet-product-source-contract.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const flags=Object.freeze({dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,keysOpened:false,signaturesIssued:false,filesPublished:false});
const exact=(v,keys)=>{if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('WPR_MATERIALIZER_DATA_SCHEMA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).some(k=>typeof k!=='string')||Object.keys(d).sort().join('|')!==[...keys].sort().join('|')||Object.values(d).some(x=>!Object.hasOwn(x,'value')))fail('WPR_MATERIALIZER_DATA_SCHEMA');return v;};
function inert(v,seen=new Set(),depth=0){if(v===null||typeof v!=='object')return;if(types.isProxy(v)||depth>32||seen.has(v))fail('WPR_MATERIALIZER_INERT_DATA_REQUIRED');if(types.isUint8Array(v))return;if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)fail('WPR_MATERIALIZER_INERT_DATA_REQUIRED');seen.add(v);const ds=Object.getOwnPropertyDescriptors(v);for(const key of Reflect.ownKeys(ds)){if(typeof key!=='string'||!Object.hasOwn(ds[key],'value'))fail('WPR_MATERIALIZER_INERT_DATA_REQUIRED');inert(ds[key].value,seen,depth+1);}seen.delete(v);}
const same=(a,b)=>{if(canonical(a)!==canonical(b))fail('WPR_MATERIALIZER_DATA_BINDING');};
function raw(s,cap=393216){if(typeof s!=='string'||Buffer.byteLength(s)>cap)fail('WPR_MATERIALIZER_ORIGINAL_BYTES');let d;try{d=JSON.parse(s);}catch{fail('WPR_MATERIALIZER_ORIGINAL_BYTES');}if(canonical(d)!==s)fail('WPR_MATERIALIZER_NONCANONICAL');return d;}
function envelopeBody(s){const e=raw(s);if(typeof e.body!=='string'||!/^[A-Za-z0-9_-]+$/.test(e.body))fail('WPR_MATERIALIZER_ENVELOPE');const bytes=Buffer.from(e.body,'base64url');if(bytes.toString('base64url')!==e.body)fail('WPR_MATERIALIZER_ENVELOPE');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);return {envelope:e,original:text,body:raw(text,65536)};}
function pin(x,cap=16777216){exact(x,['path','bytes','sha256']);if(typeof x.path!=='string'||!x.path.startsWith('/')||x.path.includes('\0')||x.path.split('/').some(p=>p==='.'||p==='..')||!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>cap||!/^[a-f0-9]{64}$/.test(x.sha256))fail('WPR_MATERIALIZER_FILE_PIN');return {...x};}
const originalPin=s=>({bytes:Buffer.byteLength(s),sha256:sha(s)});
function previous(v){return {sequence:v.sequence,floor:v.floor,head:v.head,timeFloor:v.timeFloor,executionHeight:v.executionHeight};}
/** Independently captured public originals/role views only. This function does
 * mathematics and DATA consistency, never authenticates its caller or grants a
 * publication owner. Native's real held issuer/publication loan remains required.
 */
export function materializeOriginalWalletProductPublicDATA(input){
 inert(input);
 exact(input,['originals','policy','registrations','currentContext','approvals','build','independentBuildOriginal','buildOriginals']);
 exact(input.originals,['root','enrollment','profile','acquisitionHead','freshCurrent']);
 exact(input.registrations,['acquisition','fresh']);
 exact(input.currentContext,['acquisitionNonce','freshNonce','previous','atMs']);
 exact(input.build,['root','enrollment','verifier','node','runtime','nativeNode','applicationId','productId','platform','uid','resourceDirectory']);
 const o=input.originals,ctx=input.currentContext;for(const v of Object.values(o))raw(v);if(!Number.isSafeInteger(ctx.atMs)||ctx.atMs<0||ctx.acquisitionNonce===ctx.freshNonce)fail('WPR_MATERIALIZER_FRESH_CONTEXT');
 if(input.policy?.signatureContract?.purpose!==PURPOSE)fail('WPR_MATERIALIZER_PURPOSE');
 // Full Root/enrollment/profile N1/registered pairs and exact WPR scope use the
 // sole verifier. Initial historical head is a baseline, never live admission.
 verifyOriginalAuthSourceProfileV2(o.root,o.enrollment,o.profile,input.policy,input.registrations.acquisition,ctx.atMs);
 const acquired=verifyOriginalAuthSourceTransitionV2(o.root,o.enrollment,o.profile,o.acquisitionHead,input.policy,input.registrations.acquisition,ctx.acquisitionNonce,ctx.previous,ctx.atMs);
 const fresh=verifyOriginalAuthSourceCurrentV2(o.root,o.enrollment,o.profile,o.freshCurrent,input.policy,input.registrations.fresh,ctx.freshNonce,previous(acquired),ctx.atMs);
 if(!Array.isArray(input.approvals)||input.approvals.length!==2||new Set(input.approvals.map(v=>v?.role)).size!==2)fail('WPR_MATERIALIZER_APPROVAL_PAIR');
 for(const a of input.approvals){exact(a,['role','approvalRaw','approvalDigest']);if(!['enrollment','profile'].includes(a.role))fail('WPR_MATERIALIZER_APPROVAL_ROLE');const signed=envelopeBody(o[a.role]);const e=signed.envelope;const binding={networkId:e.networkId,owner:e.owner,keyVersion:e.keyVersion,executionHeight:e.executionHeight};const plan={role:a.role,policy:input.policy,binding,bodyRaw:signed.original,approvalDigest:a.approvalDigest};inspectOriginalAuthSourceIssuanceApprovalV2DATA(plan,a.approvalRaw,ctx.atMs);inspectOriginalWalletProductSourceIssuanceBodyDATA(a.role,o.root,o.enrollment,signed.original,input.policy,input.registrations.acquisition,ctx.atMs);}
 const p=envelopeBody(o.profile).body,e=envelopeBody(o.enrollment).body,b=input.build;
 same([b.applicationId,b.productId,b.platform],[p.selection.association.applicationId,p.selection.association.productId,p.selection.association.platform]);
 same([b.applicationId,b.productId,b.platform],[input.policy.applicationId,input.policy.productId,input.policy.platform]);
 if(!Number.isInteger(b.uid)||b.uid<0||b.uid>4294967295||typeof b.resourceDirectory!=='string'||!b.resourceDirectory.startsWith('/')||b.resourceDirectory.includes('\0')||b.resourceDirectory.split('/').some(v=>v==='.'||v==='..'))fail('WPR_MATERIALIZER_TARGET');
 const pins={root:pin(b.root,16384),enrollment:pin(b.enrollment,98304),verifier:pin(b.verifier,131072),node:pin(b.node,134217728)};exact(b.runtime,['proofContract','packageRoot','manifest','dispatch']);const runtime={proofContract:b.runtime.proofContract,packageRoot:b.runtime.packageRoot,manifest:pin(b.runtime.manifest),dispatch:pin(b.runtime.dispatch)};
 if(runtime.proofContract!=='YNX-AUTH-IDENTITY-PROOF-DATA/v1'||typeof runtime.packageRoot!=='string'||!runtime.packageRoot.startsWith('/')||runtime.packageRoot.includes('\0'))fail('WPR_MATERIALIZER_RUNTIME_CONTRACT');
 same({bytes:pins.root.bytes,sha256:pins.root.sha256},originalPin(o.root));same({bytes:pins.enrollment.bytes,sha256:pins.enrollment.sha256},originalPin(o.enrollment));
 const all=[...Object.values(pins),runtime.manifest,runtime.dispatch];if(new Set(all.map(v=>v.path)).size!==all.length)fail('WPR_MATERIALIZER_DUPLICATE_INPUT');
 exact(b.nativeNode,['origin','spki','nativeChainId']);if(typeof b.nativeNode.origin!=='string'||!/^https:\/\//.test(b.nativeNode.origin)||new URL(b.nativeNode.origin).origin!==b.nativeNode.origin||!/^[a-f0-9]{64}$/.test(b.nativeNode.spki)||!/^[1-9][0-9]*$/.test(b.nativeNode.nativeChainId))fail('WPR_MATERIALIZER_NODE_BINDING');
 const typedBuild={version:'YNX-WALLET-PRODUCT-TYPED-BUILD-INPUT/v1',sourceId:p.sourceId,signatureContract:input.policy.signatureContract,...pins,runtime,endpoint:e.endpoint,spki:e.spki,nativeNode:{...b.nativeNode},applicationId:b.applicationId,productId:b.productId,platform:b.platform,uid:b.uid,resourceDirectory:b.resourceDirectory};
 same(raw(input.independentBuildOriginal),typedBuild);
 exact(input.buildOriginals,['root','enrollment','verifier','node','runtimeManifest','dispatch']);
 const heldPins={...pins,runtimeManifest:runtime.manifest,dispatch:runtime.dispatch};
 for(const [k,pin]of Object.entries(heldPins)){const bytes=input.buildOriginals[k];if(types.isProxy(bytes)||!types.isUint8Array(bytes)||types.isSharedArrayBuffer(bytes.buffer)||bytes.byteLength!==pin.bytes||sha(bytes)!==pin.sha256)fail('WPR_MATERIALIZER_CLOSURE_BYTES_DIFFERS');}
 // WPR3 owns full static manifest/15 closure groups. This handoff binds the
 // same independent exact16 build DATA and six original byte pins; it grants
 // no compile row. WPR3 must additionally inspect every manifest leaf.
 // No fresh nonce/current body is put in compile-time input. Observations are
 // separate public evidence; runtime still has to acquire fresh genuine current.
 const manifest={version:'YNX-WPR-PUBLIC-MATERIALIZATION-DATA/v1',purpose:PURPOSE,sourceId:p.sourceId,instanceId:p.instanceId,generation:p.generation,profileDigest:sha(o.profile),typedBuild,publicOriginals:Object.fromEntries(['root','enrollment','profile','acquisitionHead'].map(k=>[k,{...originalPin(o[k])}])),observation:{freshCurrent:originalPin(o.freshCurrent),sequence:fresh.sequence,floor:fresh.floor,head:fresh.head,timeFloor:fresh.timeFloor,executionHeight:fresh.executionHeight,expiresAtMs:fresh.expiresAtMs},approvals:input.approvals.map(a=>({role:a.role,...originalPin(a.approvalRaw)})),...flags};
 const manifestOriginal=canonical(manifest);
 // Canonical serialization is the immutable boundary. Caller inputs and their
 // nested objects are not retained; repeated reads return the same raw strings.
 return Object.freeze({manifestOriginal,manifestSHA256:sha(manifestOriginal),typedBuildOriginal:canonical(typedBuild),publicOriginalsOriginal:canonical(Object.fromEntries(['root','enrollment','profile','acquisitionHead'].map(k=>[k,o[k]]))),...flags});
}
// Only independently reviewed release-source rows may ever live here. There is
// no public constructor/register/setter, ENV lookup or CLI input-to-row path.
const reviewedMaterializations=Object.freeze([]);
export function selectReviewedWalletProductMaterialization(){if(arguments.length)fail('WPR_NORMAL_ZERO_ARGUMENTS_REQUIRED');if(reviewedMaterializations.length===0)fail('WPR_REVIEWED_PUBLIC_ORIGINAL_LOAN_NOT_SUPPLIED');if(reviewedMaterializations.length!==1)fail('WPR_REVIEWED_MATERIALIZATION_AMBIGUOUS');return materializeOriginalWalletProductPublicDATA(reviewedMaterializations[0]);}
