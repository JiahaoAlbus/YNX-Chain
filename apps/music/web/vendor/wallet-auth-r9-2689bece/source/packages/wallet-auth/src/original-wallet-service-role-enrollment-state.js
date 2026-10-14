import { createHash, createPublicKey, createPrivateKey, verify } from 'node:crypto';
import { types } from 'node:util';

export const ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE = 'wallet-product-session-v2-admission-publisher/v1';
export const ORIGINAL_WALLET_SERVICE_ROLE_RECEIPT_DOMAIN = 'YNX_WALLET_SERVICE_ROLE_ENROLLMENT_RECEIPT_V1\n';
export const ORIGINAL_WALLET_SERVICE_ROLE_STATE_MAX_BYTES = 16384;
const REVIEW_VERSION = 'ynx-wallet-service-role-enrollment-review/v1';
const RECEIPT_VERSION = 'ynx-wallet-service-role-enrollment-receipt/v1';
const brands = new WeakSet();
const reviewFields = ['version','purpose','service','productId','platform','gatewayOrigin','registryDigest','targetConsumerManifestDigest','gatewayManifestDigest','rootId','rootKeyId','holderPublicKey','operationId','nonce','issuedAt','expiresAt'];
const fail = (code = 'SERVICE_ROLE_METADATA_INVALID') => { const e = new Error(code); e.code = code; throw e; };
function canonical(v) { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}'; }
function capture(raw, limit = 16384) {
  const seen = new WeakSet(); let nodes = 0;
  function walk(v, depth) {
    if (++nodes > 4096 || depth > 20) fail();
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
    if (!v || typeof v !== 'object' || types.isProxy(v) || seen.has(v)) fail();
    seen.add(v); const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) fail();
    const ds = Object.getOwnPropertyDescriptors(v); const out = array ? [] : {};
    if (Reflect.ownKeys(ds).some(k => typeof k !== 'string')) fail();
    if (array && Object.keys(ds).filter(k => k !== 'length').join(',') !== Array.from({length:v.length},(_,i)=>String(i)).join(',')) fail();
    for (const [k,d] of Object.entries(ds)) { if (array && k === 'length') continue; if (!d.enumerable || !('value' in d)) fail(); Object.defineProperty(out,k,{value:walk(d.value,depth+1),enumerable:true,writable:true,configurable:true}); }
    return out;
  }
  const value = walk(raw,0); if (Buffer.byteLength(canonical(value)) > limit) fail('SERVICE_ROLE_METADATA_TOO_LARGE'); return value;
}
function exact(v, fields) { if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).sort().join('|') !== [...fields].sort().join('|')) fail(); }
function token(v) { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(v)) fail(); }
function hash(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail(); }
function b64(v,n) { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v)) fail(); const b = Buffer.from(v,'base64url'); if (b.length !== n || b.toString('base64url') !== v) fail(); return b; }
function digest(v) { return createHash('sha256').update(canonical(v)).digest('hex'); }
function time(v) { if (!Number.isSafeInteger(v) || v < 0) fail(); return v; }
function root(v) { exact(v,['rootId','rootKeyId','publicKey','purpose']); token(v.rootId); token(v.rootKeyId); b64(v.publicKey,32); if(v.purpose !== ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE) fail(); return v; }
function review(v) {
  exact(v,reviewFields); if(v.version!==REVIEW_VERSION || v.purpose!==ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE || v.service!=='wallet-product-session-v2' || v.productId!=='developer' || v.platform!=='macos' || v.gatewayOrigin!=='https://wallet-auth.ynxweb4.com') fail();
  for(const k of ['registryDigest','targetConsumerManifestDigest','gatewayManifestDigest']) hash(v[k]);
  for(const k of ['rootId','rootKeyId','operationId','nonce']) token(v[k]); b64(v.holderPublicKey,32);
  time(v.issuedAt); time(v.expiresAt); if(v.expiresAt<=v.issuedAt || v.expiresAt-v.issuedAt>30000) fail(); return v;
}
function receipt(v) {
  exact(v,['body','signature']); exact(v.body,[...reviewFields,'decision','reviewDigest','roleExpiresAt']);
  const r={}; for(const k of reviewFields) r[k]=v.body[k]; if(r.version!==RECEIPT_VERSION) fail(); r.version=REVIEW_VERSION; review(r);
  if(!['approved','revoked'].includes(v.body.decision)) fail(); hash(v.body.reviewDigest); time(v.body.roleExpiresAt);
  if(v.body.roleExpiresAt<=v.body.issuedAt || v.body.roleExpiresAt-v.body.issuedAt>86400000 || v.body.reviewDigest!==digest(r)) fail(); b64(v.signature,64); return v;
}
function holder(v) { exact(v,['publicKey','privateKeyPKCS8']); b64(v.publicKey,32); const der=b64(v.privateKeyPKCS8,48); if(der.subarray(0,16).toString('hex')!=='302e020100300506032b657004220420') fail(); return v; }
export function emptyOriginalWalletServiceRoleEnrollmentState() { return {version:1,holder:null,rootAnchor:null,operations:[],history:[]}; }
export function parseOriginalWalletServiceRoleEnrollmentState(raw) {
  const s=capture(raw); exact(s,['version','holder','rootAnchor','operations','history']); if(s.version!==1 || !Array.isArray(s.operations)||!Array.isArray(s.history)||s.operations.length>32||s.history.length>32) fail();
  if(s.holder!==null) holder(s.holder); if(s.rootAnchor!==null) root(s.rootAnchor);
  const ids=new Set(),nonces=new Set();
  for(const op of s.operations) { exact(op,['review','state']); review(op.review); if(!['pending','UNKNOWN','approved','revoked'].includes(op.state)||ids.has(op.review.operationId)||nonces.has(op.review.nonce)) fail(); ids.add(op.review.operationId); nonces.add(op.review.nonce); if(!s.holder||!s.rootAnchor||op.review.holderPublicKey!==s.holder.publicKey||op.review.rootId!==s.rootAnchor.rootId||op.review.rootKeyId!==s.rootAnchor.rootKeyId) fail(); }
  const settled=new Set(); let previousIndex=-1,previousAt=-1;
  for(const h of s.history) { exact(h,['operationId','observedAt','receipt']); token(h.operationId); time(h.observedAt); receipt(h.receipt); const index=s.operations.findIndex(o=>o.review.operationId===h.operationId),op=s.operations[index]; if(!op||index<=previousIndex||h.observedAt<previousAt||settled.has(h.operationId)||h.receipt.body.reviewDigest!==digest(op.review)||h.observedAt<h.receipt.body.issuedAt||h.observedAt>=h.receipt.body.expiresAt||op.state!==h.receipt.body.decision) fail(); previousIndex=index;previousAt=h.observedAt;settled.add(h.operationId); }
  if(s.operations.some(o=>['approved','revoked'].includes(o.state)!==settled.has(o.review.operationId))) fail(); return s;
}
export function initializeOriginalWalletServiceRoleHolder(raw,custody) {
  const s=parseOriginalWalletServiceRoleEnrollmentState(raw),h=holder(capture(custody)); if(s.holder || s.operations.length || s.history.length || s.rootAnchor) fail();
  const privateBytes=b64(h.privateKeyPKCS8,48); try { const key=createPrivateKey({key:privateBytes,format:'der',type:'pkcs8'}); const pub=createPublicKey(key).export({format:'der',type:'spki'}); if(pub.subarray(-32).toString('base64url')!==h.publicKey) fail(); } finally { privateBytes.fill(0); } s.holder=h; return parseOriginalWalletServiceRoleEnrollmentState(s);
}
export function prepareOriginalWalletServiceRoleEnrollmentReview(raw) { return review(capture(raw)); }
export function publicOriginalWalletServiceRoleEnrollmentReadback(raw) { const s=parseOriginalWalletServiceRoleEnrollmentState(raw); return capture({version:1,holderPublicKey:s.holder?.publicKey??null,rootAnchor:s.rootAnchor,operations:s.operations,history:s.history}); }
/** PUBLIC existing receipt statement only. Neither supplied history nor a
 * supplied key establishes independently current registration/Native rights. */
export function createOriginalWalletServiceRolePublicApprovalVerifier(rawConfig){
  const config=capture(rawConfig);exact(config,['rootAnchor','registryDigest','targetConsumerManifestDigest','gatewayManifestDigest','holderPublicKey','operationId']);
  const anchor=root(config.rootAnchor);for(const name of ['registryDigest','targetConsumerManifestDigest','gatewayManifestDigest'])hash(config[name]);b64(config.holderPublicKey,32);token(config.operationId);
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),b64(anchor.publicKey,32)]),format:'der',type:'spki'});
  let retired=false;
  return Object.freeze({
    verify(rawPublicReadback,at){
      if(retired)fail('SERVICE_ROLE_PUBLIC_VERIFIER_RETIRED');time(at);
      const s=capture(rawPublicReadback);exact(s,['version','holderPublicKey','rootAnchor','operations','history']);
      if(s.version!==1||s.holderPublicKey!==config.holderPublicKey||canonical(root(s.rootAnchor))!==canonical(anchor)||!Array.isArray(s.operations)||!Array.isArray(s.history)||s.operations.length>32||s.history.length>32)fail('SERVICE_ROLE_PUBLIC_READBACK_INVALID');
      const ids=new Map(),nonces=new Set();
      for(const op of s.operations){exact(op,['review','state']);review(op.review);if(ids.has(op.review.operationId)||nonces.has(op.review.nonce)||!['pending','UNKNOWN','approved','revoked'].includes(op.state))fail();
        if(op.review.rootId!==anchor.rootId||op.review.rootKeyId!==anchor.rootKeyId||op.review.holderPublicKey!==config.holderPublicKey||['registryDigest','targetConsumerManifestDigest','gatewayManifestDigest'].some(k=>op.review[k]!==config[k]))fail('SERVICE_ROLE_PUBLIC_BINDING_MISMATCH');ids.set(op.review.operationId,op);nonces.add(op.review.nonce);
      }
      const seen=new Set();let floor=-1,previousIndex=-1,selected=null;
      for(const row of s.history){exact(row,['operationId','observedAt','receipt']);token(row.operationId);time(row.observedAt);if(row.observedAt<floor||row.observedAt>at||seen.has(row.operationId))fail('SERVICE_ROLE_PUBLIC_HISTORY_INVALID');floor=row.observedAt;seen.add(row.operationId);
        const signed=receipt(row.receipt),op=ids.get(row.operationId);
        const index=s.operations.findIndex(value=>value.review.operationId===row.operationId);
        if(index<=previousIndex||row.observedAt<signed.body.issuedAt||row.observedAt>=signed.body.expiresAt)fail('SERVICE_ROLE_PUBLIC_HISTORY_INVALID');previousIndex=index;
        if(!op||signed.body.operationId!==row.operationId||signed.body.reviewDigest!==digest(op.review)||op.state!==signed.body.decision||!verify(null,Buffer.from(ORIGINAL_WALLET_SERVICE_ROLE_RECEIPT_DOMAIN+canonical(signed.body)),key,b64(signed.signature,64)))fail('SERVICE_ROLE_RECEIPT_INVALID');
        if(row.operationId===config.operationId)selected=signed;
      }
      for(const op of ids.values())if(['approved','revoked'].includes(op.state)!==seen.has(op.review.operationId))fail('SERVICE_ROLE_PUBLIC_HISTORY_INVALID');
      if(!selected||s.history.at(-1)?.operationId!==config.operationId||selected.body.decision!=='approved'||at<selected.body.issuedAt||at>=selected.body.roleExpiresAt)fail('SERVICE_ROLE_NOT_APPROVED');
      return Object.freeze({purpose:ORIGINAL_WALLET_SERVICE_ROLE_PURPOSE,rootId:anchor.rootId,rootKeyId:anchor.rootKeyId,holderPublicKey:config.holderPublicKey,operationId:config.operationId,registrationNonce:selected.body.nonce,registryDigest:config.registryDigest,targetConsumerManifestDigest:config.targetConsumerManifestDigest,gatewayManifestDigest:config.gatewayManifestDigest,reviewDigest:selected.body.reviewDigest,roleExpiresAt:selected.body.roleExpiresAt,statementAuthenticRelativeToSelectedRoot:true,originalLatestSourceRequired:true,nativeQualified:false});
    },
    // Physical/current producer is a separate recognized owner, not caller
    // history or an installable current() callback. No false live claim here.
    assertCurrent(){fail('SERVICE_ROLE_ORIGINAL_CURRENT_SOURCE_NOT_IMPLEMENTED');},
    retire(){retired=true;return undefined;}
  });
}
export function assertOriginalWalletServiceRoleEnrollmentCodec(value) { if(!brands.has(value)) fail('SERVICE_ROLE_NOT_CONFIGURED'); return value; }
export function createOriginalWalletServiceRoleEnrollmentCodec(config) {
  if(!config || types.isProxy(config) || Object.getPrototypeOf(config)!==Object.prototype) fail('SERVICE_ROLE_NOT_CONFIGURED');
  const ds=Object.getOwnPropertyDescriptors(config); if(Reflect.ownKeys(ds).some(k=>typeof k!=='string')||Object.keys(ds).sort().join('|')!==['rootAnchor','registryDigest','targetConsumerManifestDigest','gatewayManifestDigest','now'].sort().join('|')||Object.values(ds).some(d=>!('value'in d))) fail('SERVICE_ROLE_NOT_CONFIGURED');
  const anchor=root(capture(ds.rootAnchor.value)); const pins={}; for(const k of ['registryDigest','targetConsumerManifestDigest','gatewayManifestDigest']) { hash(ds[k].value); pins[k]=ds[k].value; }
  const now=ds.now.value; if(typeof now!=='function') fail('SERVICE_ROLE_NOT_CONFIGURED'); let active=false,invalid=false,last=-1;
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),b64(anchor.publicKey,32)]),format:'der',type:'spki'});
  function entry(fn) { if(active) { invalid=true; fail('SERVICE_ROLE_REENTRANT'); } if(invalid) fail('SERVICE_ROLE_REENTRANT'); active=true; try{return fn();}finally{active=false;} }
  function clock() { const at=now(); if(invalid) fail('SERVICE_ROLE_REENTRANT'); time(at); if(at<last) fail(); last=at; return at; }
  function bind(r) { review(r); for(const k of Object.keys(pins)) if(r[k]!==pins[k]) fail(); if(r.rootId!==anchor.rootId||r.rootKeyId!==anchor.rootKeyId) fail(); }
  function stored(raw) { const s=parseOriginalWalletServiceRoleEnrollmentState(raw); if(s.rootAnchor&&canonical(s.rootAnchor)!==canonical(anchor)) fail(); for(const o of s.operations) bind(o.review); for(const h of s.history) if(!verify(null,Buffer.from(ORIGINAL_WALLET_SERVICE_ROLE_RECEIPT_DOMAIN+canonical(h.receipt.body)),key,b64(h.receipt.signature,64))) fail('SERVICE_ROLE_RECEIPT_INVALID'); return s; }
  function final(raw,before,r=null) { const at=clock(); if(digest(capture(raw))!==before || invalid) fail(); if(r&&(at<r.issuedAt||at>=r.expiresAt)) fail('SERVICE_ROLE_EXPIRED'); return at; }
  function settle(raw,operationId,signed,decision) { const before=digest(capture(raw)),s=stored(raw),p=receipt(capture(signed)),op=s.operations.find(o=>o.review.operationId===operationId); if(!op||p.body.decision!==decision||p.body.reviewDigest!==digest(op.review)||!verify(null,Buffer.from(ORIGINAL_WALLET_SERVICE_ROLE_RECEIPT_DOMAIN+canonical(p.body)),key,b64(p.signature,64))) fail('SERVICE_ROLE_RECEIPT_INVALID'); const at=final(raw,before,op.review); const old=s.history.find(h=>h.operationId===operationId); if(old) { if(canonical(old.receipt)!==canonical(p)) fail(); return {state:s,readOnly:true}; } op.state=decision;s.history.push({operationId,observedAt:at,receipt:p}); return {state:parseOriginalWalletServiceRoleEnrollmentState(s),readOnly:false}; }
  const api=Object.freeze({
    rootAnchor:Object.freeze({...anchor}),
    begin(raw,rawReview) { return entry(()=>{const before=digest(capture(raw)),s=stored(raw),r=review(capture(rawReview));bind(r);if(!s.holder||s.holder.publicKey!==r.holderPublicKey)fail();final(raw,before,r);const old=s.operations.find(o=>o.review.operationId===r.operationId);if(old){if(canonical(old.review)!==canonical(r))fail();return {state:s,readOnly:true};}if(s.operations.some(o=>o.review.nonce===r.nonce))fail();s.rootAnchor={...anchor};s.operations.push({review:r,state:'pending'});return {state:parseOriginalWalletServiceRoleEnrollmentState(s),readOnly:false};});},
    recordUnknown(raw,operationId) { return entry(()=>{const before=digest(capture(raw)),s=stored(raw),op=s.operations.find(o=>o.review.operationId===operationId);if(!op)fail();final(raw,before);if(op.state==='pending')op.state='UNKNOWN';return s;});},
    recordApproved(raw,id,signed) { return entry(()=>settle(raw,id,signed,'approved')); },
    recordRevoked(raw,id,signed) { return entry(()=>settle(raw,id,signed,'revoked')); },
    assertStored(raw) { return entry(()=>{const before=digest(capture(raw)),s=stored(raw);final(raw,before);return s;});},
    assertApproved(raw) { return entry(()=>{const before=digest(capture(raw)),s=stored(raw),h=s.history.at(-1);const at=final(raw,before);if(!h||h.receipt.body.decision!=='approved'||at>=h.receipt.body.roleExpiresAt)fail('SERVICE_ROLE_NOT_APPROVED');return capture({holderPublicKey:s.holder.publicKey,rootAnchor:s.rootAnchor,receipt:h.receipt,reviewDigest:h.receipt.body.reviewDigest});});}
  });brands.add(api);return api;
}
