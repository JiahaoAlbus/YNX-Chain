import { readFileSync } from 'node:fs';
import {
  createFinanceOrderOpaqueCompleteRequest,
  financeOrderOpaqueTicketHash,
  verifyFinanceOrderOpaqueClaim,
  verifySignedFinanceOrderLegacyRecovery,
} from '@ynx-chain/wallet-auth';

// This is only a Finance-to-Wallet/Auth verification bridge. It never mints a
// ticket, consumes a nonce, stores a decision, grants Broker execution, or
// logs a proof. The Finance repository must commit each transition with CAS.
const LIMIT = 64 * 1024;
function respond(value) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > LIMIT) throw new Error('OUTPUT_TOO_LARGE');
  process.stdout.write(`${encoded}\n`);
}

try {
  const bytes = readFileSync(0);
  if (bytes.length === 0 || bytes.length > LIMIT) throw new Error('INVALID_INPUT');
  const input = JSON.parse(bytes.toString('utf8'));
  const at = new Date(input.at);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== input.at) throw new Error('INVALID_TIME');
  if (input.action === 'claim') {
    const verified = verifyFinanceOrderOpaqueClaim(input.proof, input.expected, at);
    respond({ kind: 'verified', action: 'claim', ...verified });
  } else if (input.action === 'complete') {
    const request = createFinanceOrderOpaqueCompleteRequest(input.ticket, input.status, input.proof, input.challenge, at);
    respond({ kind: 'verified', action: 'complete', status: request.status,
      ticketHash: financeOrderOpaqueTicketHash(request.ticket), requestId: input.challenge.requestId });
  } else if (input.action === 'recover-legacy') {
    const cutoverAt = new Date(input.cutoverAt);
    if (!Number.isFinite(cutoverAt.getTime()) || cutoverAt.toISOString() !== input.cutoverAt) throw new Error('INVALID_TIME');
    const verified = verifySignedFinanceOrderLegacyRecovery(input.proof, input.challenge, cutoverAt, at);
    respond({ kind: 'verified', action: 'recover-legacy', ...verified });
  } else {
    throw new Error('INVALID_ACTION');
  }
} catch (error) {
  respond({ kind: 'error', code: error?.code || 'INVALID_INPUT' });
  process.exitCode = 1;
}
