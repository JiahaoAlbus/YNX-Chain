// Pure publication-result DATA framing. No Native, key, Source, signature
// verification or identity-proof adapter. The N1 mathematics callee is separate.
import {pqDecodeBase64url} from './pq-wallet-contract.js';

const keys = Object.freeze(['version', 'purpose', 'requestOriginal', 'manifestOriginal', 'publisherOriginal', 'actualApprovalRef', 'publisherRegistrationRef', 'publisherRevision', 'publisherKeyVersion', 'invocationOriginal', 'signatureOriginal']);
const allowed = new Set(keys);
const te = new TextEncoder(), td = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const lengthOf = Object.getOwnPropertyDescriptor(typed, 'length').get;
const offsetOf = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get;
const capacityOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const resizableOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const detachedOf = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'detached')?.get;
const fail = () => { throw Object.assign(new Error('IDE_ARTIFACT_RELEASE_RESULT_INVALID'), {code: 'IDE_ARTIFACT_RELEASE_RESULT_INVALID'}); };
function originalBytes(value) {
  // isView rejects a Proxy without invoking its getPrototypeOf/ownKeys traps.
  if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype) fail();
  const buffer = bufferOf.call(value), length = lengthOf.call(value), offset = offsetOf.call(value);
  if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Reflect.ownKeys(buffer).length || length < 1 || length > 262144 || resizableOf?.call(buffer) || detachedOf?.call(buffer) || offset + length > capacityOf.call(buffer)) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== length || own.some((k, i) => k !== String(i))) fail();
  return new Uint8Array(new Uint8Array(buffer, offset, length));
}
// The wire is a FLAT object of exactly eleven string values. Existing SDK JSON
// helpers require JS canonical re-encoding, which is not a Foundation Unicode
// contract. Tokenize only this fixed shape to detect decoded-key duplicates;
// JSON.parse validates each string token. Do not reconstruct the original wire.
function strings(text) {
  let at = 0;
  const ws = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  const take = () => {
    if (text[at] !== '"') fail();
    const begin = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '\\') { if (at >= text.length) fail(); at++; }
      else if (c === '"') {
        const value = JSON.parse(text.slice(begin, at));
        if (typeof value !== 'string' || !value.length || /[\ud800-\udfff]/u.test(value)) fail();
        return value;
      }
    }
    fail();
  };
  ws(); if (text[at++] !== '{') fail(); ws();
  const out = Object.create(null), seen = new Set();
  for (;;) {
    const key = take();
    if (!allowed.has(key) || seen.has(key)) fail();
    seen.add(key); ws(); if (text[at++] !== ':') fail(); ws(); out[key] = take(); ws();
    if (text[at] === '}') { at++; break; }
    if (text[at++] !== ',') fail(); ws();
  }
  ws(); if (at !== text.length || seen.size !== keys.length) fail();
  return out;
}
function utf8(text, maximum) { const bytes = te.encode(text); if (!bytes.length || bytes.length > maximum) fail(); return bytes; }
function positiveU64(text) { if (!/^[1-9][0-9]{0,19}$/.test(text) || BigInt(text) > 18446744073709551615n) fail(); }
// Exact SourceProjectText rule, including Foundation edge whitespace. Internal
// Unicode/Cf characters are not blanket-banned when the producer accepts them.
const edge = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

export function decodeIDEArtifactReleaseResultData(resultOriginal) {
  try {
    if (arguments.length !== 1) fail();
    const original = originalBytes(resultOriginal);
    if (original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf) fail();
    const fields = strings(td.decode(original));
    if (fields.version !== 'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1' || fields.purpose !== 'ARTIFACT-RELEASE' || fields.manifestOriginal !== fields.invocationOriginal) fail();
    const request = utf8(fields.requestOriginal, 16384), manifest = utf8(fields.manifestOriginal, 16384);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(fields.actualApprovalRef)) fail();
    utf8(fields.publisherRegistrationRef, 256);
    if (/[\u0000-\u0020\u007f]/u.test(fields.publisherRegistrationRef) || edge.test(fields.publisherRegistrationRef)) fail();
    positiveU64(fields.publisherRevision); positiveU64(fields.publisherKeyVersion);
    const publisher = pqDecodeBase64url(fields.publisherOriginal, {max: 8192});
    const signature = pqDecodeBase64url(fields.signatureOriginal, {max: 98304});
    // Nested originals stay opaque. Their R13/M3/N1 structure, correlation,
    // mathematics and live approval/registration are separate owning checks.
    return Object.freeze({...fields,
      get resultOriginal() { return new Uint8Array(original); },
      get requestOriginalBytes() { return new Uint8Array(request); },
      get manifestOriginalBytes() { return new Uint8Array(manifest); },
      get invocationOriginalBytes() { return new Uint8Array(manifest); },
      get publisherOriginalBytes() { return new Uint8Array(publisher); },
      get signatureOriginalBytes() { return new Uint8Array(signature); },
      dataOnly: true, signatureVerified: false, trusted: false, authorized: false,
      nativeAdmission: false, registered: false, current: false,
      approvalCurrent: false, publicationAuthorized: false,
    });
  } catch { fail(); }
}
