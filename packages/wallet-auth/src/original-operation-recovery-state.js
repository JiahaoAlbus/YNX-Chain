import { canonicalJSON, exactFields, WalletAuthError } from './canonical.js';

const HASH = /^[0-9a-f]{64}$/;
const MAPPING = ['operationId','sessionBinding','requestDigest','method','path','actionNonce','actionBodyDigest','wireDigest','productOperationId'];
const REGISTRATION = ['readerId','sourceDigest','productId','clientId','platform','account','deviceBinding'];
const NONCE = ['readerId','sourceDigest','operationId','sessionBinding','proofNonce','proofExpiresAt','consumedAt'];
const LIMIT = 100_000;
function fail(code) { throw new WalletAuthError(code, 'Original durable recovery state failed closed'); }
function hash(value) { return typeof value === 'string' && HASH.test(value); }
function opaque(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value); }
function date(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
export function captureOriginalRecoveryIdentity(input) {
  exactFields(input,['operationId','sessionBinding','requestDigest'],'Original recovery identity');
  const captured={operationId:input.operationId,sessionBinding:input.sessionBinding,requestDigest:input.requestDigest};
  if (!Object.values(captured).every(hash)) fail('RECOVERY_MAPPING_INVALID');
  return Object.freeze(captured);
}
export function captureOriginalReaderBytes(input) {
  if (!(input instanceof Uint8Array)) fail('RECOVERY_REQUEST_INVALID');
  // Read intrinsic slots, not overridden DTO accessors/species/iterators.
  const prototype=Object.getPrototypeOf(Uint8Array.prototype);
  let length,buffer;
  try {
    length=Object.getOwnPropertyDescriptor(prototype,'byteLength').get.call(input);
    buffer=Object.getOwnPropertyDescriptor(prototype,'buffer').get.call(input);
  } catch { fail('RECOVERY_REQUEST_INVALID'); }
  if (length > 4096 || !(buffer instanceof ArrayBuffer)) fail('RECOVERY_REQUEST_INVALID');
  const captured=new Uint8Array(length);
  Uint8Array.prototype.set.call(captured,input);
  return captured;
}
export function captureOriginalRecoveryJSON(input) {
  const raw=canonicalJSON(input);
  if (Buffer.byteLength(raw,'utf8') > 64 * 1024) fail('RECOVERY_REQUEST_INVALID');
  const copy=JSON.parse(raw);
  function freeze(value) {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
  }
  return freeze(copy);
}
function sorted(values, key, parse) {
  if (!Array.isArray(values) || values.length > LIMIT) fail('RECOVERY_CAPACITY');
  let before = '';
  return Object.freeze(values.map(value => {
    const checked = parse(value), id = key(checked);
    if (id <= before) fail('RECOVERY_DUPLICATE_OR_ORDER');
    before = id; return checked;
  }));
}
export function emptyOriginalRecoveryState() {
  return Object.freeze({version:1,mappings:Object.freeze([]),registrations:Object.freeze([]),readerNonces:Object.freeze([])});
}
export function parseOriginalOperationMapping(value) {
  exactFields(value, MAPPING, 'Original durable operation mapping');
  if (!['operationId','sessionBinding','requestDigest','actionBodyDigest','wireDigest'].every(key=>hash(value[key])) || value.actionBodyDigest !== value.wireDigest ||
      !/^(DELETE|GET|PATCH|POST|PUT)$/.test(value.method) || typeof value.path !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(value.path) || value.path.includes('//') || value.path.endsWith('/') ||
      typeof value.actionNonce !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(value.actionNonce) || !opaque(value.productOperationId)) fail('RECOVERY_MAPPING_INVALID');
  return Object.freeze({...value});
}
export function parseOriginalReaderRegistration(value) {
  exactFields(value, REGISTRATION, 'Original installed reader binding');
  if (!opaque(value.readerId) || !hash(value.sourceDigest) || !hash(value.deviceBinding) ||
      typeof value.productId !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(value.productId) ||
      typeof value.clientId !== 'string' || !/^[a-z][a-z0-9._-]{2,63}$/.test(value.clientId) ||
      !['android','ios','linux','macos','web','windows'].includes(value.platform) ||
      typeof value.account !== 'string' || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value.account)) fail('RECOVERY_REGISTRATION_INVALID');
  return Object.freeze({...value});
}
export function parseOriginalRecoveryState(input, control, projection) {
  exactFields(input, ['version','mappings','registrations','readerNonces'], 'Original recovery state');
  if (input.version !== 1) fail('RECOVERY_VERSION_UNAVAILABLE');
  const effects = new Map(projection.effects.map(value=>[value.operationId,value]));
  const sessions = new Map(control.authority.sessions.map(value=>[value.sessionBinding,value]));
  const mappings = sorted(input.mappings,value=>value.operationId,parseOriginalOperationMapping);
  const registrations = sorted(input.registrations,value=>value.readerId,parseOriginalReaderRegistration);
  const mapped = new Map(mappings.map(value=>[value.operationId,value]));
  const readers = new Map(registrations.map(value=>[value.readerId,value]));
  for (const value of mappings) {
    const effect = effects.get(value.operationId);
    if (!effect || effect.sessionBinding !== value.sessionBinding || effect.requestDigest !== value.requestDigest) fail('RECOVERY_MAPPING_CONFLICT');
  }
  const readerNonces = sorted(input.readerNonces,value=>`${value.readerId}:${value.sessionBinding}:${value.proofNonce}`,value=>{
    exactFields(value, NONCE, 'Original consumed recovery proof nonce');
    const map = mapped.get(value.operationId), reader = readers.get(value.readerId), session = sessions.get(value.sessionBinding);
    if (!map || !reader || !session || value.sessionBinding !== map.sessionBinding || reader.sourceDigest !== value.sourceDigest ||
        reader.productId !== session.productId || reader.clientId !== session.clientId || reader.platform !== session.platform || reader.account !== session.account || reader.deviceBinding !== session.deviceBinding ||
        typeof value.proofNonce !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(value.proofNonce) || !date(value.proofExpiresAt) || !date(value.consumedAt) ||
        value.consumedAt >= value.proofExpiresAt || value.proofExpiresAt > session.expiresAt) fail('RECOVERY_NONCE_INVALID');
    return Object.freeze({...value});
  });
  return Object.freeze({version:1,mappings,registrations,readerNonces});
}
export function appendOriginalOperationMapping(state, mapping) {
  const checked = parseOriginalOperationMapping(mapping), old = state.mappings.find(value=>value.operationId === checked.operationId);
  if (old && canonicalJSON(old) !== canonicalJSON(checked)) fail('RECOVERY_MAPPING_CONFLICT');
  return Object.freeze({...state,mappings:Object.freeze(old ? state.mappings : [...state.mappings,checked].sort((a,b)=>a.operationId < b.operationId ? -1 : 1))});
}
export function consumeOriginalRecoveryNonce(state, registration, record) {
  const checked = parseOriginalReaderRegistration(registration);
  const prior = state.registrations.find(value=>value.readerId === checked.readerId);
  // No automatic registration replacement, source rotation or old nonce prune.
  if (prior && canonicalJSON(prior) !== canonicalJSON(checked)) fail('RECOVERY_READER_SOURCE_CHANGED');
  const key = value=>`${value.readerId}:${value.sessionBinding}:${value.proofNonce}`;
  if (state.readerNonces.some(value=>key(value) === key(record))) fail('RECOVERY_PROOF_REPLAY');
  return Object.freeze({...state,
    registrations:Object.freeze(prior ? state.registrations : [...state.registrations,checked].sort((a,b)=>a.readerId < b.readerId ? -1 : 1)),
    readerNonces:Object.freeze([...state.readerNonces,Object.freeze({...record})].sort((a,b)=>key(a) < key(b) ? -1 : 1))});
}
