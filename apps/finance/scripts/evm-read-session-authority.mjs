import { createInterface } from 'node:readline';
import {
  createEvmProductSessionChallenge,
  createEvmProductSessionSigningRequest,
  issueEvmProductSession,
  verifyAndConsumeEvmProductSessionHttpProof,
  verifyAndConsumeEvmProductSessionRevokeProof,
} from '@ynx-chain/wallet-auth';

// A single Finance request is handled per process. Wallet/Auth owns every
// cryptographic and wire-schema decision. Its commit callbacks cross this
// narrow pipe to Finance's repository-CAS store; a local `true` stub would
// incorrectly report authorization before the durable mutation completed.
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
const MAX_LINE = 64 * 1024;

async function receive() {
  const next = await lines.next();
  if (next.done || Buffer.byteLength(next.value) > MAX_LINE) throw new Error('INVALID_INPUT');
  return JSON.parse(next.value);
}

function send(value) {
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > MAX_LINE) throw new Error('OUTPUT_TOO_LARGE');
  process.stdout.write(`${raw}\n`);
}

async function commit(kind, proposal) {
  send({ kind: 'commit', operation: kind, proposal });
  const answer = await receive();
  return answer?.approved === true;
}

try {
  const input = await receive();
  if (input?.action === 'create') {
    const challenge = createEvmProductSessionChallenge(input.challenge);
    send({ kind: 'result', challenge, signingRequest: createEvmProductSessionSigningRequest(challenge) });
  } else if (input?.action === 'issue') {
    const session = await issueEvmProductSession(
      input.proof, input.expectedChallenge, input.issue,
      (proposal) => commit('issue', proposal), new Date(input.at),
    );
    send({ kind: 'result', session });
  } else if (input?.action === 'read') {
    const result = await verifyAndConsumeEvmProductSessionHttpProof(
      input.proof,
      async (sessionId) => sessionId === input.session?.sessionId ? input.session : null,
      input.request, input.authority,
      (proposal) => commit('read', proposal), new Date(input.at),
    );
    send({ kind: 'result', authorized: result });
  } else if (input?.action === 'revoke') {
    const result = await verifyAndConsumeEvmProductSessionRevokeProof(
      input.proof,
      async (sessionId) => sessionId === input.session?.sessionId ? input.session : null,
      input.request,
      (proposal) => commit('revoke', proposal), new Date(input.at),
    );
    send({ kind: 'result', revoked: result });
  } else {
    throw new Error('INVALID_ACTION');
  }
} catch (error) {
  // Never echo proof bytes, accounts, signed payloads, private keys or env.
  send({ kind: 'error', code: error?.code || 'INVALID_INPUT' });
  process.exitCode = 1;
} finally {
  lines.return?.();
}
