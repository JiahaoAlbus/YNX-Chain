'use strict';
// A classical Merkle batch-signing combination candidate. No novelty/security
// proof or Chain integration. Every message is authorized by the SAME owner.
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const os = require('node:os');
const {performance} = require('node:perf_hooks');
const A = 'ml-dsa-87';
const B = 'slh-dsa-sha2-256f';
const N = 128;
const authenticated = new WeakMap();

function u32(x) {
  if (!Number.isSafeInteger(x) || x < 0 || x > 0xffffffff) throw new Error('invalid uint32');
  const b = Buffer.alloc(4); b.writeUInt32BE(x); return b;
}
function enc(...parts) {
  const out = [u32(parts.length)];
  for (const part of parts) {
    const b = typeof part === 'string' ? Buffer.from(part, 'utf8') : Buffer.from(part);
    out.push(u32(b.length), b);
  }
  return Buffer.concat(out);
}
function H(branch, ...parts) {
  return crypto.createHash(branch === 'A' ? 'sha3-512' : 'sha512').update(enc(...parts)).digest();
}
function context(c) {
  return enc('YNX-BATCH/v0.1/CONTEXT',
    'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',
    c.chainId, c.owner, c.pkA, c.pkB, c.batchId, c.purpose);
}
function descriptor(c) {
  return enc('YNX-BATCH/v0.1/DESCRIPTOR', context(c), u32(c.N), c.rootA, c.rootB);
}
function signedMessage(branch, c) {
  return enc(`YNX-BATCH/v0.1/CERT/${branch}`, descriptor(c));
}
function leaf(branch, ctx, count, index, message) {
  return H(branch, `YNX-BATCH/v0.1/LEAF/${branch}`, ctx, u32(count), u32(index), message);
}
function parent(branch, ctx, count, level, index, left, right) {
  return H(branch, `YNX-BATCH/v0.1/NODE/${branch}`, ctx, u32(count),
    u32(level), u32(index), left, right);
}
function makeTree(branch, ctx, messages) {
  const count = messages.length;
  const levels = [messages.map((m, i) => leaf(branch, ctx, count, i, m))];
  while (levels.at(-1).length > 1) {
    const lower = levels.at(-1), upper = [];
    for (let i = 0; i < lower.length; i += 2) {
      upper.push(parent(branch, ctx, count, levels.length, i / 2, lower[i], lower[i + 1]));
    }
    levels.push(upper);
  }
  return levels;
}
function makePath(levels, index) {
  const proof = [];
  for (let j = 0; j < levels.length - 1; j++) {
    proof.push(Buffer.from(levels[j][index ^ 1])); index = Math.floor(index / 2);
  }
  return proof;
}
function createBatch(keys, metadata, messages) {
  const count = messages.length;
  if (count < 1 || count > 1024 || (count & (count - 1))) throw new Error('unsupported N');
  // Freeze the exact batch inputs before constructing either commitment.
  const snapshot = messages.map((message) => Buffer.from(message));
  const messagesEncoded = Object.freeze(snapshot.map((message) => message.toString('base64')));
  const certificate = {...metadata, N:count};
  for (const field of ['chainId','batchId','pkA','pkB']) certificate[field] = Buffer.from(metadata[field]);
  const ctx = context(certificate);
  const treeA = makeTree('A', ctx, snapshot), treeB = makeTree('B', ctx, snapshot);
  certificate.rootA = treeA.at(-1)[0]; certificate.rootB = treeB.at(-1)[0];
  const frozenDescriptor = descriptor(certificate);
  certificate.sigmaA = crypto.sign(null, enc('YNX-BATCH/v0.1/CERT/A', frozenDescriptor), keys.A.privateKey);
  certificate.sigmaB = crypto.sign(null, enc('YNX-BATCH/v0.1/CERT/B', frozenDescriptor), keys.B.privateKey);
  // No externally usable completed batch is returned until BOTH signatures exist.
  return {certificate, messagesEncoded, treeA, treeB};
}
function extract(batch, index) {
  return {certificate:batch.certificate, index, message:Buffer.from(batch.messagesEncoded[index], 'base64'),
    pathA:makePath(batch.treeA, index), pathB:makePath(batch.treeB, index)};
}
function authenticateCertificate(c, trustedOwner) {
  try {
    if (!Number.isSafeInteger(c.N) || c.N < 1 || c.N > 1024 || (c.N & (c.N - 1))) return null;
    for (const [field, bytes] of [['chainId',32], ['batchId',16], ['pkA',2592],
      ['pkB',64], ['rootA',64], ['rootB',64], ['sigmaA',4627], ['sigmaB',49856]]) {
      if (!Buffer.isBuffer(c[field]) || c[field].length !== bytes) return null;
    }
    if (c.owner !== trustedOwner.owner || c.purpose !== trustedOwner.purpose) return null;
    for (const field of ['chainId', 'pkA', 'pkB']) {
      if (!c[field].equals(trustedOwner[field])) return null;
    }
    const pkA = crypto.createPublicKey({key:c.pkA, format:'raw-public', asymmetricKeyType:A});
    const pkB = crypto.createPublicKey({key:c.pkB, format:'raw-public', asymmetricKeyType:B});
    const okA = crypto.verify(null, signedMessage('A', c), pkA, c.sigmaA);
    const okB = crypto.verify(null, signedMessage('B', c), pkB, c.sigmaB);
    if (!okA || !okB) return null;
    // The authenticated cache token exposes no mutable roots/context. Its private
    // snapshot cannot be changed by later mutations of a received certificate.
    const token = Object.freeze({});
    authenticated.set(token, {N:c.N, ctx:context(c),
      rootA:Buffer.from(c.rootA), rootB:Buffer.from(c.rootB)});
    return token;
  } catch { return null; }
}
function checkPath(branch, state, member) {
  const proof = branch === 'A' ? member.pathA : member.pathB;
  if (!Array.isArray(proof) || proof.length !== Math.log2(state.N)) return false;
  if (proof.some((x) => !Buffer.isBuffer(x) || x.length !== 64)) return false;
  let index = member.index;
  let value = leaf(branch, state.ctx, state.N, index, member.message);
  for (let j = 0; j < proof.length; j++) {
    const up = Math.floor(index / 2);
    value = index & 1
      ? parent(branch, state.ctx, state.N, j + 1, up, proof[j], value)
      : parent(branch, state.ctx, state.N, j + 1, up, value, proof[j]);
    index = up;
  }
  return value.equals(branch === 'A' ? state.rootA : state.rootB);
}
function verifyMember(token, member) {
  try {
    const state = authenticated.get(token);
    if (!state || !Number.isSafeInteger(member.index) || member.index < 0 || member.index >= state.N) return false;
    if (!Buffer.isBuffer(member.message) || member.message.length > 1048576) return false;
    const okA = checkPath('A', state, member), okB = checkPath('B', state, member);
    return okA && okB;
  } catch { return false; }
}
function verify(member, trustedOwner) {
  const token = authenticateCertificate(member.certificate, trustedOwner);
  return token !== null && verifyMember(token, member);
}
function verifyWholeBatch(certificate, messages, trustedOwner) {
  try {
    const token = authenticateCertificate(certificate, trustedOwner);
    const state = token && authenticated.get(token);
    if (!state || !Array.isArray(messages) || messages.length !== state.N) return false;
    if (messages.some((message) => !Buffer.isBuffer(message) || message.length > 1048576)) return false;
    const rootA = makeTree('A', state.ctx, messages).at(-1)[0];
    const rootB = makeTree('B', state.ctx, messages).at(-1)[0];
    return rootA.equals(state.rootA) && rootB.equals(state.rootB);
  } catch { return false; }
}
function cloneMember(member) {
  return {...member, certificate:{...member.certificate}, message:Buffer.from(member.message),
    pathA:member.pathA.map((b) => Buffer.from(b)), pathB:member.pathB.map((b) => Buffer.from(b))};
}
function certificateWire(c) { return enc(descriptor(c), c.sigmaA, c.sigmaB); }
function proofWire(member) { return enc(u32(member.index), enc(...member.pathA), enc(...member.pathB)); }
function summarize(values) {
  const sorted = [...values].sort((a,b) => a-b), round = (n) => Number(n.toFixed(4));
  return {samples:values.length, medianMs:round(sorted[Math.floor(values.length/2)]),
    meanMs:round(values.reduce((a,b) => a+b, 0) / values.length), valuesMs:values.map(round)};
}
function measure(operation, validate) {
  validate(operation()); // one excluded warmup
  const values = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now(), result = operation();
    values.push(performance.now() - started); validate(result);
  }
  return summarize(values);
}

const setupStarted = performance.now();
const keys = {A:crypto.generateKeyPairSync(A), B:crypto.generateKeyPairSync(B)};
const metadata = {chainId:Buffer.alloc(32,0xa7), owner:'ynx-test-owner-001', purpose:'TX-BATCH',
  batchId:Buffer.alloc(16,1), pkA:keys.A.publicKey.export({format:'raw-public'}),
  pkB:keys.B.publicKey.export({format:'raw-public'})};
const messages = Array.from({length:N}, (_, i) => {
  const m = Buffer.alloc(1024,0x58); m.write('YNX BATCH authorized message',0,'ascii'); m.writeUInt32BE(i,64); return m;
});
const setupMs = performance.now() - setupStarted;
const batch = createBatch(keys, metadata, messages);
const members = messages.map((_, i) => extract(batch, i));
const token = authenticateCertificate(batch.certificate, metadata);
assert(token);
const resultVector = members.map((member) => ({index:member.index, valid:verifyMember(token, member)}));
assert(resultVector.every((result) => result.valid));
assert(verify(members[0], metadata));
assert(verifyWholeBatch(batch.certificate, messages, metadata));
const alteredWhole = messages.map((m) => Buffer.from(m)); alteredWhole[7][0] ^= 1;
assert.equal(verifyWholeBatch(batch.certificate, alteredWhole, metadata), false);
const reorderedWhole = [...messages]; [reorderedWhole[0],reorderedWhole[1]] = [reorderedWhole[1],reorderedWhole[0]];
assert.equal(verifyWholeBatch(batch.certificate, reorderedWhole, metadata), false);
assert.equal(verifyWholeBatch(batch.certificate, messages.slice(1), metadata), false);
const rejects = {};
function reject(name, member) { rejects[name] = !verify(member, metadata); assert(rejects[name], name); }
let bad = cloneMember(members[0]); bad.message[0] ^= 1; reject('changed_message', bad);
bad = cloneMember(members[0]); bad.index = 1; reject('changed_index', bad);
bad = cloneMember(members[0]); bad.certificate.rootA = Buffer.from(bad.certificate.rootA); bad.certificate.rootA[0] ^= 1; reject('changed_root_A', bad);
bad = cloneMember(members[0]); bad.certificate.rootB = Buffer.from(bad.certificate.rootB); bad.certificate.rootB[0] ^= 1; reject('changed_root_B', bad);
bad = cloneMember(members[0]); bad.pathA[0][0] ^= 1; reject('changed_path_A', bad);
bad = cloneMember(members[0]); bad.pathB[0][0] ^= 1; reject('changed_path_B', bad);
bad = cloneMember(members[0]); bad.certificate.N = 64; reject('changed_N', bad);
bad = cloneMember(members[0]); bad.certificate.batchId = Buffer.alloc(16,9); reject('changed_batchId', bad);
bad = cloneMember(members[0]); bad.certificate.owner = 'another-owner'; reject('changed_owner', bad);
const batch2 = createBatch(keys, {...metadata,batchId:Buffer.alloc(16,2)}, messages);
bad = cloneMember(members[0]); bad.certificate.sigmaB = batch2.certificate.sigmaB; reject('mixed_B_signature_from_another_batch', bad);
bad = cloneMember(members[0]); bad.certificate.sigmaA = batch2.certificate.sigmaA; reject('mixed_A_signature_from_another_batch', bad);
bad = cloneMember(members[0]); bad.pathB = extract(batch2,0).pathB; reject('mixed_B_path_from_another_batch', bad);
assert.equal(verifyMember(Object.freeze({}), members[0]), false);
bad = cloneMember(members[0]); bad.message[0] ^= 1; assert.equal(verifyMember(token,bad),false);
bad = cloneMember(members[0]); bad.pathA[0][0] ^= 1; assert.equal(verifyMember(token,bad),false);

const measurements = {
  create128MessageBatch:measure(() => createBatch(keys, metadata, messages), (b) => {
    assert(authenticateCertificate(b.certificate, metadata));
  }),
  authenticateDualCertificate:measure(() => authenticateCertificate(batch.certificate, metadata), assert),
  verifyWhole128MessageBatchWithoutMembershipPaths:measure(
    () => verifyWholeBatch(batch.certificate, messages, metadata), assert),
  all128MembershipsWithAuthenticatedCertificateCache:measure(
    () => members.map((member) => ({index:member.index, valid:verifyMember(token, member)})),
    (results) => assert.deepEqual(results, resultVector)),
};
const certBytes = certificateWire(batch.certificate).length;
const perProofBytes = proofWire(members[0]).length;
console.log(JSON.stringify({
  candidate:'YNX-BATCH-v0.1: classical Merkle batch-signing AND combination; novelty unestablished',
  environment:{node:process.version,openssl:process.versions.openssl,platform:process.platform,
    arch:process.arch,cpu:os.cpus()[0]?.model},
  design:{sameOwnerOnly:true,N,messageBytes:1024,A,B,hashA:'SHA3-512',hashB:'SHA-512',
    allowedN:'powers of two from 1 through 1024; no padding; only N=128 actually tested',
    twoIndependentStandardKeyGenerations:true,
    leafBinding:'branch domain + full context + N + index + complete original message',
    certificateBinding:'both signatures have separate domains and cover the same descriptor with chain identity, owner, both complete public keys, batchId, purpose, N and both roots',
    certificateCache:'opaque token after both signatures verify against a trusted owner/key binding; private immutable context/root snapshot',
    batchFreeze:'message bytes snapshotted before both trees; the same frozen descriptor is signed by both algorithms; no batch is returned before both signatures finish',
    inputAuthorization:'signer controls both private keys and authorizes the entire batch; not aggregation of unrelated account signatures'},
  correctness:{all128MembersValid:resultVector.every((r)=>r.valid),returnedOriginalIndexes:true,
    fullVerifyIncludingCertificatePassed:true,rejections:rejects,
    wholeBatchWithoutPathsValid:true,wholeBatchChangedMessageRejected:true,
    wholeBatchReorderingRejected:true,wholeBatchWrongCountRejected:true,
    fakeCertificateCacheTokenRejected:true,cachedMembershipTamperingRejected:true},
  sizes:{publicKeyABytes:metadata.pkA.length, publicKeyBBytes:metadata.pkB.length,
    signatureABytes:batch.certificate.sigmaA.length,signatureBBytes:batch.certificate.sigmaB.length,
    hashBytes:64,pathDepth:7,oneRawPathBytes:448,twoRawPathsPerMemberBytes:896,
    canonicalDescriptorBytes:descriptor(batch.certificate).length,
    sharedCertificateWireBytes:certBytes,eachCanonicalProofWireBytes:perProofBytes,
    wholeBatchCertificateAdditionalBytes:certBytes,
    wholeBatchCertificateBytesAmortizedPerMessage:certBytes/N,
    standaloneMemberCertificatePlusProofBytes:certBytes+perProofBytes,
    memberProofBytesWhenAuthenticatedCertificateAlreadyAvailable:perProofBytes,
    totalProofsPlusOneSharedCertificateBytes:certBytes+members.reduce((n,m)=>n+proofWire(m).length,0),
    excludes:'raw message bytes, transport headers and any external account/consensus records; certificate shared once across all 128 members'},
  timing:{warmupsPerCase:1,samplesPerCase:3,excludedStandardKeygenAndMessagesMs:Number(setupMs.toFixed(4)),
    createIncludes:'both complete Merkle trees and both standard signature operations; keys pregenerated',
    authenticateIncludes:'trusted owner binding checks, both public-key imports, both signature verifications and private cache snapshot creation',
    wholeBatchIncludes:'both certificate signatures and both complete tree reconstructions; no membership proofs transmitted or checked',
    membershipIncludes:'full original messages, both independently hashed paths for every member, output index/result vector; certificate authentication and proof extraction excluded',
    measurements},
  limitations:['No novelty claim, new-hardness assumption, formal security proof, independent cryptographic review or Chain integration.',
    'Certificate amortization requires one owner to authorize a batch and all requested membership proofs to be available.',
    'Not forward security, replay prevention, signatures from arbitrary unrelated signers or Chain TPS.',
    'Only N=128 was actually tested; chain nonce, owner authorization and execution validity need separate checks.',
    'Public-key registration, transaction policy, batch scheduling, wire decoder and resource limits require a production specification.'],
},null,2));
