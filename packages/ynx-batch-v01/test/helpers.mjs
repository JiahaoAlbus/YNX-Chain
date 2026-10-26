import {readFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import * as codec from '../src/codec.mjs';
const require = createRequire(import.meta.url);
export function reference(prefix = false) {
  const filename = prefix ? 'ynx-batch-v01-prefix-prototype.cjs' : 'ynx-batch-v01-prototype.cjs';
  const source = readFileSync(new URL('../reference/' + filename, import.meta.url), 'utf8');
  const expected = prefix ? 'd51f5450a69a8b67049655a996bf1a008e70c5fd1f393011d42f5f99d90b8290' : '32af64e78e8c3da8f18d9a68b6cca888d1d57267f172a4da470050733e6d124a';
  if (createHash('sha256').update(source).digest('hex') !== expected) throw Error('reference hash mismatch');
  const marker = '\nconst setupStarted = performance.now();', at = source.indexOf(marker);
  if (at < 0 || source.indexOf(marker, at + 1) !== -1) throw Error('reference boundary mismatch');
  // Audited function definitions only. Never executes the reference's benchmark.
  return new Function('require', 'Buffer', source.slice(0, at) + '\nreturn {createBatch,extract,makeTree,makePath,verify,verifyWholeBatch,authenticateCertificate,verifyMember' +
    (prefix ? ',prepareHashPrefixes,makeTreePrefix,verifyMemberPrefix' : '') + '};')(require, Buffer);
}
export const refCodec = require('../reference/ynx-batch-v01-codec.cjs');
export function fakeCertificate(N = 128) {
  return {chainId: Buffer.alloc(32, 0xa7), owner: 'ynx-test-owner-001', purpose: 'TX-BATCH',
    batchId: Buffer.alloc(16, 1), pkA: Buffer.alloc(2592, 1), pkB: Buffer.alloc(64, 2), N,
    rootA: Buffer.alloc(64, 3), rootB: Buffer.alloc(64, 4), sigmaA: Buffer.alloc(4627, 5), sigmaB: Buffer.alloc(49856, 6)};
}
export function messages(N, size = 16) {
  return Array.from({length: N}, (_, i) => { const b = Buffer.alloc(size, 88); if (size >= 4) b.writeUInt32BE(i); return b; });
}
export function registration(c, overrides = {}) {
  return {algorithmVersion: codec.VERSION, chainId: Buffer.from(c.chainId), owner: c.owner, purpose: c.purpose,
    pkA: Buffer.from(c.pkA), pkB: Buffer.from(c.pkB), enabled: true, policyRevision: 'TEST-ONLY-1', activeFrom: 3, revokedAt: null, ...overrides};
}
export function metadata() { return {chainId: randomBytes(32), owner: 'ynx-test-owner-001', purpose: 'TX-BATCH'}; }
export function split(b) {
  const a = []; let at = 4;
  for (let i = 0; i < b.readUInt32BE(0); i++) { const n = b.readUInt32BE(at); at += 4; a.push(Buffer.from(b.subarray(at, at + n))); at += n; }
  return a;
}
export function replace(b, indexes, value) {
  const a = split(b), [i, ...rest] = indexes;
  a[i] = rest.length ? replace(a[i], rest, value) : value;
  return codec.encodeFields(a);
}
