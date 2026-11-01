import {createHash, createPublicKey, verify} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON, exactFields, WalletAuthError} from './canonical.js';

const DOMAIN = 'YNX_ORIGINAL_OPERATOR_DEVICE_READER_APPROVAL_V1\n';
const BODY = ['version','purpose','operatorId','keyId','registryDigest','sequence','previousApprovalDigest','authorizationDigest','sourceDigest','issuedAt','expiresAt','nonce'];
const ROW = ['operatorId','keyId','sequence','previousApprovalDigest','authorizationDigest','sourceDigest','registryDigest','approvedAt','receipt'];
const authorities = new WeakMap(), capabilities = new WeakMap();
const fail = (code = 'ORIGINAL_OPERATOR_READER_INVALID') => {throw new WalletAuthError(code, 'Original operator reader approval unavailable');};
const hash = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{2,127}$/.test(value);
const instant = value => {const n = typeof value === 'string' ? Date.parse(value) : NaN; if (!Number.isFinite(n) || new Date(n).toISOString() !== value) fail(); return n;};
// Capture descriptors before reads: proxies, getters, holes, aliases and cycles
// are never accepted as trusted JSON. This module imports no runtime authority.
function capture(value, limit = 65536) {
 let nodes = 0;
 const seen = new Set();
 const walk = (v, depth) => {
  if (++nodes > 1000000 || depth > 32) fail();
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  if (!v || typeof v !== 'object' || types.isProxy(v) || seen.has(v)) fail();
  seen.add(v);
  const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
  if (proto !== (array ? Array.prototype : Object.prototype)) fail();
  const keys = Reflect.ownKeys(v), out = array ? [] : {};
  if (array && (v.length > 4096 || keys.length !== v.length + 1)) fail();
  for (const k of keys) {
   if (array && k === 'length') continue;
   const d = Object.getOwnPropertyDescriptor(v, k);
   if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d, 'value') || (array && !/^(0|[1-9][0-9]*)$/.test(k))) fail();
   Object.defineProperty(out, k, {value: walk(d.value, depth + 1), enumerable: true});
  }
  seen.delete(v); return Object.freeze(out);
 };
 const result = walk(value, 0);
 if (Buffer.byteLength(canonicalJSON(result)) > limit) fail('ORIGINAL_OPERATOR_READER_BODY_INVALID');
 return result;
}
function receipt(input) {
 const r = capture(input); exactFields(r, ['body','signature'], 'Operator reader receipt');
 const b = r.body; exactFields(b, BODY, 'Operator reader approval');
 if (b.version !== 'ynx-original-operator-reader-approval/v1' || b.purpose !== 'accepted-device-reader-roster-approve/v1' || !id(b.operatorId) || !id(b.keyId) || !digest(b.registryDigest) || !digest(b.authorizationDigest) || !digest(b.sourceDigest) || !Number.isSafeInteger(b.sequence) || b.sequence < 1 || !(b.previousApprovalDigest === null || digest(b.previousApprovalDigest)) || typeof b.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.nonce) || Buffer.from(b.nonce,'base64url').toString('base64url') !== b.nonce || typeof r.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(r.signature) || Buffer.from(r.signature,'base64url').toString('base64url') !== r.signature) fail();
 const issued = instant(b.issuedAt), expires = instant(b.expiresAt);
 if (expires <= issued || expires - issued > 30000) fail();
 return r;
}
export function emptyOriginalOperatorReaderState() {return {version:1, records:[], nonces:[]};}
export function parseOriginalOperatorReaderState(input) {
 const s = capture(input, 8 * 1024 * 1024); exactFields(s, ['version','records','nonces'], 'Operator reader state');
 if (s.version !== 1 || !Array.isArray(s.records) || !Array.isArray(s.nonces) || s.records.length !== s.nonces.length || s.records.length > 4096) fail();
 const latest = new Map(), nonces = new Set();
 for (let i = 0; i < s.records.length; i++) {
  const row = s.records[i]; exactFields(row, ROW, 'Operator reader history'); const r = receipt(row.receipt), b = r.body;
  for (const k of ['operatorId','keyId','sequence','previousApprovalDigest','authorizationDigest','sourceDigest','registryDigest']) if (row[k] !== b[k]) fail();
  const at = instant(row.approvedAt); if (at < instant(b.issuedAt) || at >= instant(b.expiresAt)) fail();
  const k = b.operatorId + '\n' + b.keyId, last = latest.get(k);
  if (b.sequence !== (last ? last.body.sequence + 1 : 1) || b.previousApprovalDigest !== (last ? hash(last) : null) || s.nonces[i] !== b.nonce || nonces.has(b.nonce)) fail();
  latest.set(k, r); nonces.add(b.nonce);
 }
 return s;
}
function options(input) {
 if (!input || typeof input !== 'object' || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED');
 const out = {};
 for (const k of Reflect.ownKeys(input)) {const d = Object.getOwnPropertyDescriptor(input,k); if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d,'value')) fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED'); Object.defineProperty(out,k,{value:d.value,enumerable:true});}
 exactFields(out,['operatorAnchor','assertOriginalOperatorReaderCurrent','originalNow'],'Operator reader authority options'); return out;
}
export function assertOriginalOperatorReaderApprovalAuthority(value) {const meta = authorities.get(value); if (!meta) fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED'); meta.enter(); return value;}
export function createOriginalOperatorReaderApprovalAuthority(input) {
 let o, anchor;
 try {o = options(input); anchor = capture(o.operatorAnchor); exactFields(anchor,['publicKey','operatorId','keyId','registryDigest'],'Independent operator anchor');} catch {fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED');}
 if (!id(anchor.operatorId) || !id(anchor.keyId) || !digest(anchor.registryDigest) || typeof anchor.publicKey !== 'string' || typeof o.originalNow !== 'function' || typeof o.assertOriginalOperatorReaderCurrent !== 'function' || types.isProxy(o.originalNow) || types.isProxy(o.assertOriginalOperatorReaderCurrent)) fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED');
 let key; try {key = createPublicKey(anchor.publicKey); if (key.asymmetricKeyType !== 'ed25519') fail();} catch {fail('ORIGINAL_OPERATOR_READER_NOT_CONFIGURED');}
 let active = false, invalid = false, floor = -Infinity;
 const clock = () => {const d = o.originalNow(); if (invalid) fail('ORIGINAL_OPERATOR_READER_UNAVAILABLE'); if (types.isProxy(d) || !(d instanceof Date)) fail('ORIGINAL_OPERATOR_READER_CLOCK_UNAVAILABLE'); const n = Date.prototype.getTime.call(d); if (!Number.isFinite(n) || n < floor) fail('ORIGINAL_OPERATOR_READER_CLOCK_UNAVAILABLE'); floor = n; return n;};
 const binding = r => {const b = r.body; if (b.operatorId !== anchor.operatorId || b.keyId !== anchor.keyId || b.registryDigest !== anchor.registryDigest || !verify(null, Buffer.from(DOMAIN + canonicalJSON(b)), key, Buffer.from(r.signature,'base64url'))) fail('ORIGINAL_OPERATOR_READER_SIGNATURE_INVALID');};
 const check = (r, state, historical = false) => {
  if (active || invalid) {invalid = true; fail('ORIGINAL_OPERATOR_READER_UNAVAILABLE');}
  active = true;
  try {
   let now = clock();
   if (r && !historical && (now < instant(r.body.issuedAt) || now >= instant(r.body.expiresAt))) fail('ORIGINAL_OPERATOR_READER_EXPIRED');
   const result = o.assertOriginalOperatorReaderCurrent(Object.freeze({operatorAnchor:anchor, receipt:r, state, historical}));
   // A promise, false, arbitrary truthy object or callback echo is not Current.
   if (invalid || result !== undefined) fail('ORIGINAL_OPERATOR_READER_UNAVAILABLE');
   now = clock(); if (r && !historical && (now < instant(r.body.issuedAt) || now >= instant(r.body.expiresAt))) fail('ORIGINAL_OPERATOR_READER_EXPIRED');
   return now;
  } catch (error) {invalid = true; throw error;} finally {active = false;}
 };
 const enter = () => {
  if (active) {invalid = true; fail('ORIGINAL_OPERATOR_READER_UNAVAILABLE');}
  if (invalid) fail('ORIGINAL_OPERATOR_READER_UNAVAILABLE');
 };
 const authority = Object.freeze({
  operatorAnchor: anchor,
  authenticate(raw, state) {
   enter();
   const r = receipt(raw), s = parseOriginalOperatorReaderState(state); binding(r);
   // Historic signatures and fixed anchor must also be checked before admission.
   for (const row of s.records) binding(row.receipt);
   const at = check(r,s), cap = Object.freeze({receipt:r, approvalDigest:hash(r), beforeStateDigest:hash(s), approvedAt:new Date(at).toISOString()});
   capabilities.set(cap,{authority, receipt:r, state:s}); return cap;
  },
  assertCurrent(cap, state) {
   enter();
   const c = capabilities.get(cap); if (!c || c.authority !== authority) fail('ORIGINAL_OPERATOR_READER_CAPABILITY_INVALID');
   const s = state === undefined ? c.state : parseOriginalOperatorReaderState(state);
   if (hash(s) !== cap.beforeStateDigest) fail('ORIGINAL_OPERATOR_READER_STATE_CHANGED');
   binding(c.receipt); check(c.receipt,s); return cap;
  },
  assertStored(state) {
   enter();
   const s = parseOriginalOperatorReaderState(state); for (const row of s.records) binding(row.receipt);
   // Durable history is not a new command: expiry is checked at approvedAt by
   // the parser, never renewed or consumed here. Current remains mandatory.
   check(null,s,true); return s;
  }
 });
 authorities.set(authority, {anchor, enter}); return authority;
}
export function appendOriginalOperatorReaderApproval(state, cap, authority) {
 assertOriginalOperatorReaderApprovalAuthority(authority);
 const s = parseOriginalOperatorReaderState(state); authority.assertCurrent(cap,s);
 const c = capabilities.get(cap); if (!c || c.authority !== authority) fail('ORIGINAL_OPERATOR_READER_CAPABILITY_INVALID');
 const r = c.receipt, b = r.body;
 const existing = s.records.find(row => row.operatorId === b.operatorId && row.keyId === b.keyId && row.sequence === b.sequence);
 if (existing) {if (canonicalJSON(existing.receipt) !== canonicalJSON(r)) fail('ORIGINAL_OPERATOR_READER_REPLAY_CONFLICT'); authority.assertCurrent(cap); return Object.freeze({state:s, readOnly:true, record:existing});}
 const rows = s.records.filter(row => row.operatorId === b.operatorId && row.keyId === b.keyId), last = rows.at(-1);
 if (b.sequence !== (last ? last.sequence + 1 : 1) || b.previousApprovalDigest !== (last ? hash(last.receipt) : null) || s.nonces.includes(b.nonce)) fail('ORIGINAL_OPERATOR_READER_SEQUENCE_INVALID');
 const record = capture({operatorId:b.operatorId,keyId:b.keyId,sequence:b.sequence,previousApprovalDigest:b.previousApprovalDigest,authorizationDigest:b.authorizationDigest,sourceDigest:b.sourceDigest,registryDigest:b.registryDigest,approvedAt:cap.approvedAt,receipt:r});
 const next = parseOriginalOperatorReaderState({version:1,records:[...s.records,record],nonces:[...s.nonces,b.nonce]});
 authority.assertCurrent(cap); return Object.freeze({state:next,readOnly:false,record});
}
