import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import { verifyEVMReadCandidate } from '../web/verify-evm-read-candidate.mjs';

const candidate = new URL('../evidence/evm-read-runtime-verifier-candidate-authority-history-25c6dea55-20261001.json', import.meta.url);
const pin = createHash('sha256').update(await readFile(candidate)).digest('hex');
const currentCandidatePath = 'apps/finance/evidence/evm-read-runtime-verifier-candidate-authority-history-25c6dea55-20261001.json';
const currentPin = '90f25d9c558f5cf82a263911f4f1086b8e01482882cd71c93108941e345e8818';
const repoRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const guoqingPath='apps/finance/evidence/evm-read-runtime-verifier-candidate-authority-history-25c6dea55-20261001.json';
const guoqingPin='90f25d9c558f5cf82a263911f4f1086b8e01482882cd71c93108941e345e8818';

test('Guoqing account-session checkpoint verifies both bundles and all three versioned app assets',async()=>{
  const result=await verifyEVMReadCandidate({candidatePath:guoqingPath,pinnedCandidateSha256:guoqingPin});
  assert.equal(result.status,'pass');
  assert.equal(result.bundleCount,3);
  assert.equal(result.publicRuntimeVerified,false);
  await assert.rejects(verifyEVMReadCandidate({candidatePath:guoqingPath,pinnedCandidateSha256:guoqingPin,read:path=>String(path).endsWith('/apps/finance/web/app.js')?Buffer.from('tampered'):readFile(path)}),/INPUT_TAMPERED/u);
});
test('two independent snapshot builds bind full Wallet/Auth graph and both Finance bundles', async () => {
  const result = await verifyEVMReadCandidate({ candidatePath:currentCandidatePath,pinnedCandidateSha256: pin });
  assert.equal(result.status, 'pass');
  assert.equal(result.bundleCount, 3);
  assert.equal(result.publicRuntimeVerified, false);
});

test('candidate pin drift fails before any transitive build', async () => {
  await assert.rejects(verifyEVMReadCandidate({ pinnedCandidateSha256: '0'.repeat(64) }), /CANDIDATE_TAMPERED/u);
});

test('current source candidate rebuilds twice but cannot self-authorize a public runtime', async () => {
  const result = await verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:currentPin});
  assert.equal(result.status,'pass');
  assert.equal(result.bundleCount,3);
  assert.equal(result.publicRuntimeVerified,false);
  await assert.rejects(verifyEVMReadCandidate({candidatePath:'apps/finance/evidence/unreviewed.json',pinnedCandidateSha256:currentPin}),/CANDIDATE_PATH_UNREVIEWED/u);
});

test('unlisted Wallet/Auth transitive source change cannot keep a reviewed bundle', async () => {
  await assert.rejects(verifyEVMReadCandidate({ candidatePath:currentCandidatePath,pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) return Buffer.from('export const tampered = true;');
    return readFile(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('locked noble dependency change fails graph binding', async () => {
  await assert.rejects(verifyEVMReadCandidate({ candidatePath:currentCandidatePath,pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/node_modules/@noble/curves/nist.js')) return Buffer.from('export const tampered = true;');
    return readFile(path);
  } }), /TRANSITIVE_GRAPH_DRIFT/u);
});

test('central Pair QR dependency bytes are pinned independently of the unchanged EVM graph',async()=>{
  await assert.rejects(verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:pin,read:async path=>{
    if(String(path).endsWith('/packages/wallet-auth/node_modules/qrcode/lib/renderer/canvas.js'))return Buffer.from('export const altered=true;');
    return readFile(path);
  }}),/CENTRAL_PAIR_GRAPH_DRIFT/u);
});

test('central Pair original locked SDK bytes cannot be replaced by a fixture transport',async()=>{
  await assert.rejects(verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:pin,read:async path=>{
    if(String(path).endsWith('/packages/wallet-auth/node_modules/@walletconnect/sign-client/dist/index.js'))return Buffer.from('export default {init(){}};');
    return readFile(path);
  }}),/CENTRAL_PAIR_GRAPH_DRIFT/u);
});

test('accepted Hosted adapter bytes cannot change under the reviewed central bundle',async()=>{
  await assert.rejects(verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:pin,read:async path=>{
    if(String(path).endsWith('/packages/wallet-auth/src/vendor/hosted-wallet-adapter-39c063da.js'))return Buffer.from('export const altered=true;');
    return readFile(path);
  }}),/INPUT_TAMPERED/u);
});

test('typed Hosted native adapter cannot change under the reviewed Wallet and central graph',async()=>{
  await assert.rejects(verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:pin,read:async path=>{
    if(String(path).endsWith('/packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js'))return Buffer.from('export const altered=true;');
    return readFile(path);
  }}),/INPUT_TAMPERED/u);
});

test('missing transitive source fails before a bundle can be accepted', async () => {
  await assert.rejects(verifyEVMReadCandidate({ candidatePath:currentCandidatePath,pinnedCandidateSha256: pin, read: async path => {
    if (String(path).endsWith('/packages/wallet-auth/src/application-action.js')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return readFile(path);
  } }), /missing/u);
});

test('previous final-UI candidate remains immutable historical evidence',async()=>{
  const historical=await readFile(new URL('../evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json',import.meta.url));
  assert.equal(createHash('sha256').update(historical).digest('hex'),'9568598e9a098b2cfdf7bf6b133db25a28cc4006079f65d25d2349c052cc4286');
  const manifest=JSON.parse(historical);
  for(const path of ['apps/finance/web/index.html','apps/finance/scripts/finance-nonregressive-runtime.mjs','internal/finance/server.go']){
    const frozen=execFileSync('git',['show',`01130b501da5c16fce41c547feabf9b7c10cd3f0:${path}`],{cwd:repoRoot});
    const entry=manifest.exactInputs.find(value=>value.path===path);
    assert.equal(frozen.length,entry.bytes);
    assert.equal(createHash('sha256').update(frozen).digest('hex'),entry.sha256);
  }
});

test('Hosted resume source inputs cannot change under the reviewed central browser bundle',async()=>{
  for(const path of ['apps/wallet-web/src/extension-chain-params.js','apps/wallet-web/src/hosted-adapter.js','apps/wallet-web/src/hosted-protocol.js','apps/wallet-web/vendor/product-session-registry-123016847.json']){
    await assert.rejects(verifyEVMReadCandidate({candidatePath:currentCandidatePath,pinnedCandidateSha256:pin,read:async requested=>{
      if(String(requested).endsWith('/'+path))return Buffer.from('unreviewed hosted input');
      return readFile(requested);
    }}),/CENTRAL_PAIR_GRAPH_DRIFT/u,path);
  }
});
