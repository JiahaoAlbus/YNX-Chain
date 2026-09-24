import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import {
  createSignedFinanceOrderApproval,
  createSignedFinanceOrderOpaqueClaim,
  createSignedFinanceOrderOpaqueReject,
  createSignedFinanceOrderLegacyRecovery,
  financeOrderOpaqueTicketHash,
} from '@ynx-chain/wallet-auth';

const script = new URL('../scripts/finance-order-opaque-authority.mjs', import.meta.url);
const bundle = new URL('../scripts/finance-order-opaque-authority.bundle.mjs', import.meta.url);
const vector = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json', import.meta.url)))).positive;
const at = '2026-09-19T09:01:00.000Z';
const ticket = 'ticket_0123456789abcdefghijklmnopqrst';
const challenge = vector.unsigned;
const secret = vector.testOnlyPublicSecretScalarHex;

function invoke(input) {
  const child = spawnSync(process.execPath, [fileURLToPath(bundle)], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 128 * 1024 });
  assert.equal(child.stderr, '', 'private order data must never reach stderr');
  assert.ok(child.stdout.length <= 64 * 1024);
  return { status: child.status, output: JSON.parse(child.stdout) };
}

test('Finance opaque verifier is byte-identical to accepted Wallet/Auth package-root source', async () => {
  const options = { absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)),
    entryPoints: [fileURLToPath(script)], bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false };
  const [first, second] = await Promise.all([build(options), build(options)]);
  const frozen = readFileSync(fileURLToPath(bundle));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), frozen);
  assert.equal(frozen.includes(Buffer.from("from '@ynx-chain/wallet-auth'")), false);
});

test('claim verifies only selected account and ticket, never approval or Broker execution', () => {
  const hashed = invoke({ action: 'ticket-hash', ticket, at });
  assert.equal(hashed.status, 0);
  assert.equal(hashed.output.ticketHash, financeOrderOpaqueTicketHash(ticket));
  const proof = createSignedFinanceOrderOpaqueClaim({ ticket, accountSecret: secret,
    nonce: 'claim_nonce_0123456789abcdefghijkl', issuedAt: '2026-09-19T09:00:30.000Z', expiresAt: '2026-09-19T09:01:30.000Z' });
  const expected = { ticket, account: challenge.account, accountPublicKey: challenge.accountPublicKey };
  const valid = invoke({ action: 'claim', proof, expected, at });
  assert.equal(valid.status, 0);
  assert.equal(valid.output.ticketHash, financeOrderOpaqueTicketHash(ticket));
  assert.equal(valid.output.action, 'claim');
  assert.equal(JSON.stringify(valid.output).includes(challenge.brokerAccountId), false);
  const changed = invoke({ action: 'claim', proof, expected: { ...expected, ticket: 'other_0123456789abcdefghijklmnopqrst' }, at });
  assert.notEqual(changed.status, 0);
  assert.equal(changed.output.kind, 'error');
});

test('complete verifies exact approved and rejected proofs against original challenge', () => {
  const approval = createSignedFinanceOrderApproval({ accountSecret: secret, approval: challenge }, new Date(at));
  const approved = invoke({ action: 'complete', ticket, status: 'approved', proof: approval, challenge, at });
  assert.equal(approved.status, 0);
  assert.deepEqual(approved.output, { kind: 'verified', action: 'complete', status: 'approved',
    ticketHash: financeOrderOpaqueTicketHash(ticket), requestId: challenge.requestId });
  const rejectedProof = createSignedFinanceOrderOpaqueReject({ ticket, challenge }, new Date(at), secret);
  const rejected = invoke({ action: 'complete', ticket, status: 'rejected', proof: rejectedProof, challenge, at });
  assert.equal(rejected.status, 0);
  const changed = invoke({ action: 'complete', ticket, status: 'approved', proof: approval,
    challenge: { ...challenge, orderHash: '0'.repeat(64) }, at });
  assert.notEqual(changed.status, 0);
  assert.equal(changed.output.kind, 'error');
});

test('legacy recovery is restricted to trusted pre-cutover challenge and exact proof', () => {
  const proof = createSignedFinanceOrderLegacyRecovery({ challenge, nonce: 'legacy_nonce_0123456789abcdefghijkl' }, new Date(at), secret);
  const accepted = invoke({ action: 'recover-legacy', proof, challenge,
    cutoverAt: '2026-09-19T09:02:00.000Z', at });
  assert.equal(accepted.status, 0);
  assert.equal(accepted.output.requestId, challenge.requestId);
  const afterCutover = invoke({ action: 'recover-legacy', proof, challenge,
    cutoverAt: challenge.issuedAt, at });
  assert.notEqual(afterCutover.status, 0);
  assert.equal(afterCutover.output.code, 'LEGACY_DISABLED');
});
