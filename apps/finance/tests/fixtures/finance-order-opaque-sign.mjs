import { readFileSync } from 'node:fs';
import {
  createSignedFinanceOrderApproval,
  createSignedFinanceOrderOpaqueClaim,
  createSignedFinanceOrderOpaqueReject,
} from '@ynx-chain/wallet-auth';

// Test-only deterministic key from public Wallet/Auth vectors. Never used by
// the server or a release package.
const vector = JSON.parse(readFileSync(new URL('../../../../packages/wallet-auth/testdata/finance-order-approval-v1.vectors.json', import.meta.url))).positive;
const input = JSON.parse(readFileSync(0, 'utf8'));
const at = new Date(input.at);
let proof;
if (input.action === 'claim') {
  proof = createSignedFinanceOrderOpaqueClaim({ ticket: input.ticket, accountSecret: vector.testOnlyPublicSecretScalarHex,
    nonce: input.nonce, issuedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 60_000).toISOString() });
} else if (input.action === 'approved') {
  proof = createSignedFinanceOrderApproval({ accountSecret: vector.testOnlyPublicSecretScalarHex, approval: input.challenge }, at);
} else if (input.action === 'rejected') {
  proof = createSignedFinanceOrderOpaqueReject({ ticket: input.ticket, challenge: input.challenge }, at, vector.testOnlyPublicSecretScalarHex);
} else {
  throw new Error('test signer action invalid');
}
process.stdout.write(JSON.stringify(proof));
