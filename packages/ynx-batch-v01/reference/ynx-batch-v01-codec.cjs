'use strict';
// Strict byte codec for the existing YNX-BATCH/v0.1 combination prototype.
// Parsing is NOT signature verification, owner authorization, or Chain integration.
// Run directly for bounded-parser tests and real-signature round trips.
const assert = require('node:assert/strict');

const KiB = 1024;
const MiB = 1024 * KiB;
const LABEL = Object.freeze({
  context: 'YNX-BATCH/v0.1/CONTEXT',
  descriptor: 'YNX-BATCH/v0.1/DESCRIPTOR',
  whole: 'YNX-BATCH/v0.1/WHOLE',
  member: 'YNX-BATCH/v0.1/MEMBER',
});
const SUITE = 'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
const LENGTH = Object.freeze({chainId:32, batchId:16, pkA:2592, pkB:64,
  rootA:64, rootB:64, sigmaA:4627, sigmaB:49856});
const MAX_CERTIFICATE = 64 * KiB;
const MAX_MESSAGE = MiB;
const MAX_BATCH_MESSAGES = 8 * MiB;
const MAX_N = 1024;
// Enc(pathA) and Enc(pathB) each have 4 + depth*(4+64) bytes.
const MAX_PROOF = 4 + 3*4 + 4 + 2*(4 + 10*(4+64));
const MAX_MESSAGES_FRAME = 4 + MAX_N*4 + MAX_BATCH_MESSAGES;
const MAX_WHOLE = 4 + 3*4 + Buffer.byteLength(LABEL.whole) +
  MAX_CERTIFICATE + MAX_MESSAGES_FRAME;
const MAX_MEMBER = 4 + 4*4 + Buffer.byteLength(LABEL.member) +
  MAX_CERTIFICATE + MAX_MESSAGE + MAX_PROOF;

class CodecError extends Error {
  constructor(message) { super(message); this.name = 'CodecError'; this.code = 'ERR_YNX_BATCH_WIRE'; }
}
function fail(message) { throw new CodecError(message); }
function bytes(value, name) {
  if (!Buffer.isBuffer(value)) fail(`${name}: expected Buffer`);
  return value;
}
function exact(value, length, name) {
  bytes(value, name);
  if (value.length !== length) fail(`${name}: invalid length`);
  return value;
}
function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) fail(`${name}: invalid u32`);
  return value;
}
function u32(value) {
  integer(value, 'integer');
  const output = Buffer.alloc(4); output.writeUInt32BE(value); return output;
}
function readU32(value, name) { return exact(value, 4, name).readUInt32BE(0); }
function count(value) {
  integer(value, 'N');
  if (value < 1 || value > MAX_N || (value & (value - 1)) !== 0) fail('N: expected power of two from 1 to 1024');
  return value;
}
function asciiBuffer(value, min, max, name) {
  bytes(value, name);
  if (value.length < min || value.length > max) fail(`${name}: invalid length`);
  for (const octet of value) if (octet < 0x20 || octet > 0x7e) fail(`${name}: non-printable ASCII`);
  return value;
}
function asciiString(value, min, max, name) {
  if (typeof value !== 'string') fail(`${name}: expected string`);
  // Check code points before encoding; Node's ASCII encoder can truncate high bits.
  if (!/^[\x20-\x7e]*$/.test(value)) fail(`${name}: non-printable ASCII`);
  return asciiBuffer(Buffer.from(value, 'ascii'), min, max, name);
}
function constant(value, text, name) {
  if (!value.equals(Buffer.from(text, 'utf8'))) fail(`${name}: wrong constant`);
}

// Enc = u32be(count) || (u32be(length) || octets)*count.
// This generic framing helper intentionally has no schema semantics.
function encodeFields(fields) {
  if (!Array.isArray(fields) || fields.length > MAX_N) fail('frame: field count limit');
  const output = [u32(fields.length)];
  let size = 4;
  for (const item of fields) {
    const value = typeof item === 'string' ? Buffer.from(item, 'utf8') : bytes(item, 'field');
    if (value.length > MAX_WHOLE) fail('frame: field size limit');
    size += 4 + value.length;
    if (size > MAX_WHOLE) fail('frame: size limit');
    output.push(u32(value.length), value);
  }
  return Buffer.concat(output, size);
}
function readFields(input, {name, expectedCount, maxCount = MAX_N,
  maxBytes = MAX_WHOLE, maxFieldBytes = maxBytes}) {
  bytes(input, name);
  if (input.length > maxBytes) fail(`${name}: size limit`);
  if (input.length < 4) fail(`${name}: truncated count`);
  const fieldCount = input.readUInt32BE(0);
  if (fieldCount > maxCount || (expectedCount !== undefined && fieldCount !== expectedCount)) fail(`${name}: field count`);
  // Reject impossible count/length layouts before looping or allocating field arrays.
  if (fieldCount > Math.floor((input.length - 4) / 4)) fail(`${name}: truncated lengths`);
  const fields = [];
  let offset = 4;
  for (let index = 0; index < fieldCount; index++) {
    if (input.length - offset < 4) fail(`${name}: truncated length`);
    const length = input.readUInt32BE(offset); offset += 4;
    if (length > maxFieldBytes || length > input.length - offset) fail(`${name}: field length`);
    fields.push(input.subarray(offset, offset + length)); offset += length;
  }
  if (offset !== input.length) fail(`${name}: trailing data`);
  return fields;
}

function encodeContext(c) {
  for (const field of ['chainId', 'batchId', 'pkA', 'pkB']) exact(c[field], LENGTH[field], field);
  return encodeFields([LABEL.context, SUITE, c.chainId,
    asciiString(c.owner, 1, 128, 'owner'), c.pkA, c.pkB, c.batchId,
    asciiString(c.purpose, 1, 64, 'purpose')]);
}
function decodeContext(input) {
  const f = readFields(input, {name:'C', expectedCount:8, maxBytes:MAX_CERTIFICATE});
  constant(f[0], LABEL.context, 'context tag'); constant(f[1], SUITE, 'algorithm suite');
  exact(f[2], 32, 'chainId'); asciiBuffer(f[3], 1, 128, 'owner');
  exact(f[4], 2592, 'pkA'); exact(f[5], 64, 'pkB'); exact(f[6], 16, 'batchId');
  asciiBuffer(f[7], 1, 64, 'purpose');
  return {chainId:Buffer.from(f[2]), owner:f[3].toString('ascii'),
    pkA:Buffer.from(f[4]), pkB:Buffer.from(f[5]), batchId:Buffer.from(f[6]),
    purpose:f[7].toString('ascii')};
}
function encodeDescriptor(c) {
  count(c.N); exact(c.rootA, 64, 'rootA'); exact(c.rootB, 64, 'rootB');
  return encodeFields([LABEL.descriptor, encodeContext(c), u32(c.N), c.rootA, c.rootB]);
}
function decodeDescriptor(input) {
  const f = readFields(input, {name:'D', expectedCount:5, maxBytes:MAX_CERTIFICATE});
  constant(f[0], LABEL.descriptor, 'descriptor tag');
  const c = decodeContext(f[1]);
  const N = count(readU32(f[2], 'N'));
  exact(f[3], 64, 'rootA'); exact(f[4], 64, 'rootB');
  return {...c, N, rootA:Buffer.from(f[3]), rootB:Buffer.from(f[4])};
}
function encodeCertificate(c) {
  exact(c.sigmaA, 4627, 'sigmaA'); exact(c.sigmaB, 49856, 'sigmaB');
  const output = encodeFields([encodeDescriptor(c), c.sigmaA, c.sigmaB]);
  if (output.length > MAX_CERTIFICATE) fail('certificate: size limit');
  return output;
}
function decodeCertificate(input) {
  const f = readFields(input, {name:'certificate', expectedCount:3, maxBytes:MAX_CERTIFICATE});
  const c = decodeDescriptor(f[0]);
  exact(f[1], 4627, 'sigmaA'); exact(f[2], 49856, 'sigmaB');
  return {...c, sigmaA:Buffer.from(f[1]), sigmaB:Buffer.from(f[2])};
}
function encodeProof(member, N) {
  const depth = Math.log2(count(N));
  integer(member.index, 'index');
  if (member.index >= N) fail('index: out of range');
  for (const path of [member.pathA, member.pathB]) {
    if (!Array.isArray(path) || path.length !== depth) fail('path: wrong depth');
    for (const node of path) exact(node, 64, 'path node');
  }
  return encodeFields([u32(member.index), encodeFields(member.pathA), encodeFields(member.pathB)]);
}
function decodeProof(input, N) {
  const depth = Math.log2(count(N));
  const f = readFields(input, {name:'proof', expectedCount:3, maxBytes:MAX_PROOF});
  const index = readU32(f[0], 'index');
  if (index >= N) fail('index: out of range');
  const paths = f.slice(1).map((wire) => readFields(wire, {
    name:'path', expectedCount:depth, maxCount:10,
    maxBytes:4 + depth*68, maxFieldBytes:64,
  }).map((node) => Buffer.from(exact(node, 64, 'path node'))));
  return {index, pathA:paths[0], pathB:paths[1]};
}
function validateMessages(messages, N) {
  count(N);
  if (!Array.isArray(messages) || messages.length !== N) fail('messages: count does not match N');
  let aggregate = 0;
  for (const message of messages) {
    bytes(message, 'message');
    if (message.length > MAX_MESSAGE) fail('message: size limit');
    aggregate += message.length;
    if (aggregate > MAX_BATCH_MESSAGES) fail('messages: aggregate size limit');
  }
  return aggregate;
}
function encodeWhole(certificate, messages) {
  validateMessages(messages, certificate.N);
  return encodeFields([LABEL.whole, encodeCertificate(certificate), encodeFields(messages)]);
}
function decodeWhole(input) {
  const f = readFields(input, {name:'whole', expectedCount:3, maxBytes:MAX_WHOLE});
  constant(f[0], LABEL.whole, 'whole tag');
  const certificate = decodeCertificate(f[1]);
  const messages = readFields(f[2], {name:'messages', expectedCount:certificate.N,
    maxCount:MAX_N, maxBytes:MAX_MESSAGES_FRAME, maxFieldBytes:MAX_MESSAGE});
  validateMessages(messages, certificate.N);
  return {certificate, messages:messages.map((message) => Buffer.from(message))};
}
function encodeMember(member) {
  bytes(member.message, 'message');
  if (member.message.length > MAX_MESSAGE) fail('message: size limit');
  return encodeFields([LABEL.member, encodeCertificate(member.certificate), member.message,
    encodeProof(member, member.certificate.N)]);
}
function decodeMember(input) {
  const f = readFields(input, {name:'member', expectedCount:4, maxBytes:MAX_MEMBER});
  constant(f[0], LABEL.member, 'member tag');
  const certificate = decodeCertificate(f[1]);
  if (f[2].length > MAX_MESSAGE) fail('message: size limit');
  return {certificate, message:Buffer.from(f[2]), ...decodeProof(f[3], certificate.N)};
}

module.exports = Object.freeze({
  CodecError, encodeFields, encodeContext, decodeContext, encodeDescriptor, decodeDescriptor,
  encodeCertificate, decodeCertificate, encodeProof, decodeProof,
  encodeWhole, decodeWhole, encodeMember, decodeMember,
  spec:Object.freeze({LABEL, SUITE, LENGTH, defaultPurpose:'TX-BATCH',
    maxN:MAX_N, maxOwnerBytes:128, maxPurposeBytes:64, maxMessageBytes:MAX_MESSAGE,
    maxAggregateMessageBytes:MAX_BATCH_MESSAGES, maxCertificateBytes:MAX_CERTIFICATE,
    maxWholeWireBytes:MAX_WHOLE, maxMemberWireBytes:MAX_MEMBER,
    integerEncoding:'exactly four bytes, unsigned big-endian',
    textEncoding:'fixed tags UTF-8; owner and purpose printable ASCII 0x20..0x7e',
    note:'Decoder success is syntax/resource validation only. Authenticate both certificate signatures against a trusted owner binding, then verify both roots/paths and application replay/execution rules.'}),
});

function selfTest() {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const source = fs.readFileSync(path.join(__dirname, 'ynx-batch-v01-prototype.cjs'), 'utf8');
  const marker = '\nconst setupStarted = performance.now();';
  const boundary = source.indexOf(marker);
  assert(boundary > 0 && source.indexOf(marker, boundary + marker.length) === -1,
    'prototype function-section marker must be unique');
  // Reuse only the existing function definitions; do not execute its benchmark,
  // edit its file, or expose generated private keys in the output.
  const fixtureModule = {exports:{}};
  new Function('require', 'Buffer', 'module', source.slice(0, boundary) +
    '\nmodule.exports = {createBatch, extract, context, descriptor, certificateWire, proofWire, authenticateCertificate, verifyMember, verify, verifyWholeBatch};')(
    require, Buffer, fixtureModule);
  const p = fixtureModule.exports;
  const keys = {A:crypto.generateKeyPairSync('ml-dsa-87'),
    B:crypto.generateKeyPairSync('slh-dsa-sha2-256f')};
  const metadata = {chainId:crypto.randomBytes(32), owner:'ynx-test-owner-001',
    purpose:'TX-BATCH', batchId:crypto.randomBytes(16),
    pkA:keys.A.publicKey.export({format:'raw-public'}),
    pkB:keys.B.publicKey.export({format:'raw-public'})};
  const messages = Array.from({length:128}, (_, index) => {
    const message = Buffer.alloc(1024, 0x58); message.writeUInt32BE(index, 0); return message;
  });
  const batch = p.createBatch(keys, metadata, messages);
  const certificate = batch.certificate;
  const member = p.extract(batch, 127);
  const cWire = encodeCertificate(certificate);
  const dWire = encodeDescriptor(certificate);
  const contextWire = encodeContext(certificate);
  const pWire = encodeProof(member, 128);
  const wholeWire = encodeWhole(certificate, messages);
  const memberWire = encodeMember(member);
  assert.deepEqual(contextWire, p.context(certificate));
  assert.deepEqual(dWire, p.descriptor(certificate));
  assert.deepEqual(cWire, p.certificateWire(certificate));
  assert.deepEqual(pWire, p.proofWire(member));
  const decodedWhole = decodeWhole(wholeWire), decodedMember = decodeMember(memberWire);
  assert.deepEqual(encodeWhole(decodedWhole.certificate, decodedWhole.messages), wholeWire);
  assert.deepEqual(encodeMember(decodedMember), memberWire);
  assert(p.verifyWholeBatch(decodedWhole.certificate, decodedWhole.messages, metadata));
  assert(p.verify(decodedMember, metadata));
  const token = p.authenticateCertificate(decodeCertificate(cWire), metadata); assert(token);
  for (let index = 0; index < 128; index++) {
    const decoded = decodeMember(encodeMember(p.extract(batch, index)));
    assert.equal(decoded.index, index); assert(p.verifyMember(token, decoded));
  }
  const edgeCases = [];
  for (const N of [1, 1024]) {
    const edgeMessages = Array.from({length:N}, () => Buffer.alloc(0));
    const edge = p.createBatch(keys, {...metadata, batchId:crypto.randomBytes(16)}, edgeMessages);
    const whole = decodeWhole(encodeWhole(edge.certificate, edgeMessages));
    const item = decodeMember(encodeMember(p.extract(edge, N - 1)));
    assert(p.verifyWholeBatch(whole.certificate, whole.messages, metadata));
    assert(p.verify(item, metadata));
    edgeCases.push({N, index:item.index, pathDepth:item.pathA.length, cryptoVerified:true});
  }
  // Returned bytes own their storage, so mutations of input wire buffers cannot
  // silently alter an already-decoded record.
  const mutableWire = Buffer.from(memberWire), detached = decodeMember(mutableWire);
  mutableWire.fill(0); assert(p.verify(detached, metadata));
  const rejected = [];
  function reject(name, operation) {
    assert.throws(operation, (error) => error instanceof CodecError, name); rejected.push(name);
  }
  function fields(wire) { return readFields(wire, {name:'test frame'}); }
  function replace(wire, index, value) {
    const f = fields(wire); f[index] = value; return encodeFields(f);
  }
  function patchContext(transform) {
    const cf = fields(cWire), df = fields(cf[0]), xf = fields(df[1]);
    transform(xf); df[1] = encodeFields(xf); cf[0] = encodeFields(df); return encodeFields(cf);
  }
  function patchDescriptor(transform) {
    const cf = fields(cWire), df = fields(cf[0]);
    transform(df); cf[0] = encodeFields(df); return encodeFields(cf);
  }
  reject('certificate_tail', () => decodeCertificate(Buffer.concat([cWire, Buffer.from([0])])));
  reject('certificate_truncated', () => decodeCertificate(cWire.subarray(0, cWire.length - 1)));
  const maliciousCount = Buffer.from(cWire); maliciousCount.writeUInt32BE(0xffffffff, 0);
  reject('u32_count_bomb', () => decodeCertificate(maliciousCount));
  const maliciousLength = Buffer.from(cWire); maliciousLength.writeUInt32BE(0xffffffff, 4);
  reject('u32_length_bomb', () => decodeCertificate(maliciousLength));
  reject('certificate_oversize', () => decodeCertificate(Buffer.alloc(MAX_CERTIFICATE + 1)));
  reject('certificate_field_count', () => decodeCertificate(encodeFields([...fields(cWire), Buffer.alloc(0)])));
  reject('descriptor_field_count', () => decodeCertificate(patchDescriptor((f) => f.push(Buffer.alloc(0)))));
  reject('context_field_count', () => decodeCertificate(patchContext((f) => f.pop())));
  reject('context_trailing', () => decodeCertificate(patchDescriptor((f) => { f[1] = Buffer.concat([f[1], Buffer.from([0])]); })));
  reject('wrong_context_tag', () => decodeCertificate(patchContext((f) => { f[0] = Buffer.from('YNX-BATCH/v0.2/CONTEXT'); })));
  reject('wrong_descriptor_tag', () => decodeCertificate(patchDescriptor((f) => { f[0] = Buffer.from('YNX-BATCH/v0.2/DESCRIPTOR'); })));
  reject('wrong_algorithm_suite', () => decodeCertificate(patchContext((f) => { f[1] = Buffer.from(SUITE.replace('87', '65')); })));
  for (const [name, field, size] of [['chainId',2,31], ['pkA',4,2591], ['pkB',5,63], ['batchId',6,15]]) {
    reject(`${name}_length`, () => decodeCertificate(patchContext((f) => { f[field] = Buffer.alloc(size); })));
  }
  for (const [name, field, value] of [
    ['owner_empty',3,Buffer.alloc(0)], ['owner_too_long',3,Buffer.alloc(129,0x41)],
    ['owner_control',3,Buffer.from('bad\towner')], ['owner_non_ascii',3,Buffer.from('ownér')],
    ['purpose_empty',7,Buffer.alloc(0)], ['purpose_too_long',7,Buffer.alloc(65,0x41)],
    ['purpose_control',7,Buffer.from('TX\nBATCH')],
  ]) reject(name, () => decodeCertificate(patchContext((f) => { f[field] = value; })));
  reject('N_noncanonical_five_bytes', () => decodeCertificate(patchDescriptor((f) => { f[2] = Buffer.from([0,0,0,0,128]); })));
  for (const N of [0,3,2048,0xffffffff]) reject(`N_${N}`, () => decodeCertificate(patchDescriptor((f) => { f[2] = u32(N); })));
  reject('root_A_length', () => decodeCertificate(patchDescriptor((f) => { f[3] = Buffer.alloc(63); })));
  reject('root_B_length', () => decodeCertificate(patchDescriptor((f) => { f[4] = Buffer.alloc(65); })));
  reject('signature_A_length', () => decodeCertificate(replace(cWire,1,Buffer.alloc(4626))));
  reject('signature_B_length', () => decodeCertificate(replace(cWire,2,Buffer.alloc(49855))));
  reject('whole_wrong_tag', () => decodeWhole(replace(wholeWire,0,Buffer.from(LABEL.member))));
  reject('member_wrong_tag', () => decodeMember(replace(memberWire,0,Buffer.from(LABEL.whole))));
  reject('whole_field_count', () => decodeWhole(encodeFields([...fields(wholeWire),Buffer.alloc(0)])));
  reject('member_field_count', () => decodeMember(encodeFields(fields(memberWire).slice(0,3))));
  reject('whole_trailing', () => decodeWhole(Buffer.concat([wholeWire,Buffer.from([0])])));
  reject('member_trailing', () => decodeMember(Buffer.concat([memberWire,Buffer.from([0])])));
  reject('whole_message_count', () => decodeWhole(replace(wholeWire,2,encodeFields(messages.slice(1)))));
  reject('member_message_oversize', () => decodeMember(replace(memberWire,2,Buffer.alloc(MAX_MESSAGE+1))));
  const longMessages = [Buffer.alloc(MAX_MESSAGE+1),...messages.slice(1)];
  reject('whole_message_oversize', () => decodeWhole(replace(wholeWire,2,encodeFields(longMessages))));
  const maxAggregateMessages = Array.from({length:128}, (_, i) => Buffer.alloc(i < 8 ? MiB : 0));
  const maxWire = replace(wholeWire,2,encodeFields(maxAggregateMessages));
  const atLimit = decodeWhole(maxWire);
  assert.equal(atLimit.messages.reduce((sum,m) => sum+m.length,0),MAX_BATCH_MESSAGES);
  maxAggregateMessages[8] = Buffer.from([0]);
  reject('whole_aggregate_oversize', () => decodeWhole(replace(wholeWire,2,encodeFields(maxAggregateMessages))));
  reject('proof_field_count', () => decodeProof(encodeFields(fields(pWire).slice(0,2)),128));
  reject('index_noncanonical_eight_bytes', () => decodeProof(replace(pWire,0,Buffer.alloc(8)),128));
  for (const index of [128,0xffffffff]) reject(`index_${index}`, () => decodeProof(replace(pWire,0,u32(index)),128));
  reject('path_short', () => decodeProof(replace(pWire,1,encodeFields(member.pathA.slice(1))),128));
  reject('path_long', () => decodeProof(replace(pWire,1,encodeFields([...member.pathA,Buffer.alloc(64)])),128));
  reject('path_node_short', () => decodeProof(replace(pWire,1,encodeFields([Buffer.alloc(63),...member.pathA.slice(1)])),128));
  reject('path_node_long', () => decodeProof(replace(pWire,2,encodeFields([Buffer.alloc(65),...member.pathB.slice(1)])),128));
  reject('proof_trailing', () => decodeProof(Buffer.concat([pWire,Buffer.from([0])]),128));
  reject('encoder_negative_u32', () => u32(-1));
  reject('encoder_fraction_u32', () => u32(1.5));
  reject('encoder_owner_non_ascii', () => encodeContext({...certificate,owner:'ownér'}));
  // Correctly encoded tampering is accepted by the byte parser and then rejected
  // by cryptographic verification; the codec must never claim otherwise.
  const altered = decodeMember(memberWire); altered.message[0] ^= 1;
  assert.equal(p.verify(decodeMember(encodeMember(altered)),metadata),false);
  const alteredSig = decodeMember(memberWire); alteredSig.certificate.sigmaA[0] ^= 1;
  assert.equal(p.verify(decodeMember(encodeMember(alteredSig)),metadata),false);
  const owner42LengthDelta = 42 - Buffer.byteLength(metadata.owner,'ascii');
  const owner42 = {...certificate,owner:'0x'+'a'.repeat(40)};
  assert.equal(encodeCertificate(owner42).length,cWire.length+owner42LengthDelta);
  return {
    candidate:'YNX-BATCH/v0.1 strict codec; no Chain integration',
    environment:{node:process.version,openssl:process.versions.openssl},
    correctness:{matchesOriginalContextDescriptorCertificateProof:true,
      canonicalWholeAndMemberRoundTrip:true,wholeCryptoVerification:true,
      all128DecodedMembershipsCryptoVerified:true,boundaryBatches:edgeCases,
      decodedBytesDetachedFromInput:true,aggregate8MiBBoundaryAcceptedSyntaxOnly:true,
      tamperedMessageAndSignatureRejectedByCrypto:true,
      parserRejectionCount:rejected.length,parserRejections:rejected},
    exactSizes:{N:128,messageBytes:1024,owner:metadata.owner,ownerBytes:Buffer.byteLength(metadata.owner),
      purpose:metadata.purpose,purposeBytes:Buffer.byteLength(metadata.purpose),
      contextBytes:contextWire.length,descriptorBytes:dWire.length,certificateWireBytes:cWire.length,
      proofWireBytes:pWire.length,rawMessagesBytes:128*1024,
      messagesEncBytes:encodeFields(messages).length,wholeWireBytes:wholeWire.length,
      memberWireBytes:memberWire.length,wholeAdditionalBytes:wholeWire.length-128*1024,
      wholeAdditionalBytesPerMessage:(wholeWire.length-128*1024)/128,
      owner42AsciiFormula:{ownerBytes:42,deltaBytes:owner42LengthDelta,
        certificateWireBytes:cWire.length+owner42LengthDelta,
        wholeWireBytes:wholeWire.length+owner42LengthDelta,
        memberWireBytes:memberWire.length+owner42LengthDelta,
        note:'Length calculation only; changing owner requires new signatures and trusted binding. No address integration is implied.'}},
    limits:module.exports.spec,
    limitations:['Parsing enforces syntax and resource limits, not authorization or cryptographic validity.',
      'An individual MemberWire cannot prove the unavailable full batch total is at most 8 MiB; enforce that total when creating or receiving WholeWire. A members-only admission protocol needs separate authenticated size metadata if it requires independently verifiable aggregate limits.',
      'Owner and purpose are printable ASCII, inclusive 0x20..0x7e; no normalization or trimming.',
      'The same-owner and trusted-key-binding requirements of the original prototype remain unchanged.',
      'No new algorithm, formal proof, replay policy, production integration or Chain TPS result.'],
  };
}
if (require.main === module) console.log(JSON.stringify(selfTest(), null, 2));
