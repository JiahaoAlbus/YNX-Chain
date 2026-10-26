// Fixed YNX-BATCH/v0.1 wire grammar. Parsing never grants authorization.
export const VERSION = 'YNX-BATCH/v0.1';
export const SUITE = 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
export const LIMIT = Object.freeze({
  N: 1024, message: 1048576, aggregate: 8388608, certificate: 65536,
  proof: 1388, messagesFrame: 8392708,
  whole: 16 + (VERSION + '/WHOLE').length + 65536 + 8392708,
  member: 20 + (VERSION + '/MEMBER').length + 65536 + 1048576 + 1388,
});
export class ProtocolError extends Error {
  constructor(reason) { super(reason); this.name = 'ProtocolError'; this.code = 'ERR_YNX_BATCH'; }
}
export function requireThat(condition, reason) { if (!condition) throw new ProtocolError(reason); }
// One framing implementation; the Node facade retains its strict Buffer ABI.
import {equalBytes} from './public-bytes.mjs';
const utf8 = new TextEncoder();
const readNumber = (b, offset) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset, false);
const writeNumber = (b, n, offset = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(offset, n, false);
export function createCodec(runtime) {
  function bytes(value, name = 'bytes', max = LIMIT.whole) {
    requireThat(runtime.isBytes(value), `${name}: ${runtime.name} required`);
    requireThat(value.length <= max, `${name}: too large`);
    return value;
  }
  function exact(value, size, name) {
    bytes(value, name, size); requireThat(value.length === size, `${name}: wrong size`); return value;
  }
  function u32(n) {
    requireThat(Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff, 'invalid U32');
    const out = runtime.allocate(4); writeNumber(out, n); return out;
  }
  function number(b) { return readNumber(exact(b, 4, 'integer'), 0); }
  function batchCount(n) {
    requireThat(Number.isSafeInteger(n) && n >= 1 && n <= LIMIT.N && (n & (n - 1)) === 0, 'invalid N');
    return n;
  }
  function ascii(s, max, name) {
    requireThat(typeof s === 'string' && s.length >= 1 && s.length <= max && /^[\x20-\x7e]+$/.test(s), `${name}: invalid ASCII`);
    return runtime.copy(utf8.encode(s));
  }
  function asciiRead(b, max, name) {
    requireThat(b.length >= 1 && b.length <= max && b.every(x => x >= 32 && x <= 126), `${name}: invalid ASCII`);
    return String.fromCharCode(...b);
  }
  function encodeFields(fields) {
    requireThat(Array.isArray(fields) && fields.length <= LIMIT.N, 'invalid field count');
    let size = 4;
    const values = fields.map(x => {
      const b = typeof x === 'string' ? runtime.copy(utf8.encode(x)) : bytes(x);
      size += 4 + b.length; requireThat(size <= LIMIT.whole, 'frame too large'); return b;
    });
    const out = runtime.allocate(size); writeNumber(out, values.length, 0);
    let at = 4;
    for (const b of values) { writeNumber(out, b.length, at); at += 4; out.set(b, at); at += b.length; }
    return out;
  }
  // Validate the frame before allocating field copies. Views remain private to decoders.
  function fields(wire, count, max, caps = []) {
    bytes(wire, 'frame', max); requireThat(wire.length >= 4 && readNumber(wire, 0) === count, 'field count');
    requireThat(wire.length >= 4 + count * 4, 'missing field lengths');
    const views = []; let at = 4;
    for (let i = 0; i < count; i++) {
      requireThat(at + 4 <= wire.length, 'missing field length');
      const n = readNumber(wire, at); at += 4;
      requireThat(n <= (caps[i] ?? max) && n <= wire.length - at, 'field size');
      views.push(wire.subarray(at, at + n)); at += n;
    }
    requireThat(at === wire.length, 'trailing bytes'); return views;
  }
  function tag(b, value) { requireThat(equalBytes(b, utf8.encode(value)), 'wrong tag or suite'); }
  function encodeContext(c) {
    return encodeFields([VERSION + '/CONTEXT', SUITE, exact(c.chainId, 32, 'chainId'),
      ascii(c.owner, 128, 'owner'), exact(c.pkA, 2592, 'pkA'), exact(c.pkB, 64, 'pkB'),
      exact(c.batchId, 16, 'batchId'), ascii(c.purpose, 64, 'purpose')]);
  }
  function decodeContext(wire) {
    const f = fields(wire, 8, LIMIT.certificate, [64, 64, 32, 128, 2592, 64, 16, 64]);
    tag(f[0], VERSION + '/CONTEXT'); tag(f[1], SUITE);
    return {chainId: runtime.copy(exact(f[2], 32, 'chainId')), owner: asciiRead(f[3], 128, 'owner'),
      pkA: runtime.copy(exact(f[4], 2592, 'pkA')), pkB: runtime.copy(exact(f[5], 64, 'pkB')),
      batchId: runtime.copy(exact(f[6], 16, 'batchId')), purpose: asciiRead(f[7], 64, 'purpose')};
  }
  function encodeDescriptor(c) {
    return encodeFields([VERSION + '/DESCRIPTOR', encodeContext(c), u32(batchCount(c.N)),
      exact(c.rootA, 64, 'rootA'), exact(c.rootB, 64, 'rootB')]);
  }
  function decodeDescriptor(wire) {
    const f = fields(wire, 5, LIMIT.certificate, [64, LIMIT.certificate, 4, 64, 64]);
    tag(f[0], VERSION + '/DESCRIPTOR');
    return {...decodeContext(f[1]), N: batchCount(number(f[2])), rootA: runtime.copy(exact(f[3], 64, 'rootA')),
      rootB: runtime.copy(exact(f[4], 64, 'rootB'))};
  }
  function encodeCertificate(c) {
    const wire = encodeFields([encodeDescriptor(c), exact(c.sigmaA, 4627, 'sigmaA'), exact(c.sigmaB, 49856, 'sigmaB')]);
    bytes(wire, 'certificate', LIMIT.certificate); return wire;
  }
  function decodeCertificate(wire) {
    const f = fields(wire, 3, LIMIT.certificate, [LIMIT.certificate, 4627, 49856]);
    return {...decodeDescriptor(f[0]), sigmaA: runtime.copy(exact(f[1], 4627, 'sigmaA')),
      sigmaB: runtime.copy(exact(f[2], 49856, 'sigmaB'))};
  }
  function validateMessages(messages, N = messages?.length) {
    batchCount(N); requireThat(Array.isArray(messages) && messages.length === N, 'message count');
    let total = 0;
    for (const m of messages) { total += bytes(m, 'message', LIMIT.message).length; requireThat(total <= LIMIT.aggregate, 'aggregate limit'); }
    return total;
  }
  function encodeProof(proof, N) {
    const depth = Math.log2(batchCount(N)); u32(proof.index); requireThat(proof.index < N, 'index out of range');
    for (const p of [proof.pathA, proof.pathB]) {
      requireThat(Array.isArray(p) && p.length === depth, 'path depth'); for (const n of p) exact(n, 64, 'path node');
    }
    return encodeFields([u32(proof.index), encodeFields(proof.pathA), encodeFields(proof.pathB)]);
  }
  function decodeProof(wire, N) {
    const depth = Math.log2(batchCount(N));
    const f = fields(wire, 3, LIMIT.proof, [4, 4 + 68 * depth, 4 + 68 * depth]);
    const index = number(f[0]); requireThat(index < N, 'index out of range');
    const paths = f.slice(1).map(p => fields(p, depth, 4 + 68 * depth, Array(depth).fill(64))
      .map(n => runtime.copy(exact(n, 64, 'path node'))));
    return {index, pathA: paths[0], pathB: paths[1]};
  }
  function encodeWhole(certificate, messages) {
    validateMessages(messages, certificate.N);
    return encodeFields([VERSION + '/WHOLE', encodeCertificate(certificate), encodeFields(messages)]);
  }
  function decodeWhole(wire) {
    const f = fields(wire, 3, LIMIT.whole, [64, LIMIT.certificate, LIMIT.messagesFrame]);
    tag(f[0], VERSION + '/WHOLE'); const certificate = decodeCertificate(f[1]);
    const messages = fields(f[2], certificate.N, LIMIT.messagesFrame, Array(certificate.N).fill(LIMIT.message));
    validateMessages(messages, certificate.N); return {certificate, messages: messages.map(m => runtime.copy(m))};
  }
  function encodeMember(member) {
    return encodeFields([VERSION + '/MEMBER', encodeCertificate(member.certificate), bytes(member.message, 'message', LIMIT.message),
      encodeProof(member, member.certificate.N)]);
  }
  function decodeMember(wire) {
    const f = fields(wire, 4, LIMIT.member, [64, LIMIT.certificate, LIMIT.message, LIMIT.proof]);
    tag(f[0], VERSION + '/MEMBER'); const certificate = decodeCertificate(f[1]);
    return {certificate, message: runtime.copy(f[2]), ...decodeProof(f[3], certificate.N)};
  }

  return Object.freeze({bytes, exact, u32, batchCount, encodeFields, encodeContext, decodeContext, encodeDescriptor, decodeDescriptor, encodeCertificate, decodeCertificate, validateMessages, encodeProof, decodeProof, encodeWhole, decodeWhole, encodeMember, decodeMember, VERSION, SUITE, LIMIT, ProtocolError, requireThat});
}
