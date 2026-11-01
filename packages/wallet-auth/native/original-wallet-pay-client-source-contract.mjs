// Wallet client selection DATA only. Authentication remains the sole generic
// SourceV2 verifier; this module neither verifies signatures nor issues loans.
import {types} from 'node:util';
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {exactPQRecord} from '../src/pq-wallet-contract.js';
export const WALLET_NATIVE_PAY_CLIENT_SOURCE_PURPOSE='wallet-native-pay-client-source-v1';
export const WALLET_NATIVE_PAY_CLIENT_SELECTION_KEY='walletNativePayClientV1';
export const WALLET_NATIVE_PAY_CLIENT_OPERATIONS=Object.freeze(['post_terms','post_settlement','post_refund','get_intent','get_invoice']);
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const E='WALLET_PAY_CLIENT_SOURCE_DATA_INVALID';
function exact(v,keys){if(!v||types.isProxy(v))fail(E);exactPQRecord(v,keys,E);const d=Object.getOwnPropertyDescriptors(v);if(keys.some(k=>!d[k].enumerable))fail(E);}
function list(v,max){if(!v||types.isProxy(v)||!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||!v.length||v.length>max)fail(E);const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)fail(E);for(let i=0;i<v.length;i++)if(!d[i]||!d[i].enumerable||!Object.hasOwn(d[i],'value'))fail(E);return v;}
const account=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
function binding(b){
 exact(b,['networkId','account','hash','memberHash','operationId','target']);
 if(!hex(b.networkId)||!account(b.account)||!hash(b.hash)||!hash(b.memberHash)||typeof b.operationId!=='string'||!b.operationId.isWellFormed()||!b.operationId||Buffer.byteLength(b.operationId)>128||/[\x00-\x1f\x7f]/.test(b.operationId))fail(E);
 const t=b.target;exact(t,['version','service','kind','intentId','merchant','invoiceId','requestPath']);
 if(t.version!==1||t.service!=='pay'||!['invoice_terms','invoice_settle','invoice_refund'].includes(t.kind)||!account(t.merchant)||typeof t.invoiceId!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(t.invoiceId))fail(E);
 if(t.kind==='invoice_terms'){if(typeof t.intentId!=='string'||!/^npi_[a-f0-9]{48}$/.test(t.intentId)||t.merchant!==b.account)fail(E);}
 else if(t.intentId!==null||t.kind==='invoice_refund'&&t.merchant!==b.account)fail(E);
 const op=t.kind==='invoice_terms'?'post_terms':t.kind==='invoice_settle'?'post_settlement':'post_refund';
 if(t.requestPath!==route(op,t))fail('WALLET_PAY_CLIENT_SOURCE_TARGET_PATH');
 return b;
}
function route(op,t){
 if(op==='get_intent'||op==='post_terms'){if(t.kind!=='invoice_terms')fail(E);return '/v5/pay/invoice-intents/'+t.intentId+(op==='post_terms'?'/merchant-member':'');}
 if(t.kind==='invoice_terms')fail(E);
 const p='/v5/pay/invoices/'+t.merchant+'/'+t.invoiceId;
 if(op==='get_invoice')return p;
 if(op==='post_settlement'&&t.kind==='invoice_settle')return p+'/settlements';
 if(op==='post_refund'&&t.kind==='invoice_refund')return p+'/refunds';
 fail(E);
}
function operation(op,t){if(!WALLET_NATIVE_PAY_CLIENT_OPERATIONS.includes(op))fail(E);return {method:op.startsWith('get_')?'GET':'POST',requestPath:route(op,t),queryOnly:op.startsWith('get_')};}
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
export function inspectOriginalWalletPayClientScopeV1DATA(value,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs){
 if(!hex(networkId)||!account(subjectOwner)||![issuedAtMs,expiresAtMs,atMs].every(Number.isSafeInteger)||issuedAtMs<0||expiresAtMs<=issuedAtMs||expiresAtMs-issuedAtMs>86400000||atMs<issuedAtMs||atMs>=expiresAtMs)fail(E);
 exact(value,['version','protectedResourceRef','bindings']);if(typeof value.protectedResourceRef!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.protectedResourceRef))fail('WALLET_PAY_CLIENT_SOURCE_RESOURCE_REF');if(value.version!==1)fail(E);list(value.bindings,64);
 const identities=new Set();let until=expiresAtMs;
 for(const row of value.bindings){exact(row,['binding','operations','untilMs']);const b=binding(row.binding);if(b.networkId!==networkId||b.account!==subjectOwner)fail('WALLET_PAY_CLIENT_SOURCE_IDENTITY');
  if(!Number.isSafeInteger(row.untilMs)||row.untilMs<=atMs||row.untilMs>expiresAtMs)fail('WALLET_PAY_CLIENT_SOURCE_EXPIRED');until=Math.min(until,row.untilMs);
  list(row.operations,5);if(new Set(row.operations).size!==row.operations.length)fail(E);for(const op of row.operations)operation(op,b.target);
  const id=canonical([b.networkId,b.account,b.operationId]);if(identities.has(id))fail('WALLET_PAY_CLIENT_SOURCE_DUPLICATE');identities.add(id);
 }
 const raw=canonical(value);if(Buffer.byteLength(raw)>49152)fail('WALLET_PAY_CLIENT_SOURCE_CAPACITY');
 return Object.freeze({scopeOriginal:raw,scope:freeze(JSON.parse(raw)),effectExpiresAtMs:until,dataOnly:true,authorized:false,SourceAdmission:false,NativeAdmission:false,registered:false,approval:false});
}
export function inspectOriginalWalletPayClientOperationV1DATA(value,selectedBinding,op,originalMember,originalEnvelope,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs){
 const scope=inspectOriginalWalletPayClientScopeV1DATA(value,networkId,subjectOwner,issuedAtMs,expiresAtMs,atMs);binding(selectedBinding);
 const row=scope.scope.bindings.find(r=>canonical(r.binding)===canonical(selectedBinding));if(!row||!row.operations.includes(op))fail('WALLET_PAY_CLIENT_SOURCE_OPERATION_NOT_SELECTED');
 // Both public originals are captured before hashing, never reserialized. GET
 // receives no transmission Member; custody still binds the original effect.
 function captured(v,max){if(types.isProxy(v)||!types.isUint8Array(v)||Object.getPrototypeOf(v)!==Uint8Array.prototype||Reflect.ownKeys(v).some(k=>typeof k!=='string'||! /^(0|[1-9][0-9]*)$/.test(k))||types.isSharedArrayBuffer(v.buffer)||!v.byteLength||v.byteLength>max)fail(E);return Uint8Array.from(v);}
 const member=captured(originalMember,98304),envelope=captured(originalEnvelope,196608);
 if('0x'+sha(member)!==selectedBinding.memberHash||'0x'+sha(envelope)!==selectedBinding.hash)fail('WALLET_PAY_CLIENT_SOURCE_ORIGINAL_HASH');
 const r=operation(op,selectedBinding.target);
 return Object.freeze({...r,protectedPurpose:r.queryOnly?'pay_query':selectedBinding.target.kind==='invoice_terms'?'invoice_terms':selectedBinding.target.kind==='invoice_settle'?'invoice_settlement':'invoice_refund',binding:freeze(JSON.parse(canonical(selectedBinding))),dataOnly:true,authorized:false,SourceAdmission:false,NativeAdmission:false,registered:false,approval:false});
}
