import { createInterface } from 'node:readline';
import {
  parseFinanceEvmSubjectChallenge,
  financeEvmSubjectSigningRequest,
  issueFinanceEvmSubjectSession,
  verifyAndConsumeFinanceEvmSubjectRead,
  verifyAndConsumeFinanceEvmSubjectRevoke,
} from '@ynx-chain/wallet-auth';

// Wallet/Auth is the only signature and wire-schema authority. Finance alone
// commits durable state; this pipe cannot report success before its CAS says
// yes. One bounded request is handled per process, with no proof logging.
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

async function commit(operation, proposal) {
  send({ kind: 'commit', operation, proposal });
  const answer = await receive();
  return answer?.approved === true;
}

try {
  const input = await receive();
  if (input?.action === 'create') {
    const challenge = parseFinanceEvmSubjectChallenge(input.challenge);
    send({ kind: 'result', challenge, signingRequest: financeEvmSubjectSigningRequest(challenge) });
  } else if (input?.action === 'issue') {
    const session = await issueFinanceEvmSubjectSession(
      input.proof, input.expectedChallenge, input.issue,
      proposal => commit('issue', proposal), new Date(input.at),
    );
    send({ kind: 'result', session });
  } else if (input?.action === 'read') {
    const authorized = await verifyAndConsumeFinanceEvmSubjectRead(
      input.proof,
      async sessionId => sessionId === input.session?.sessionId ? input.session : null,
      input.request, proposal => commit('read', proposal), new Date(input.at),
    );
    send({ kind: 'result', authorized });
  } else if (input?.action === 'revoke') {
    const revoked = await verifyAndConsumeFinanceEvmSubjectRevoke(
      input.proof,
      async sessionId => sessionId === input.session?.sessionId ? input.session : null,
      input.request, proposal => commit('revoke', proposal), new Date(input.at),
    );
    send({ kind: 'result', revoked });
  } else {
    throw new Error('INVALID_ACTION');
  }
} catch (error) {
  send({ kind: 'error', code: error?.code || 'INVALID_INPUT' });
  process.exitCode = 1;
} finally {
  lines.return?.();
}
