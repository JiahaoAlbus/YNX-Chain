// Independent pending-consent DATA stage. Existing fe3 E5/N1 implementation only.
// This opaque DATA brand never represents a Native Source, approval or signer.
import{types}from'node:util';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{fetchOriginalNativeAuthorization}from'./original-ide-auth-proof-dispatch.mjs';
import{parsePQAccountAuthorization,inspectPQAuthorizationView,assertPQAuthorizationCurrent}from'../src/pq-wallet-policy.js';
import{inspectOriginalNetworkResourceScopeV1DATA,inspectOriginalNetworkResourceIssuerCurrentV1DATA,inspectOriginalNetworkResourcePrincipalCurrentV1DATA}from'./original-network-resource-source-contract.mjs';
import{inspectOriginalNetworkResourceSignedMemberV1DATA,encodeOriginalNetworkResourceSignatureMessageV1DATA}from'./original-network-resource-signature-v1.mjs';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE='network-resource-pending-consent-source-v1';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY='networkResourcePendingConsentV1';
export const NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_OPERATIONS=Object.freeze(['resource.public-block-histogram']);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const keys=['scope','inputOriginal','issuerMapping','principalMapping','issuerRegistration','principalRegistration','issuerCurrent','principalCurrent','node'];
function exact(v,k){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('NETWORK_PENDING_PRIVATE_SHAPE');const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);if(own.length!==k.length||own.some(n=>typeof n!=='string'||!k.includes(n)||!d[n].enumerable||!Object.hasOwn(d[n],'value')))fail('NETWORK_PENDING_PRIVATE_SHAPE');}
function clone(v,depth=0){if(depth>20)fail('NETWORK_PENDING_PRIVATE_DEPTH');if(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v))return v;if(!v||types.isProxy(v))fail('NETWORK_PENDING_PRIVATE_SHAPE');if(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype){const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;if(n>128||Reflect.ownKeys(d).length!==n+1)fail('NETWORK_PENDING_PRIVATE_SHAPE');const out=[];for(let i=0;i<n;i++){const x=d[i];if(!x||!x.enumerable||!Object.hasOwn(x,'value'))fail('NETWORK_PENDING_PRIVATE_SHAPE');out.push(clone(x.value,depth+1));}return Object.freeze(out);}if(Object.getPrototypeOf(v)!==Object.prototype)fail('NETWORK_PENDING_PRIVATE_SHAPE');const out={},d=Object.getOwnPropertyDescriptors(v);for(const k of Reflect.ownKeys(d)){if(typeof k!=='string'||!d[k].enumerable||!Object.hasOwn(d[k],'value'))fail('NETWORK_PENDING_PRIVATE_SHAPE');Object.defineProperty(out,k,{value:clone(d[k].value,depth+1),enumerable:true});}return Object.freeze(out);}
const tp=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(tp,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(tp,'buffer').get;
function bytes(v,cap){if(types.isProxy(v)||!types.isUint8Array(v))fail('NETWORK_PENDING_PRIVATE_BYTES');const n=length.call(v);if(n<1||n>cap||types.isSharedArrayBuffer(buffer.call(v)))fail('NETWORK_PENDING_PRIVATE_BOUNDS');const out=new Uint8Array(n);Uint8Array.prototype.set.call(out,v);return out;}
function snapshot(v){exact(v,keys);exact(v.issuerMapping,['canonicalIssuer','signatureBinding','memberOriginal']);exact(v.principalMapping,['principal','subjectOwner','signatureBinding']);for(const m of[v.issuerMapping,v.principalMapping])exact(m.signatureBinding,['networkId','canonicalSignerOwner','keyEpoch','issuedHeight']);exact(v.node,['origin','spki','nativeChainId']);const out={};for(const k of keys)out[k]=k==='inputOriginal'?bytes(v[k],4194304):k==='issuerMapping'?Object.freeze({canonicalIssuer:v.issuerMapping.canonicalIssuer,signatureBinding:clone(v.issuerMapping.signatureBinding),memberOriginal:bytes(v.issuerMapping.memberOriginal,262144)}):clone(v[k]);return Object.freeze(out);}
function fingerprint(v){return canonical({...v,inputOriginal:Buffer.from(v.inputOriginal).toString('base64url'),issuerMapping:{...v.issuerMapping,memberOriginal:Buffer.from(v.issuerMapping.memberOriginal).toString('base64url')}});}
function same(r){if(fingerprint(snapshot(r.original))!==r.pin||fingerprint(r.value)!==r.pin)fail('NETWORK_PENDING_ORIGINAL_CHANGED');}
const u64=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
function validate(r){
 const v=r.value,at=Date.now();if(!Number.isSafeInteger(at)||at<0||at<r.timeFloor)fail('NETWORK_PENDING_CLOCK_ROLLBACK');r.timeFloor=at;same(r);
 const s=inspectOriginalNetworkResourceScopeV1DATA(v.scope,v.inputOriginal,at).scope,a=v.issuerMapping.signatureBinding,b=v.principalMapping.signatureBinding;
 if(!/^[0-9a-f]{64}$/.test(a.networkId)||a.networkId!==b.networkId||[a,b].some(x=>typeof x.canonicalSignerOwner!=='string'||!/^0x[0-9a-f]{40}$/.test(x.canonicalSignerOwner)||!u64(x.keyEpoch)||x.keyEpoch==='0'||!u64(x.issuedHeight))||v.issuerMapping.canonicalIssuer!==s.issuer.canonicalIssuer||a.keyEpoch!==s.issuer.keyEpoch||v.principalMapping.principal!==s.request.principal||b.keyEpoch!==s.request.principalKeyEpoch||v.principalMapping.subjectOwner!==b.canonicalSignerOwner||a.canonicalSignerOwner===b.canonicalSignerOwner)fail('NETWORK_PENDING_PRIVATE_BINDING');
 if(typeof v.node.origin!=='string'||typeof v.node.spki!=='string'||!/^[0-9a-f]{64}$/.test(v.node.spki)||!u64(v.node.nativeChainId))fail('NETWORK_PENDING_FIXED_NODE');let origin;try{origin=new URL(v.node.origin);}catch{fail('NETWORK_PENDING_FIXED_NODE');}if(origin.protocol!=='https:'||origin.origin!==v.node.origin||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')fail('NETWORK_PENDING_FIXED_NODE');
 inspectOriginalNetworkResourceIssuerCurrentV1DATA(s.issuer,v.issuerCurrent,at);inspectOriginalNetworkResourcePrincipalCurrentV1DATA(s.request,v.principalCurrent,at);return{scope:s,at,bindings:[a,b]};
}
async function registrations(r){const {bindings}=validate(r),v=r.value,out=[];for(let i=0;i<2;i++){
 const raw=await r.get(v.node,bindings[i].canonicalSignerOwner);same(r);if(canonical(clone(raw))!==canonical(i===0?v.issuerRegistration:v.principalRegistration))fail('NETWORK_PENDING_REGISTERED_ORIGINAL_CHANGED');
 // Only an independent fixed-node observation is parsed, never a received
 // registration DTO. All resulting evidence stays PUBLIC DATA, not Root.
 const snap=parsePQAccountAuthorization(raw,{chainId:bindings[i].networkId,nativeChainId:v.node.nativeChainId,owner:bindings[i].canonicalSignerOwner}),view=inspectPQAuthorizationView(snap);
 if(!view.pqSigningEnabled||view.authorizationStatus==='revoked'||!view.activeRecord||view.activeRecord.revision!==bindings[i].keyEpoch||BigInt(snap.executionHeight)<BigInt(bindings[i].issuedHeight))fail('NETWORK_PENDING_REGISTERED_KEY_NOT_CURRENT');out.push(snap);validate(r);
 }if(out[0].executionHeight!==out[1].executionHeight)fail('NETWORK_PENDING_REGISTERED_HEIGHT_CHANGED');return out;}
const stages=new WeakMap();
function record(stage){const r=stages.get(stage);if(!r)fail('NETWORK_PENDING_STAGE_BRAND_REQUIRED');return r;}
function alive(r){if(r.closed||r.retired||r.firstPresent)fail('NETWORK_PENDING_STAGE_UNRESOLVED');}
function remember(r,e){if(!r.firstPresent){r.firstPresent=true;r.first=e;}}
/** Same exact nine-field PRIVATE Auth r2 API; injectable getter is PUBLIC test
 * DATA only. No principal member, Root proof, Native review or signer input. */
export async function prepareOriginalNetworkPendingConsentStageV1DATA(v,get=fetchOriginalNativeAuthorization){
 const value=snapshot(v),r={original:v,value,pin:fingerprint(value),get,timeFloor:0,busy:false,retired:false,closed:false,firstPresent:false,first:undefined,statement:null,views:null};validate(r);
 const before=await registrations(r),{scope,at,bindings}=validate(r);inspectOriginalNetworkResourceSignedMemberV1DATA(value.issuerMapping.memberOriginal,'manifest',scope,value.inputOriginal,at,bindings[0],before[0]);
 r.statement=new Uint8Array(encodeOriginalNetworkResourceSignatureMessageV1DATA('consent',scope,value.inputOriginal,at,bindings[1]));r.statementSHA256=sha(r.statement);const after=await registrations(r);for(let i=0;i<2;i++)assertPQAuthorizationCurrent(before[i],after[i]);r.views=after;validate(r);
 const stage=Object.freeze({});stages.set(stage,r);return stage;
}
/** Original private helper compatibility: exact owned unsigned existing E5
 * DATA bytes. Closing a DATA stage creates no Native debt or authority. */
export async function prepareOriginalPendingConsentStatementPrivate(v,get=fetchOriginalNativeAuthorization){const stage=await prepareOriginalNetworkPendingConsentStageV1DATA(v,get);try{return readOriginalNetworkPendingConsentStatementV1DATA(stage);}finally{closeOriginalNetworkPendingConsentStageV1DATA(stage);}}
export async function assertOriginalNetworkPendingConsentStageCurrentV1DATA(stage){const r=record(stage);alive(r);if(r.busy)fail('NETWORK_PENDING_STAGE_BUSY');r.busy=true;try{const now=await registrations(r);for(let i=0;i<2;i++)assertPQAuthorizationCurrent(r.views[i],now[i]);alive(r);validate(r);}catch(e){remember(r,e);throw e;}finally{r.busy=false;}}
export function readOriginalNetworkPendingConsentStatementV1DATA(stage){const r=record(stage);alive(r);if(r.busy)fail('NETWORK_PENDING_STAGE_BUSY');try{validate(r);return new Uint8Array(r.statement);}catch(e){remember(r,e);throw e;}}
export function inspectOriginalNetworkPendingConsentStageV1DATA(stage){const r=record(stage);return Object.freeze({purpose:NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_PURPOSE,selectionKey:NETWORK_RESOURCE_PENDING_CONSENT_SOURCE_SELECTION_KEY,statementSHA256:r.statementSHA256,retired:r.retired,closed:r.closed,pending:r.busy,firstCausePresent:r.firstPresent,firstCause:r.first,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,approved:false,signed:false,executionAllowed:false});}
export function retireOriginalNetworkPendingConsentStageV1DATA(stage){record(stage).retired=true;}
export function joinOriginalNetworkPendingConsentStageV1DATA(stage){const r=record(stage);if(!r.retired||r.busy)fail('NETWORK_PENDING_STAGE_JOIN_PENDING');return undefined;}
export function closeOriginalNetworkPendingConsentStageV1DATA(stage){const r=record(stage);r.retired=true;joinOriginalNetworkPendingConsentStageV1DATA(stage);if(r.closed)return undefined;r.closed=true;r.statement.fill(0);r.value.inputOriginal.fill(0);r.value.issuerMapping.memberOriginal.fill(0);return undefined;}
