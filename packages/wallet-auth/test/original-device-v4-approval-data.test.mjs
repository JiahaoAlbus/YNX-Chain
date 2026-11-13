import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { inspectOriginalProductSessionV4ApprovalDATA as inspect } from '@ynx-chain/wallet-auth/product-session-pq-v4-codec';
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

test('verifies the signed approval before pair commit evidence exists', () => {
 const result = inspect(fixture.registry, original);
 assert.deepEqual(result.originals, original);
 assert.deepEqual(result.approval, pair.approval);
 assert.deepEqual(result.accountAuthorization, pair.approval.accountAuthorization);
 assert.equal(result.signatureVerified, true);
 assert.equal(result.dataOnly, true);
 assert.equal(result.current, false);
 assert.equal(result.authorized, false);
 assert.equal(result.SourceAdmission, false);
});

test('rejects altered signed bytes, expired approval and executable input', () => {
 const tampered = { ...pair.approval, walletProof: 'AAAA' };
 assert.throws(() => inspect(fixture.registry, {
  ...original, approvalOriginal: fixture.canonical(tampered),
 }));
 assert.throws(() => inspect(fixture.registry, {
  ...original, checkedAtMs: Date.parse(pair.approval.expiresAt),
 }));
 let calls = 0;
 assert.throws(() => inspect(fixture.registry, {
  ...original, get approvalOriginal() { calls++; return original.approvalOriginal; },
 }));
 assert.throws(() => inspect(fixture.registry, new Proxy(original, {
  ownKeys() { calls++; return Reflect.ownKeys(original); },
 })));
 assert.equal(calls, 0);
});
