import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/codec.mjs';
import {createHasher, buildTree, extractPath} from '../src/tree.mjs';
import {refCodec, fakeCertificate, messages, reference, replace, split} from './helpers.mjs';

test('byte-for-byte reference codec and exact N=128 sizes (syntax fixture only)', () => {
  const cert = fakeCertificate(), ms = messages(128, 1024);
  const m = {certificate: cert, index: 127, message: ms[127], pathA: Array.from({length: 7}, () => Buffer.alloc(64, 7)), pathB: Array.from({length: 7}, () => Buffer.alloc(64, 8))};
  for (const [name, args, length] of [
    ['Context', [cert], 2836], ['Descriptor', [cert], 3017], ['Certificate', [cert], 57516],
    ['Proof', [m, 128], 980], ['Whole', [cert, ms], 189140], ['Member', [m], 59561],
  ]) { const b = c['encode' + name](...args); assert.equal(b.length, length); assert.deepEqual(b, refCodec['encode' + name](...args)); }
  assert.equal((c.encodeWhole(cert, ms).length - 131072) / 128, 453.65625);
  assert.equal(c.LIMIT.whole, refCodec.spec.maxWholeWireBytes); assert.equal(c.LIMIT.member, refCodec.spec.maxMemberWireBytes);
  const w = c.encodeMember(m), parsed = c.decodeMember(w); w.fill(0);
  assert.deepEqual(parsed, m); assert.equal(c.encodeFields([]).toString('hex'), '00000000');
});

test('strict nested grammar rejects malformed encodings before crypto', () => {
  const cert = fakeCertificate(), b = c.encodeCertificate(cert), cases = [];
  for (const v of [Buffer.alloc(0), b.subarray(0, -1), Buffer.concat([b, Buffer.of(0)]), Buffer.alloc(65537)]) cases.push(v);
  for (const position of [0, 4]) { const x = Buffer.from(b); x.writeUInt32BE(0xffffffff, position); cases.push(x); }
  for (const [path, value] of [
    [[0, 0], Buffer.from('YNX-BATCH/v0.2/DESCRIPTOR')], [[0, 1, 0], Buffer.from('wrong')],
    [[0, 1, 1], Buffer.from(c.SUITE.replace('87', '65'))], [[0, 1, 2], Buffer.alloc(31)],
    [[0, 1, 3], Buffer.alloc(0)], [[0, 1, 3], Buffer.alloc(129, 65)], [[0, 1, 3], Buffer.from('ownér')],
    [[0, 1, 3], Buffer.from('a\tb')], [[0, 1, 4], Buffer.alloc(2591)], [[0, 1, 5], Buffer.alloc(65)],
    [[0, 1, 6], Buffer.alloc(15)], [[0, 1, 7], Buffer.alloc(65, 65)], [[0, 1, 7], Buffer.of(0)],
    [[0, 2], Buffer.alloc(5)], [[0, 3], Buffer.alloc(63)], [[0, 4], Buffer.alloc(65)],
    [[1], Buffer.alloc(4626)], [[2], Buffer.alloc(49855)],
  ]) cases.push(replace(b, path, value));
  for (const n of [0, 3, 1025, 2048, 0xffffffff]) cases.push(replace(b, [0, 2], c.u32(n)));
  cases.push(c.encodeFields([...split(b), Buffer.alloc(0)]));
  cases.push(replace(b, [0, 1], c.encodeFields(split(c.encodeContext(cert)).slice(1))));
  for (const x of cases) assert.throws(() => c.decodeCertificate(x), c.ProtocolError);
  for (const n of [-1, 1.5, NaN, Infinity, 4294967296]) assert.throws(() => c.u32(n), c.ProtocolError);
  for (const owner of ['', ' ownér', '\n', 'a'.repeat(129)]) assert.throws(() => c.encodeContext({...cert, owner}), c.ProtocolError);
  assert.equal(c.decodeContext(c.encodeContext({...cert, owner: ' Owner '})).owner, ' Owner ');
  assert.throws(() => c.decodeCertificate(Buffer.from(new SharedArrayBuffer(16))), c.ProtocolError);
});

test('N, path, member and Whole resource boundaries', () => {
  for (const N of [1, 2, 1024]) {
    const cert = fakeCertificate(N), d = Math.log2(N), m = {certificate: cert, index: N - 1, message: Buffer.alloc(0), pathA: Array(d).fill(Buffer.alloc(64)), pathB: Array(d).fill(Buffer.alloc(64))};
    assert.deepEqual(c.decodeMember(c.encodeMember(m)), m);
    for (const altered of [{...m, index: N}, {...m, pathA: [...m.pathA, Buffer.alloc(64)]}, {...m, pathB: [Buffer.alloc(63)]}]) assert.throws(() => c.encodeMember(altered));
    const p = c.encodeProof(m, N);
    assert.throws(() => c.decodeProof(replace(p, [0], Buffer.alloc(8)), N));
    assert.throws(() => c.decodeProof(Buffer.concat([p, Buffer.of(0)]), N));
  }
  const cert = fakeCertificate(16), ms = Array.from({length: 16}, (_, i) => Buffer.alloc(i < 8 ? c.LIMIT.message : 0));
  const b = c.encodeWhole(cert, ms); assert.equal(c.validateMessages(c.decodeWhole(b).messages), c.LIMIT.aggregate);
  ms[8] = Buffer.of(0); assert.throws(() => c.encodeWhole(cert, ms));
  assert.throws(() => c.decodeWhole(replace(b, [2], c.encodeFields(ms))));
  ms[0] = Buffer.alloc(c.LIMIT.message + 1); assert.throws(() => c.encodeWhole(cert, ms));
  assert.throws(() => c.decodeWhole(replace(b, [0], Buffer.from(c.VERSION + '/MEMBER'))));
});

test('all legal N: original, optimized and both reference trees / every path agree', () => {
  const ref = reference(true);
  for (let N = 1; N <= 1024; N *= 2) {
    const C = c.encodeContext(fakeCertificate(N)), ms = messages(N);
    const raw = createHasher(C, N, false), fast = createHasher(C, N, true), prep = ref.prepareHashPrefixes(C, N);
    for (const b of ['A', 'B']) {
      const t = buildTree(raw[b], ms), optimized = buildTree(fast[b], ms);
      assert.deepEqual(t, optimized); assert.deepEqual(t, ref.makeTree(b, C, ms)); assert.deepEqual(t, ref.makeTreePrefix(b, prep, ms));
      for (let i = 0; i < N; i++) assert.deepEqual(extractPath(t, i), ref.makePath(optimized, i));
    }
  }
});

test('deterministic parser mutation corpus: canonical success or typed refusal', () => {
  let seed = 0x987123; const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const cert = fakeCertificate(1), member = {certificate: cert, message: Buffer.of(4), index: 0, pathA: [], pathB: []};
  for (const [base, decode, encode] of [
    [c.encodeCertificate(cert), c.decodeCertificate, c.encodeCertificate],
    [c.encodeMember(member), c.decodeMember, c.encodeMember],
    [c.encodeWhole(cert, [member.message]), c.decodeWhole, w => c.encodeWhole(w.certificate, w.messages)],
  ]) for (let i = 0; i < 1000; i++) {
    let b = Buffer.from(base); const mode = rand() % 3;
    if (mode === 0) b = b.subarray(0, rand() % b.length);
    else if (mode === 1) b[rand() % b.length] ^= 1 << (rand() % 8);
    else { const at = rand() % (b.length - 4); b.writeUInt32BE(rand(), at); }
    try { const out = decode(b); assert.deepEqual(encode(out), b); }
    catch (error) { assert.ok(error instanceof c.ProtocolError, error.stack); }
  }
});
