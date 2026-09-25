import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { relative,resolve } from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import { verifyEVMReadCandidate } from '../web/verify-evm-read-candidate.mjs';

const candidate = new URL('../evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json', import.meta.url);
const pin = createHash('sha256').update(await readFile(candidate)).digest('hex');
const finalUICandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json';
const finalUIPin = '9568598e9a098b2cfdf7bf6b133db25a28cc4006079f65d25d2349c052cc4286';
const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const historic=new Set(['apps/finance/web/index.html','apps/finance/scripts/finance-nonregressive-runtime.mjs','internal/finance/server.go']);
const sourceRead=async path=>{
  const name=relative(repoRoot,String(path));
  return historic.has(name)?execFileSync('git',['show',`01130b501da5c16fce41c547feabf9b7c10cd3f0:${name}`],{cwd:repoRoot}):readFile(path);
};

test('two independent snapshot builds bind full Wallet/Auth graph and both Finance bundles', async () => {
  const result = await verifyEVMReadCandidate({ pinnedCandidateSha256: pin,read:sourceRead });
  assert.equal(result.status, 'pass');
  assert.equal(result.bundleCount, 2);
  assert.equal(result.publicRuntimeVerified, false);
});

test('candidate pin drift fails before any transitive build', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: '0'.repeat(64) }), /CANDIDATE_TAMPERED/u);
});

test('final UI source candidate rebuilds twice but cannot self-authorize a public runtime', async () => {
  const result = await verifyEVMReadCandidate({candidatePath:finalUICandidatePath,pinnedCandidateSha256:finalUIPin,read:sourceRead});
  assert.equal(result.status,'pass');
  assert.equal(result.bundleCount,2);
  assert.equal(result.publicRuntimeVerified,false);
  await assert.rejects(verifyEVMReadCandidate({candidatePath:'apps/finance/evidence/unreviewed.json',pinnedCandidateSha256:finalUIPin}),/CANDIDATE_PATH_UNREVIEWED/u);
});

test('unlisted Wallet/Auth transitive source change cannot keep a reviewed bundle', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) return Buffer.from('export const tampered = true;');
    return sourceRead(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('locked noble dependency change fails graph binding', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/node_modules/@noble/curves/nist.js')) return Buffer.from('export const tampered = true;');
    return sourceRead(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('missing transitive source fails before a bundle can be accepted', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return sourceRead(path);
  } }), /missing/u);
});
