import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJSON } from '../src/canonical.js';
import { originalV4PrivateVerificationDATA as math } from '../src/product-session-pq-v4-verification-private.mjs';
import { productSessionApprovalDigest } from '../src/product-session-v2.js';
import { registrationPUBLICFixture } from './fixtures/device-v4-registration-portable.PUBLIC.mjs';

test('fixed Wallet plan attaches only an account Member for the exact retained E5', () => {
 const f = registrationPUBLICFixture();
 try {
  const original = new TextEncoder().encode(f.registrationOriginal);
  const args = [f.registry, f.request, { account: f.identity.account, expiresAt: f.approval.expiresAt }, f.policy, original, f.at];
  const plan = math.prepareOriginalProductSessionV4NativeApprovalPlan(...args);
  const read = () => math.readOriginalProductSessionV4NativeApprovalPlanDATA(plan, f.at);
  const first = read();
  first.message.fill(0);
  const retained = read();
  assert.notDeepEqual(first.message, retained.message);
  const proof = f.sign(0, retained.purpose, Buffer.from(retained.message));
  const expected = { ...f.approval, walletProof: Buffer.from(proof).toString("base64url") };
  const result = math.attachOriginalProductSessionV4NativeApprovalMemberDATA(plan, proof, f.at);
  assert.equal(result.approvalOriginal, canonicalJSON(expected));
  assert.equal(result.requestDigest, f.approval.requestDigest);
  assert.equal(result.approvalDigest, productSessionApprovalDigest(expected));
  assert.equal(result.authorized, false);
  assert.equal(result.SourceAdmission, false);
  assert.equal(result.NativeAdmission, false);
  assert.throws(() => math.attachOriginalProductSessionV4NativeApprovalMemberDATA(plan, f.sign(1, retained.purpose, Buffer.from(retained.message)), f.at));
  assert.throws(() => math.attachOriginalProductSessionV4NativeApprovalMemberDATA(plan, f.sign(0, retained.purpose, Buffer.from(first.message)), f.at));
  assert.throws(() => math.attachOriginalProductSessionV4NativeApprovalMemberDATA(plan, proof, new Date(f.approval.expiresAt)));
  assert.throws(() => math.readOriginalProductSessionV4NativeApprovalPlanDATA({}, f.at));
 } finally { f.close(); }
});
