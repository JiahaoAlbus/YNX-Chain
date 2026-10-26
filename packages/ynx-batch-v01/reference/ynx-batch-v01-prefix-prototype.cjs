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

// Mathematical-equivalence optimization: cache the exact bytes already absorbed
// by SHA3-512 / SHA-512. No new digest, domain, signature or message encoding.
function fields(...parts) { return enc(...parts).subarray(4); }
function prepareHashPrefixes(ctx, count) {
  const prepared = {};
  for (const branch of ['A','B']) {
    const algorithm = branch === 'A' ? 'sha3-512' : 'sha512';
    const leafPrefix = Buffer.concat([u32(5),
      fields(`YNX-BATCH/v0.1/LEAF/${branch}`, ctx, u32(count))]);
    const nodePrefix = Buffer.concat([u32(7),
      fields(`YNX-BATCH/v0.1/NODE/${branch}`, ctx, u32(count))]);
    prepared[branch] = {leafPrefix, nodePrefix,
      leafState:crypto.createHash(algorithm).update(leafPrefix),
      nodeState:crypto.createHash(algorithm).update(nodePrefix)};
  }
  return prepared;
}
function prefixLeaf(branch, prepared, index, message) {
  return prepared[branch].leafState.copy().update(fields(u32(index),message)).digest();
}
function prefixParent(branch, prepared, level, index, left, right) {
  return prepared[branch].nodeState.copy()
    .update(fields(u32(level),u32(index),left,right)).digest();
}
function makeTreePrefix(branch, prepared, messages) {
  const levels = [messages.map((message,index) => prefixLeaf(branch,prepared,index,message))];
  while (levels.at(-1).length > 1) {
    const lower = levels.at(-1), upper = [];
    for (let i = 0; i < lower.length; i += 2) {
      upper.push(prefixParent(branch,prepared,levels.length,i/2,lower[i],lower[i+1]));
    }
    levels.push(upper);
  }
  return levels;
}
const prefixCaches = new WeakMap();
function cachedPrefixes(token) {
  const state = authenticated.get(token);
  if (!state) return null;
  let prepared = prefixCaches.get(token);
  if (!prepared) {
    prepared = prepareHashPrefixes(state.ctx,state.N); prefixCaches.set(token,prepared);
  }
  return {state,prepared};
}
function checkPathPrefix(branch, state, prepared, member) {
  const proof = branch === 'A' ? member.pathA : member.pathB;
  if (!Array.isArray(proof) || proof.length !== Math.log2(state.N)) return false;
  if (proof.some((x) => !Buffer.isBuffer(x) || x.length !== 64)) return false;
  let index = member.index;
  let value = prefixLeaf(branch,prepared,index,member.message);
  for (let j = 0; j < proof.length; j++) {
    const up = Math.floor(index/2);
    value = index & 1
      ? prefixParent(branch,prepared,j+1,up,proof[j],value)
      : prefixParent(branch,prepared,j+1,up,value,proof[j]);
    index = up;
  }
  return value.equals(branch === 'A' ? state.rootA : state.rootB);
}
function verifyMemberPrefix(token, member) {
  try {
    const cached = cachedPrefixes(token);
    if (!cached || !Number.isSafeInteger(member.index) || member.index < 0 || member.index >= cached.state.N) return false;
    if (!Buffer.isBuffer(member.message) || member.message.length > 1048576) return false;
    const okA = checkPathPrefix('A',cached.state,cached.prepared,member);
    const okB = checkPathPrefix('B',cached.state,cached.prepared,member);
    return okA && okB;
  } catch { return false; }
}
function verifyWholeBatchPrefix(certificate, messages, trustedOwner) {
  try {
    // Identical double signature verification; new prefix setup is INCLUDED in
    // every whole-batch verification, since the certificate token is fresh.
    const token = authenticateCertificate(certificate,trustedOwner);
    const cached = token && cachedPrefixes(token);
    if (!cached || !Array.isArray(messages) || messages.length !== cached.state.N) return false;
    if (messages.some((message) => !Buffer.isBuffer(message) || message.length > 1048576)) return false;
    const rootA = makeTreePrefix('A',cached.prepared,messages).at(-1)[0];
    const rootB = makeTreePrefix('B',cached.prepared,messages).at(-1)[0];
    return rootA.equals(cached.state.rootA) && rootB.equals(cached.state.rootB);
  } catch { return false; }
}

const setupStarted = performance.now();
const keys = {A:crypto.generateKeyPairSync(A),B:crypto.generateKeyPairSync(B)};
const metadata = {chainId:Buffer.alloc(32,0xa7),owner:'ynx-test-owner-001',purpose:'TX-BATCH',
  batchId:Buffer.alloc(16,1),pkA:keys.A.publicKey.export({format:'raw-public'}),
  pkB:keys.B.publicKey.export({format:'raw-public'})};
const messages = Array.from({length:N},(_,i) => {
  const message = Buffer.alloc(1024,0x58);
  message.write('YNX BATCH authorized message',0,'ascii'); message.writeUInt32BE(i,64); return message;
});
const batch = createBatch(keys,metadata,messages);
const members = messages.map((_,i) => extract(batch,i));
const token = authenticateCertificate(batch.certificate,metadata); assert(token);
const prepStarted = performance.now();
const {state,prepared} = cachedPrefixes(token);
const prefixCacheSetupMs = performance.now()-prepStarted;
let exactLeafInputs = 0, exactNodeInputs = 0, exactPathPairs = 0;
for (const branch of ['A','B']) {
  const originalTree = branch === 'A' ? batch.treeA : batch.treeB;
  const optimizedTree = makeTreePrefix(branch,prepared,messages);
  assert.deepEqual(optimizedTree,originalTree); // every node, including both roots
  for (let i = 0; i < N; i++) {
    const originalBytes = enc(`YNX-BATCH/v0.1/LEAF/${branch}`,state.ctx,u32(N),u32(i),messages[i]);
    const continuedBytes = Buffer.concat([prepared[branch].leafPrefix,fields(u32(i),messages[i])]);
    assert(originalBytes.equals(continuedBytes)); exactLeafInputs++;
    assert.deepEqual(makePath(optimizedTree,i),makePath(originalTree,i)); exactPathPairs++;
  }
  for (let level = 1; level < originalTree.length; level++) {
    for (let i = 0; i < originalTree[level].length; i++) {
      const left = originalTree[level-1][2*i],right = originalTree[level-1][2*i+1];
      const originalBytes = enc(`YNX-BATCH/v0.1/NODE/${branch}`,state.ctx,u32(N),u32(level),u32(i),left,right);
      const continuedBytes = Buffer.concat([prepared[branch].nodePrefix,fields(u32(level),u32(i),left,right)]);
      assert(originalBytes.equals(continuedBytes)); exactNodeInputs++;
    }
  }
}
const expected = members.map((member) => ({index:member.index,valid:verifyMember(token,member)}));
assert(expected.every((result) => result.valid));
assert.deepEqual(members.map((member) => ({index:member.index,valid:verifyMemberPrefix(token,member)})),expected);
assert(verifyWholeBatchPrefix(batch.certificate,messages,metadata));
const changed = messages.map((m) => Buffer.from(m)); changed[3][0] ^= 1;
assert.equal(verifyWholeBatchPrefix(batch.certificate,changed,metadata),false);
let bad = cloneMember(members[3]); bad.message[0] ^= 1;
assert.equal(verifyMemberPrefix(token,bad),false);
bad = cloneMember(members[3]); bad.pathA[0][0] ^= 1;
assert.equal(verifyMemberPrefix(token,bad),false);
bad = cloneMember(members[3]); bad.pathB[0][0] ^= 1;
assert.equal(verifyMemberPrefix(token,bad),false);
const setupExcludedMs = performance.now()-setupStarted;

const cases = [
  {name:'original whole128: double certificate + both full trees',run:() => verifyWholeBatch(batch.certificate,messages,metadata),check:assert},
  {name:'prefix-copy whole128: double certificate + both full trees',run:() => verifyWholeBatchPrefix(batch.certificate,messages,metadata),check:assert},
  {name:'original cached-certificate 128 member proofs',run:() => members.map((member) => ({index:member.index,valid:verifyMember(token,member)})),check:(v) => assert.deepEqual(v,expected)},
  {name:'prefix-copy cached-certificate 128 member proofs',run:() => members.map((member) => ({index:member.index,valid:verifyMemberPrefix(token,member)})),check:(v) => assert.deepEqual(v,expected)},
];
for (const item of cases) { item.check(item.run()); item.times = []; }
for (let round = 0; round < 3; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const item = cases[(round+offset)%cases.length];
    const start = performance.now(),result = item.run(); item.times.push(performance.now()-start);
    item.check(result);
  }
}
console.log(JSON.stringify({
  experiment:'YNX-BATCH-v0.1 exact encoded-prefix hash-state copying; same process comparison',
  environment:{node:process.version,openssl:process.versions.openssl,platform:process.platform,
    arch:process.arch,cpu:os.cpus()[0]?.model},
  workload:{N,messageBytes:1024,contextBytes:state.ctx.length,sameMessagesAndCertificateForAllCases:true},
  optimization:{method:'Hash.copy() from SHA3-512 and SHA-512 states after consuming exact Enc prefixes',
    leafPrefix:'u32(5) || field(leafTag) || field(C) || field(u32(N))',
    leafSuffix:'field(u32(index)) || field(fullMessage)',
    nodePrefix:'u32(7) || field(nodeTag) || field(C) || field(u32(N))',
    nodeSuffix:'field(u32(level)) || field(u32(nodeIndex)) || field(left) || field(right)',
    field:'u32(byteLength) || bytes',newHashOrSignatureScheme:false},
  correctness:{allOriginalAndOptimizedTreeNodesBitIdentical:true,bothRootsBitIdentical:true,
    exactLeafEncodedInputsChecked:exactLeafInputs,exactNodeEncodedInputsChecked:exactNodeInputs,
    exactIndividualPathsChecked:exactPathPairs,all128ResultIndexesAndBooleansEqual:true,
    changedFullBatchMessageRejected:true,changedMemberMessageAndEitherPathRejected:true},
  timing:{warmupPerCase:1,samplesPerCase:3,rotatingOrder:true,
    excludedSetupAndCorrectnessMs:Number(setupExcludedMs.toFixed(4)),
    cachedCertificatePrefixSetupMs:Number(prefixCacheSetupMs.toFixed(4)),
    wholeIncludes:'identical dual certificate checks/imports/signature verifies plus full tree reconstruction; optimized case includes fresh prefix preparation',
    membersExclude:'certificate authentication, prefix cache initialization and proof extraction; identical authenticated certificate is already cached',
    measurements:cases.map((item) => ({name:item.name,...summarize(item.times)}))},
  limitations:['Original scheme and hashed bytes are unchanged; this is an implementation optimization, not a new mathematical signature construction.',
    'N=128 only; one owner and one shared batch certificate; small local samples, not Chain TPS.',
    'The original prototype file is preserved; no Chain repository was modified.'],
},null,2));

