import {createPublicKey, verify, createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON, exactFields, WalletAuthError} from './canonical.js';

const DOMAIN = 'YNX_ORIGINAL_OPERATOR_DEVICE_READER_ROLE_CERTIFICATE_V1\n';
const FIELDS = ['version','purpose','rootId','rootKeyId','operatorId','keyId','operatorPublicKey','registryDigest','account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform','familyId','generation','issuedAt','expiresAt'];
const verifiers = new WeakSet(), capabilities = new WeakMap();
const fail = (code = 'ORIGINAL_OPERATOR_ROLE_CERTIFICATE_INVALID') => {throw new WalletAuthError(code, 'Original independently approved operator role unavailable');};
const ident = v => typeof v === 'string' && /^[a-z][a-z0-9._:-]{2,127}$/.test(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = value => {const n = typeof value === 'string' ? Date.parse(value) : NaN; if (!Number.isFinite(n) || n < 0 || new Date(n).toISOString() !== value) fail(); return n;};
function capture(input, allowArrays = false) {
 const seen = new Set(); let count = 0, budget = 0;
 function visit(v, depth) {
  if (++count > 16384 || depth > 24) fail();
  if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v))) return v;
  if (typeof v === 'string') {budget += Buffer.byteLength(v); if (budget > 65536) fail('ORIGINAL_OPERATOR_ROLE_BODY_INVALID'); return v;}
  if (!v || typeof v !== 'object' || types.isProxy(v) || seen.has(v)) fail(); seen.add(v);
  const array = Array.isArray(v); if (array && !allowArrays) fail();
  if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) fail();
  const keys = Reflect.ownKeys(v), out = array ? [] : {};
  if (array && (v.length > 128 || keys.length !== v.length + 1)) fail();
  for (const k of keys) {
   if (array && k === 'length') continue;
   const d = Object.getOwnPropertyDescriptor(v,k);
   if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d,'value') || (array && !/^(0|[1-9][0-9]*)$/.test(k))) fail();
   budget += Buffer.byteLength(k); if (budget > 65536) fail('ORIGINAL_OPERATOR_ROLE_BODY_INVALID');
   Object.defineProperty(out,k,{value:visit(d.value,depth+1),enumerable:true});
  }
  return Object.freeze(out);
 }
 const out = visit(input,0); if (Buffer.byteLength(canonicalJSON(out)) > 65536) fail('ORIGINAL_OPERATOR_ROLE_BODY_INVALID'); return out;
}
function edPublicKey(pem, code) {if (typeof pem !== 'string') fail(code); try {const k = createPublicKey(pem); if (k.asymmetricKeyType !== 'ed25519') fail(code); return k;} catch {fail(code);}}
export function assertOriginalOperatorRoleCertificateVerifier(value) {if (!verifiers.has(value)) fail('ORIGINAL_OPERATOR_ROLE_NOT_CONFIGURED'); return value;}
export function assertOriginalOperatorRoleVerifier(value) {return assertOriginalOperatorRoleCertificateVerifier(value);}
export function assertOriginalOperatorRoleCertificateCapability(value) {if (!capabilities.has(value)) fail('ORIGINAL_OPERATOR_ROLE_CAPABILITY_INVALID'); return value;}
// The root is a fixed externally admitted public authority. Providing a PEM is
// NOT independent admission. No issuer, root generation or signing is exported.
export function createOriginalOperatorRoleCertificateVerifier(input) {
 let o, root;
 try {
  if (!input || typeof input !== 'object' || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) fail();
  o = {}; for (const k of Reflect.ownKeys(input)) {const d = Object.getOwnPropertyDescriptor(input,k); if (typeof k !== 'string' || !d.enumerable || !Object.hasOwn(d,'value')) fail(); Object.defineProperty(o,k,{value:d.value,enumerable:true});}
  exactFields(o,['rootAnchor','certificate'],'Original role verifier'); root = capture(o.rootAnchor); exactFields(root,['rootId','rootKeyId','publicKey'],'Independent original role root'); if (!ident(root.rootId) || !ident(root.rootKeyId)) fail();} catch {fail('ORIGINAL_OPERATOR_ROLE_NOT_CONFIGURED');}
 if (o.certificate === null || o.certificate === undefined) fail('ORIGINAL_OPERATOR_ROLE_NOT_CONFIGURED');
 const rootKey = edPublicKey(root.publicKey,'ORIGINAL_OPERATOR_ROLE_NOT_CONFIGURED'), envelope = capture(o.certificate);
 exactFields(envelope,['body','signature'],'Original role certificate'); const b = envelope.body; exactFields(b,FIELDS,'Original role body');
 if (b.version !== 'accepted-device-reader-operator-role/v1' || b.purpose !== 'accepted-device-reader-operator-role/v1' || b.rootId !== root.rootId || b.rootKeyId !== root.rootKeyId || !ident(b.operatorId) || !ident(b.keyId) || !ident(b.productId) || !ident(b.clientId) || !hex(b.registryDigest) || !hex(b.deviceBinding) || !hex(b.sessionBinding) || typeof b.account !== 'string' || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(b.account) || typeof b.deviceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(b.deviceId) || !['web','android','ios','macos','linux','windows'].includes(b.platform) || typeof b.familyId !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(b.familyId) || !Number.isSafeInteger(b.generation) || b.generation < 1 || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature) || Buffer.from(envelope.signature,'base64url').toString('base64url') !== envelope.signature) fail();
 const issued = time(b.issuedAt), expires = time(b.expiresAt); if (expires <= issued || expires-issued > 86400000) fail();
 edPublicKey(b.operatorPublicKey,'ORIGINAL_OPERATOR_ROLE_CERTIFICATE_INVALID');
 if (!verify(null,Buffer.from(DOMAIN+canonicalJSON(b)),rootKey,Buffer.from(envelope.signature,'base64url'))) fail('ORIGINAL_OPERATOR_ROLE_SIGNATURE_INVALID');
 const operatorAnchor = capture({operatorId:b.operatorId,keyId:b.keyId,publicKey:b.operatorPublicKey,registryDigest:b.registryDigest});
 const certificateDigest = createHash('sha256').update(canonicalJSON(envelope)).digest('hex');
 const binding = capture({sessionBinding:b.sessionBinding,productId:b.productId});
 const verifier = Object.freeze({operatorAnchor,binding,sessionBinding:b.sessionBinding,certificate:envelope,certificateDigest,
  assertOriginalRoleCurrent(originalCaptured, at) {
   // No clock/getter/source callback: this view must be captured by the actual
   // mature original Kernel.current under the SAME Store transaction.
   if (types.isProxy(at) || !(at instanceof Date)) fail('ORIGINAL_OPERATOR_ROLE_TIME_INVALID');
   let now; try {now = Date.prototype.getTime.call(at);} catch {fail('ORIGINAL_OPERATOR_ROLE_TIME_INVALID');}
   if (!Number.isFinite(now) || now < issued || now >= expires) fail('ORIGINAL_OPERATOR_ROLE_EXPIRED');
   const view = capture(originalCaptured,true); exactFields(view,['session','projection'],'Original accepted role view');
   const s = view.session, p = view.projection;
   exactFields(p,['sessionBinding','familyId','generation','revoked'],'Original role projection');
   if (!s || typeof s !== 'object' || Array.isArray(s) || s.version !== '2' || s.chainId !== 'ynx_6423-1' || p.revoked !== false || p.sessionBinding !== b.sessionBinding || p.familyId !== b.familyId || p.generation !== b.generation) fail('ORIGINAL_OPERATOR_ROLE_BINDING_MISMATCH');
   for (const f of ['account','deviceId','deviceBinding','sessionBinding','productId','clientId','platform']) if (s[f] !== b[f]) fail('ORIGINAL_OPERATOR_ROLE_BINDING_MISMATCH');
   const sessionIssued = time(s.issuedAt), sessionExpires = time(s.expiresAt);
   if (sessionExpires <= sessionIssued || now < sessionIssued || now >= sessionExpires) fail('ORIGINAL_OPERATOR_ROLE_EXPIRED');
   const cap = Object.freeze({operatorAnchor,certificateDigest,originalCaptured:view,observedAt:new Date(now).toISOString(),expiresAt:b.expiresAt});
   capabilities.set(cap,{verifier}); return cap;
  }
 });
 verifiers.add(verifier); return verifier;
}
