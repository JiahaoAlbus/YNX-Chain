import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyEVMReadCandidate } from '../web/verify-evm-read-candidate.mjs';

const candidate = new URL('../evidence/evm-read-runtime-verifier-candidate-pr199-v2-20260925.json', import.meta.url);
const pin = createHash('sha256').update(await readFile(candidate)).digest('hex');
const finalUICandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-c5ba9b57-20260925.json';
const finalUIPin = '6f91e7e83b2cd44e3d671acaccbbf4dd1b382021d2b07846d3e1043dd2f27280';

test('two independent snapshot builds bind full Wallet/Auth graph and both Finance bundles', async () => {
  const result = await verifyEVMReadCandidate({ pinnedCandidateSha256: pin });
  assert.equal(result.status, 'pass');
  assert.equal(result.bundleCount, 2);
  assert.equal(result.publicRuntimeVerified, false);
});

test('candidate pin drift fails before any transitive build', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: '0'.repeat(64) }), /CANDIDATE_TAMPERED/u);
});

test('final UI source candidate rebuilds twice but cannot self-authorize a public runtime', async () => {
  const result = await verifyEVMReadCandidate({candidatePath:finalUICandidatePath,pinnedCandidateSha256:finalUIPin});
  assert.equal(result.status,'pass');
  assert.equal(result.bundleCount,2);
  assert.equal(result.publicRuntimeVerified,false);
  await assert.rejects(verifyEVMReadCandidate({candidatePath:'apps/finance/evidence/unreviewed.json',pinnedCandidateSha256:finalUIPin}),/CANDIDATE_PATH_UNREVIEWED/u);
});

test('unlisted Wallet/Auth transitive source change cannot keep a reviewed bundle', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) return Buffer.from('export const tampered = true;');
    return readFile(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('locked noble dependency change fails graph binding', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/node_modules/@noble/curves/nist.js')) return Buffer.from('export const tampered = true;');
    return readFile(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('missing transitive source fails before a bundle can be accepted', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return readFile(path);
  } }), /missing/u);
});
