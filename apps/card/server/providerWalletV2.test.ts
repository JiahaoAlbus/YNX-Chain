import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  cardApplicationApprovalId,
  cardApplicationApprovalRequestDigest,
  cardProviderDetailsHash,
  cardProviderRequestBindingHash,
  createCardApplicationApprovalRequest,
  parseCardApplicationApprovalRequest,
  parseCardApplicationApprovalReturnURL,
  verifySignedCardApplicationApproval,
  type CardApplicationApprovalRequest,
  type CardProviderChallenge,
  type CardProviderDetails,
} from '@ynx-chain/wallet-auth-card-provider-v2';

const registry = JSON.parse(readFileSync(resolve(__dirname, '../vendor/product-session-registry-09e36b150.json'), 'utf8')) as unknown;
const vector = JSON.parse(readFileSync(resolve(__dirname, '../testdata/card-provider-v2-test-vector.json'), 'utf8')) as {
  request: CardApplicationApprovalRequest & { challenge: CardProviderChallenge; details: CardProviderDetails };
  requestDigest: string;
  providerDetailsHash: string;
  requestBindingHash: string;
  approval: unknown;
  approvalId: string;
  resultURL: string;
};
const at = new Date('2026-09-25T12:00:02.000Z');

test('Card pins Wallet v2 provider request to exact accepted synthetic vector', () => {
  assert.equal(cardProviderDetailsHash(vector.request.details), vector.providerDetailsHash);
  assert.equal(cardProviderRequestBindingHash(vector.request), vector.requestBindingHash);
  assert.deepEqual(parseCardApplicationApprovalRequest(registry, vector.request, at), vector.request);
  assert.equal(cardApplicationApprovalRequestDigest(vector.request), vector.requestDigest);

  const rebuilt = createCardApplicationApprovalRequest(registry, {
    productId: 'card',
    platform: vector.request.platform,
    account: vector.request.account,
    challenge: vector.request.challenge,
    details: vector.request.details,
    requestId: vector.request.requestId,
    state: vector.request.state,
  }, new Date(vector.request.issuedAt));
  assert.deepEqual(rebuilt, vector.request);
});

test('Card accepts only exact signed provider approval and request-bound callback', () => {
  assert.equal(cardApplicationApprovalId(vector.approval), vector.approvalId);
  assert.deepEqual(verifySignedCardApplicationApproval(vector.approval, {
    challenge: vector.request.challenge,
    details: vector.request.details,
    account: vector.request.account,
  }, at), vector.approval);
  const result = parseCardApplicationApprovalReturnURL(registry, vector.resultURL, vector.request, at);
  assert.equal(result.status, 'approved');
  assert.equal(result.requestDigest, vector.requestDigest);
  assert.equal(result.state, vector.request.state);
});

test('Card v2 approval cannot be replayed across provider, fee or owner', () => {
  for (const details of [
    { ...vector.request.details, provider: 'other_provider' },
    { ...vector.request.details, feeDisclosureText: 'A different fee.' },
    { ...vector.request.details, principalOwner: 'ynx1foreign' },
  ]) {
    assert.throws(() => verifySignedCardApplicationApproval(vector.approval, {
      challenge: vector.request.challenge,
      details,
      account: vector.request.account,
    }, at));
  }
  assert.throws(() => parseCardApplicationApprovalReturnURL(registry, vector.resultURL, {
    ...vector.request,
    state: 'different-state',
  }, at));
});
