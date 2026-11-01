// Public data validation only. These DTOs never establish chain registration,
// current-account authorization, a signing capability, or migration completion.
export const PQ_PROTOCOL_VERSION = 'YNX-BATCH/v0.1';
export const PQ_SUITE = 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
export const PQ_BACKUP_FORMAT = 'YNX-PQ-WALLET-BACKUP/v1';
export const PQ_PRIVATE_FORMAT = 'YNX-PQ-WALLET-PRIVATE/v1';
export const PQ_BINDING_FIELDS = Object.freeze(['protocolVersion', 'suite', 'chainId', 'owner', 'pkA', 'pkB']);
export const pqError = code => Object.assign(new Error(code), {code});
export function exactPQRecord(value, fields, code = 'PQ_SCHEMA_INVALID') {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw pqError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(k => !fields.includes(k)) ||
      fields.some(k => !descriptors[k] || !Object.hasOwn(descriptors[k], 'value'))) throw pqError(code);
  return value;
}
export function pqBase64url(bytes) {
  if (!(bytes instanceof Uint8Array) || (typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer)) throw pqError('PQ_BYTES_REQUIRED');
  let text = '';
  for (let i = 0; i < bytes.length; i += 4096) text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function pqDecodeBase64url(text, {exact, max = 65536} = {}) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(max * 4 / 3)) throw pqError('PQ_ENCODING_INVALID');
  let data;
  try { data = Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0)); }
  catch { throw pqError('PQ_ENCODING_INVALID'); }
  if (data.length > max || (exact !== undefined && data.length !== exact) || pqBase64url(data) !== text) throw pqError('PQ_ENCODING_INVALID');
  return data;
}
export function validatePQPublicBinding(value) {
  exactPQRecord(value, PQ_BINDING_FIELDS);
  if (value.protocolVersion !== PQ_PROTOCOL_VERSION || value.suite !== PQ_SUITE ||
      !validNetwork(value)) throw pqError('PQ_BINDING_INVALID');
  pqDecodeBase64url(value.pkA, {exact: 2592, max: 2592});
  pqDecodeBase64url(value.pkB, {exact: 64, max: 64});
  return Object.freeze(Object.fromEntries(PQ_BINDING_FIELDS.map(k => [k, value[k]])));
}
function validNetwork(value) {
  return typeof value.chainId === 'string' && /^[a-f0-9]{64}$/.test(value.chainId) &&
    typeof value.owner === 'string' && /^[\x20-\x7e]{1,128}$/.test(value.owner);
}
export function validatePQNetworkBinding(value) {
  exactPQRecord(value, ['chainId', 'owner']);
  if (!validNetwork(value)) throw pqError('PQ_BINDING_INVALID');
  return Object.freeze({chainId: value.chainId, owner: value.owner});
}
export function assertPQPublicBindingMatches(actual, expected) {
  const a = validatePQPublicBinding(actual), b = validatePQPublicBinding(expected);
  if (PQ_BINDING_FIELDS.some(k => a[k] !== b[k])) throw pqError('PQ_BINDING_MISMATCH');
  return a;
}
