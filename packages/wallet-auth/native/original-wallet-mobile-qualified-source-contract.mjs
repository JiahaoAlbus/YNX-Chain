// Node-only SDK reference DATA. Native implements the same contract; Hermes
// must not import this module. No Source factory, approval or credential API.
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonical} from './original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2} from './original-auth-identity-source-v2-verifier.mjs';
export const WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE='wallet-mobile-qualified-source-v1';
export const WALLET_MOBILE_QUALIFIED_SOURCE_SELECTION_KEY='walletMobileQualifiedV1';
export const WALLET_MOBILE_QUALIFIED_SOURCE_OPERATIONS=Object.freeze(['mobile.transaction','mobile.registered-restore','mobile.original-query']);
const fields=Object.freeze(['binding','message','policy','keyVersion','executionHeight','review','encryptedBackup']);
const caps=Object.freeze([8192,8192,8388608,20,20,2097152,196608]);
const contexts=Object.freeze(['networkId','account','platform','applicationId','protectedResourceRef','nativeChainID','vaultRevision','registrationDigest','keyVersion','executionHeight','nonce','spendingBudgetOriginalDigest']);
const held=new WeakMap();
const fail=c=>{throw Object.assign(Error(c),{code:c});};
function record(v,keys){
 if(!v||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('MOBILE_SOURCE_RECORD');
 const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('MOBILE_SOURCE_RECORD');
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function u64(v,zero=false){if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n||!zero&&v==='0')fail('MOBILE_SOURCE_U64');}
function context(value){const c=record(value,contexts);if(!hex(c.networkId)||!/^0x[a-f0-9]{40}$/.test(c.account)||!['ios','android'].includes(c.platform)||typeof c.applicationId!=='string'||! /^[A-Za-z][A-Za-z0-9.-]{2,131}$/.test(c.applicationId)||!token(c.protectedResourceRef)||![c.registrationDigest,c.nonce,c.spendingBudgetOriginalDigest].every(hex))fail('MOBILE_SOURCE_CONTEXT');for(const f of ['nativeChainID','vaultRevision','keyVersion'])u64(c[f]);u64(c.executionHeight,true);return Object.freeze(c);}
function mode(v){if(!Number.isInteger(v)||v<1||v>3)fail('MOBILE_SOURCE_MODE');return v;}
function window(s){if(![s.issuedAtMs,s.expiresAtMs].every(Number.isSafeInteger)||s.issuedAtMs<0||s.expiresAtMs<=s.issuedAtMs||s.expiresAtMs-s.issuedAtMs>120000)fail('MOBILE_SOURCE_WINDOW');}
const hash=b=>createHash('sha256').update(b).digest('hex');
function bytes(v,cap){if(types.isProxy(v)||!(v instanceof Uint8Array)||Object.getPrototypeOf(v)!==Uint8Array.prototype||v.buffer instanceof SharedArrayBuffer||v.byteLength>cap)fail('MOBILE_SOURCE_BYTES');return new Uint8Array(v);}
function refs(value){const r=record(value,fields),out={};for(let i=0;i<fields.length;i++){const f=fields[i],v=record(r[f],['bytes','sha256']);if(!Number.isSafeInteger(v.bytes)||v.bytes<0||v.bytes>caps[i]||!hex(v.sha256))fail('MOBILE_SOURCE_ORIGINAL_REF');out[f]=Object.freeze(v);}if(!out.binding.bytes)fail('MOBILE_SOURCE_BINDING');return Object.freeze(out);}
export function inspectWalletMobileQualifiedSourceScopeV1DATA(value){
 const s=record(value,['version','mode','reference','originalOperationID','context','originals','issuedAtMs','expiresAtMs']);
 if(s.version!=='1'||typeof s.reference!=='string'||!/^[!-~]{1,128}$/.test(s.reference)||!token(s.originalOperationID))fail('MOBILE_SOURCE_SCOPE');mode(s.mode);window(s);
 s.context=context(s.context);s.originals=refs(s.originals);
 if(s.mode===1&&(!s.originals.message.bytes||!s.originals.policy.bytes||!s.originals.keyVersion.bytes||!s.originals.executionHeight.bytes))fail('MOBILE_SOURCE_TRANSACTION_ORIGINALS');
 return Object.freeze({...s,operation:WALLET_MOBILE_QUALIFIED_SOURCE_OPERATIONS[s.mode-1],dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
function scopeBody(s){return Object.fromEntries(['version','mode','reference','originalOperationID','context','originals','issuedAtMs','expiresAtMs'].map(k=>[k,s[k]]));}
/** independentSelection comes from the native protected Root/capture owner,
 * never from received scope/JS. This function checks DATA consistency only. */
export function captureWalletMobileQualifiedOriginalsV1DATA(value,independentSelection,rawOriginals,atMs){
 const s=inspectWalletMobileQualifiedSourceScopeV1DATA(value),e=record(independentSelection,['mode','reference','originalOperationID','context','issuedAtMs','expiresAtMs']);
 if(e.mode!==s.mode||e.reference!==s.reference||e.originalOperationID!==s.originalOperationID||canonical(context(e.context))!==canonical(s.context)||e.issuedAtMs!==s.issuedAtMs||e.expiresAtMs!==s.expiresAtMs)fail('MOBILE_SOURCE_INDEPENDENT_SELECTION_DIFFERS');
 if(!Number.isSafeInteger(atMs)||atMs<s.issuedAtMs||atMs>=s.expiresAtMs)fail('MOBILE_SOURCE_EXPIRED');
 const r=record(rawOriginals,fields),copies={};for(let i=0;i<fields.length;i++){const f=fields[i],b=bytes(r[f],caps[i]);if(b.length!==s.originals[f].bytes||hash(b)!==s.originals[f].sha256)fail('MOBILE_SOURCE_ORIGINAL_DIFFERS');copies[f]=b;}
 if(s.mode===1){const dec=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});for(const f of ['keyVersion','executionHeight']){let v;try{v=dec.decode(copies[f]);}catch{fail('MOBILE_SOURCE_U64');}u64(v,f==='executionHeight');if(v!==s.context[f])fail('MOBILE_SOURCE_REGISTRATION_DIFFERS');}}
 const stage=Object.freeze({scopeOriginal:canonical(scopeBody(s)),operation:s.operation,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});held.set(stage,{scope:s,copies});return stage;
}
export function assertWalletMobileQualifiedOriginalsUnchangedV1DATA(stage,rawOriginals){const h=held.get(stage);if(!h)fail('MOBILE_SOURCE_STAGE_REQUIRED');const r=record(rawOriginals,fields);for(let i=0;i<fields.length;i++){const f=fields[i],b=bytes(r[f],caps[i]);if(b.length!==h.copies[f].length||!Buffer.from(b).equals(h.copies[f]))fail('MOBILE_SOURCE_ORIGINAL_DIFFERS');}return stage;}
/** Journal flags are durable native facts, not caller replay authority. */
export function inspectWalletMobileQualifiedPhaseV1DATA(stage,phase,flags,osOutcomeAvailable){
 const h=held.get(stage);if(!h)fail('MOBILE_SOURCE_STAGE_REQUIRED');if(!Number.isInteger(flags)||flags<0||flags>31||flags&2&&!(flags&1)||flags&4&&!(flags&2)||flags&16&&!(flags&8)||flags&24&&flags&7||typeof osOutcomeAvailable!=='boolean')fail('MOBILE_SOURCE_JOURNAL');
 if(!Number.isInteger(phase)||phase<1||phase>5)fail('MOBILE_SOURCE_PHASE');
 if(phase===2&&(h.scope.mode!==1||flags!==0)||phase===3&&(h.scope.mode!==1||flags!==3)||phase===4&&(h.scope.mode!==2||![0,24].includes(flags))||h.scope.mode===3&&phase!==1&&phase!==5||phase===5&&flags===0&&!osOutcomeAvailable)fail('MOBILE_SOURCE_PHASE_NOT_SELECTED');
 return Object.freeze({phase,readOnly:phase===5,requiresRestoredCurrent:phase===4&&flags===24,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
/** Encodes the FULL original Source role body, not a replacement scope body.
 * Full Root/enrollment/profile/current semantics remain the original Native
 * verifier's obligation; this adapter adds only the new family scope check. */
function sourceBody(role,raw,binding){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)fail('MOBILE_SOURCE_BODY');
 let b;try{b=JSON.parse(raw);}catch{fail('MOBILE_SOURCE_BODY');}
 if(canonical(b)!==raw||b.version!==2||b.purpose!==WALLET_MOBILE_QUALIFIED_SOURCE_PURPOSE)fail('MOBILE_SOURCE_BODY');
 if(role==='profile'){
  const d=Object.getOwnPropertyDescriptor(b.selection??{},WALLET_MOBILE_QUALIFIED_SOURCE_SELECTION_KEY);
  if(!d||!Object.hasOwn(d,'value'))fail('MOBILE_SOURCE_PROFILE_SCOPE');
  const s=inspectWalletMobileQualifiedSourceScopeV1DATA(d.value);
  if(b.subjectOwner!==s.context.account)fail('MOBILE_SOURCE_SUBJECT');
  if(binding.networkId!==s.context.networkId)fail('MOBILE_SOURCE_NETWORK');
 }
 return b;
}
export function encodeWalletMobileQualifiedSourceStatementV1DATA(role,independentFrame,binding,bodyOriginal){sourceBody(role,bodyOriginal,binding);return encodeOriginalAuthSourceStatementV2(role,independentFrame,binding,bodyOriginal);}
export function encodeWalletMobileQualifiedSourceEnvelopeV1DATA(role,binding,bodyOriginal,member){sourceBody(role,bodyOriginal,binding);return canonicalOriginalAuthSourceEnvelopeV2(role,binding,bodyOriginal,member);}
