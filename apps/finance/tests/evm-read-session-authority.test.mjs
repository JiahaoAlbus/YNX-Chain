import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { p256 } from '../../../packages/wallet-auth/node_modules/@noble/curves/nist.js';
import { secp256k1 } from '../../../packages/wallet-auth/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../packages/wallet-auth/node_modules/@noble/hashes/sha3.js';
import { bytesToHex, concatBytes } from '../../../packages/wallet-auth/node_modules/@noble/hashes/utils.js';
import {
  createEvmProductSessionHttpProof, createEvmProductSessionLoginProof,
  createEvmProductSessionRevokeProof, ethereumPersonalMessageDigest,
} from '@ynx-chain/wallet-auth';

const script = new URL('../scripts/evm-read-session-authority.mjs', import.meta.url);
const bundle = new URL('../scripts/evm-read-session-authority.bundle.mjs', import.meta.url);
const walletSecret = new Uint8Array(32).fill(7);
const deviceSecret = new Uint8Array(32).fill(9);
const account = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(walletSecret, false).slice(1)).slice(-20))}`;
const base64url = bytes => Buffer.from(bytes).toString('base64url');
const challengeInput = {
  chainId: 6423, account, productId: 'finance', origin: 'https://finance.ynxweb4.com',
  callback: 'https://finance.ynxweb4.com/wallet-auth/callback', scope: 'finance.account.read',
  deviceId: 'finance-browser-device-000001', deviceAlgorithm: 'p256-sha256',
  deviceKey: base64url(p256.getPublicKey(deviceSecret, true)), nonce: 'finance_login_nonce_0123456789abcdef',
  state: 'finance_login_state_0123456789abcdef', requestId: 'finance-evm-session-000001',
  providerKind: 'metamask', issuedAt: '2026-09-24T06:00:00.000Z', expiresAt: '2026-09-24T06:05:00.000Z',
};

async function authority(input, onCommit) {
  const child = spawn(process.execPath, [fileURLToPath(script)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const done = once(child, 'close');
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify(input)}\n`);
  let result;
  for (;;) {
    const line = await output.next();
    if (line.done) break;
    const event = JSON.parse(line.value);
    if (event.kind === 'commit') {
      child.stdin.write(`${JSON.stringify({ approved: await onCommit?.(event) === true })}\n`);
    } else {
      result = event;
      child.stdin.end();
      break;
    }
  }
  const [exit] = await done;
  assert.equal(stderr, '');
  return { exit, result };
}

test('Finance EVM session authority bundle is byte-reproducible from the Wallet/Auth root', async () => {
  const options = { absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)), entryPoints: [fileURLToPath(script)], bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false };
  const [first, second, frozen] = await Promise.all([build(options), build(options), readFile(bundle)]);
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), Buffer.from(second.outputFiles[0].contents));
  assert.deepEqual(Buffer.from(first.outputFiles[0].contents), frozen);
  assert.equal(frozen.includes(Buffer.from("from '@ynx-chain/wallet-auth'")), false);
});

test('Finance bridge delegates issue, GET proof and POST revoke commits to durable caller', async () => {
  const created = await authority({ action: 'create', challenge: challengeInput });
  assert.equal(created.exit, 0);
  assert.equal(created.result.challenge.account, account);
  assert.equal(created.result.signingRequest.method, 'personal_sign');
  const message = created.result.signingRequest.message;
  const recovered = secp256k1.sign(ethereumPersonalMessageDigest(message), walletSecret, { prehash: false, format: 'recovered' });
  const walletSignature = `0x${bytesToHex(concatBytes(recovered.slice(1), Uint8Array.of(recovered[0] + 27)))}`;
  const proof = createEvmProductSessionLoginProof(created.result.challenge, walletSignature, base64url(deviceSecret));
  const issue = { sessionId: 'finance_session_id_0123456789abcdef', expiresAt: '2026-09-24T06:05:00.000Z' };
  let commits = 0;
  const issued = await authority({ action: 'issue', proof, expectedChallenge: created.result.challenge, issue, at: '2026-09-24T06:00:01.000Z' }, async event => {
    assert.equal(event.operation, 'issue');
    assert.equal(event.proposal.session.account, account);
    commits++;
    return true;
  });
  assert.equal(issued.exit, 0);
  assert.equal(commits, 1);
  const session = issued.result.session;
  const read = { method: 'GET', target: '/api/evm-read/portfolio?view=balances', bodyDigest: '0'.repeat(64), nonce: 'finance_read_nonce_0123456789abcdef', issuedAt: '2026-09-24T06:00:02.000Z', expiresAt: '2026-09-24T06:00:32.000Z' };
  const readProof = createEvmProductSessionHttpProof(session, read, base64url(deviceSecret));
  const request = { origin: challengeInput.origin, method: read.method, target: read.target, bodyDigest: read.bodyDigest, requiredScope: 'finance.account.read', allowedTargets: ['/api/evm-read/portfolio'] };
  const state = { currentAccount: account, currentChainId: 6423, connected: true, revoked: false };
  const verified = await authority({ action: 'read', proof: readProof, session, request, authority: state, at: '2026-09-24T06:00:03.000Z' }, async event => {
    assert.equal(event.operation, 'read');
    assert.equal(event.proposal.nonce, read.nonce);
    return true;
  });
  assert.equal(verified.exit, 0);
  assert.equal(verified.result.authorized.authorized, true);
  const refusedWrite = await authority({ action: 'read', proof: readProof, session, request: { ...request, method: 'POST' }, authority: state, at: '2026-09-24T06:00:03.000Z' });
  assert.equal(refusedWrite.exit, 1);
  assert.equal(refusedWrite.result.code, 'SCOPE_DENIED');
  const refusedNative = await authority({ action: 'read', proof: readProof, session, request: { ...request, allowedTargets: ['/api/overview'] }, authority: state, at: '2026-09-24T06:00:03.000Z' });
  assert.equal(refusedNative.exit, 1);
  assert.equal(refusedNative.result.code, 'ROUTE_DENIED');
  const revokeProof = createEvmProductSessionRevokeProof(session, { bodyDigest: '0'.repeat(64), nonce: 'finance_revoke_nonce_0123456789abcdef', issuedAt: '2026-09-24T06:00:04.000Z', expiresAt: '2026-09-24T06:00:34.000Z' }, base64url(deviceSecret));
  const revoked = await authority({ action: 'revoke', proof: revokeProof, session, request: { origin: challengeInput.origin, method: 'POST', target: '/api/wallet-login/revoke', bodyDigest: '0'.repeat(64) }, at: '2026-09-24T06:00:05.000Z' }, async event => {
    assert.equal(event.operation, 'revoke');
    assert.equal(event.proposal.account, account);
    return true;
  });
  assert.equal(revoked.exit, 0);
  assert.equal(revoked.result.revoked.revoked, true);
});

test('Finance bridge refuses an uncommitted session and never emits signed payloads on stderr', async () => {
  const created = await authority({ action: 'create', challenge: challengeInput });
  const message = created.result.signingRequest.message;
  const signed = secp256k1.sign(ethereumPersonalMessageDigest(message), walletSecret, { prehash: false, format: 'recovered' });
  const proof = createEvmProductSessionLoginProof(created.result.challenge, `0x${bytesToHex(concatBytes(signed.slice(1), Uint8Array.of(signed[0] + 27)))}`, base64url(deviceSecret));
  const rejected = await authority({ action: 'issue', proof, expectedChallenge: created.result.challenge, issue: { sessionId: 'finance_session_id_0123456789abcdef', expiresAt: '2026-09-24T06:05:00.000Z' }, at: '2026-09-24T06:00:01.000Z' }, async () => false);
  assert.equal(rejected.exit, 1);
  assert.equal(rejected.result.code, 'REPLAY_OR_STORE_FAILURE');
});
