import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { inspectOriginalProductSessionV4ApprovalDATA } from '../src/product-session-pq-v4-codec.js';
import { productSessionApprovalDigest, productSessionRequestDigest } from '../src/product-session-v2.js';
import { createStoredIssueFixtureContext } from './fixtures/stored-device-v4-issue.fixture.mjs';

const fixture = await createStoredIssueFixtureContext();
after(() => fixture.close());
const { pair, registrationOriginal } = fixture.fixture();
const original = {
  requestOriginal: fixture.canonical(pair.request),
  approvalOriginal: fixture.canonical(pair.approval),
  registrationOriginal,
  checkedAtMs: 2000,
};
const raw = fixture.canonical(original);
const realm = vm.createContext({});
vm.runInContext(`
  if (typeof Buffer !== 'undefined' || typeof TextEncoder !== 'undefined' ||
      typeof URL !== 'undefined') throw Error('Unexpected host global');
  String.prototype.isWellFormed = undefined;
  Date.now = () => { throw Error('Unexpected clock') };
`, realm);
let coreCalls = 0;
realm.core = () => { coreCalls++; throw Error('Unexpected Source proof'); };
const factory = vm.runInContext(readFileSync(process.env.YNX_PENDING_BUNDLE, 'utf8'), realm);
const collect = factory(vm.runInContext(`Object.freeze({
  verifySourceStatementV2() { return core() },
  verifyRegisteredSourceCurrentN1V1() { return core() },
})`, realm));
const inspect = collect.inspectOriginalProductSessionV4ApprovalDATA;

test('actual fixed bundle and Node verify the same signed original and digests', () => {
  const result = inspect(raw);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), inspectOriginalProductSessionV4ApprovalDATA(fixture.registry, original));
  assert.equal(result.requestDigest, productSessionRequestDigest(fixture.registry, pair.request, new Date(pair.approval.issuedAt)));
  assert.equal(result.approvalDigest, productSessionApprovalDigest(pair.approval));
  assert.equal(result.signatureVerified, true);
  assert.equal(result.dataOnly, true);
  for (const field of ['authorized', 'registered', 'current', 'SourceAdmission', 'RootAdmission', 'NativeAdmission']) {
    assert.equal(result[field], false);
  }
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.originals));
  assert.deepEqual(Object.getOwnPropertyDescriptor(collect, 'inspectOriginalProductSessionV4ApprovalDATA'), {
    value: inspect, configurable: false, enumerable: false, writable: false,
  });
  assert.equal(coreCalls, 0);
});

test('rejects damaged N1, substituted request and the exact expiration boundary', () => {
  const signed = Buffer.from(pair.approval.walletProof, 'base64url');
  signed[signed.length - 1] ^= 1;
  for (const patch of [
    { approvalOriginal: fixture.canonical({ ...pair.approval, walletProof: signed.toString('base64url') }) },
    { requestOriginal: fixture.canonical({ ...pair.request, purpose: 'PUBLIC different request' }) },
    { checkedAtMs: Date.parse(pair.approval.expiresAt) },
    { checkedAtMs: Date.parse(pair.approval.issuedAt) - 1 },
  ]) {
    assert.throws(() => inspect(fixture.canonical({ ...original, ...patch })));
  }
  assert.equal(coreCalls, 0);
});

test('canonical primitive boundary rejects executable input and altered raw JSON', () => {
  let traps = 0;
  assert.throws(() => inspect(new Proxy(original, { ownKeys() { traps++; throw Error('unexpected trap'); } })));
  assert.throws(() => inspect(raw, undefined));
  for (const bad of [
    raw + '\n', '\ufeff' + raw, raw.replace('"checkedAtMs":2000', '"checkedAtMs":2000,"checkedAtMs":2000'),
    fixture.canonical({ ...original, policyRef: null }),
    fixture.canonical({ ...original, checkedAtMs: '2000' }),
    fixture.canonical({ ...original, requestOriginal: original.requestOriginal + ' ' }),
    fixture.canonical({ ...original, requestOriginal: '{"bad":"\\ud800"}' }),
    'x'.repeat(459_010),
  ]) {
    assert.throws(() => inspect(bad));
  }
  assert.equal(traps, 0);
  assert.equal(coreCalls, 0);
});
