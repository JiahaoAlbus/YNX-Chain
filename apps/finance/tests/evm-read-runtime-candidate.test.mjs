import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const candidatePath = new URL('../evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const historic = new Set(['apps/finance/web/index.html','apps/finance/scripts/finance-nonregressive-runtime.mjs','internal/finance/server.go']);
const candidateSource = '01130b501da5c16fce41c547feabf9b7c10cd3f0';
const sourceFile = async (path, encoding) => {
  const name = path instanceof URL ? fileURLToPath(path).slice(root.length+1) : String(path);
  if (historic.has(name)) return execFileSync('git',['show',`${candidateSource}:${name}`],{cwd:root});
  return readFile(path,encoding);
};

async function verifyCandidate(read = sourceFile) {
  const candidate = JSON.parse(await read(candidatePath, 'utf8'));
  assert.equal(candidate.schemaVersion, 'ynx.finance.evm-read-runtime-verifier-candidate.v1');
  assert.equal(candidate.status, 'INDEPENDENT_REVIEW_REQUIRED_NOT_PINNED_NOT_PUBLIC');
  assert.equal(candidate.existingVerifierPin.pinChanged, false);
  assert.equal(candidate.truth.deployedPublic, false);
  assert.equal(candidate.truth.realWalletApproval, false);
  assert.equal(candidate.truth.privateFinanceAuthorized, false);
  assert.equal(candidate.sourceBundleRelations.length, 2);
  const paths = candidate.exactInputs.map(input => input.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.includes(candidate.sourceBundleRelations[0].entry), true);
  assert.equal(paths.includes(candidate.sourceBundleRelations[0].bundle), true);
  assert.equal(paths.includes(candidate.sourceBundleRelations[1].entry), true);
  assert.equal(paths.includes(candidate.sourceBundleRelations[1].bundle), true);
  const files = new Map();
  for (const input of candidate.exactInputs) {
    assert.match(input.path, /^(apps\/finance\/|internal\/finance\/(?:server|drain)\.go$|packages\/wallet-auth\/)/u);
    assert.equal(input.path.includes('..'), false);
    const bytes = await read(new URL(input.path, `file://${root}/`));
    assert.equal(bytes.byteLength, input.bytes, input.path);
    assert.equal(sha256(bytes), input.sha256, input.path);
    files.set(input.path, bytes.toString('utf8'));
  }
  for (const relation of candidate.sourceBundleRelations) {
    assert.equal(candidate.exactInputs.find(input => input.path === relation.bundle).sha256, relation.bundleSha256);
    assert.equal(candidate.exactInputs.find(input => input.path === relation.bundle).bytes, relation.bundleBytes);
    assert.equal(relation.independentRebuilds, 2);
    assert.equal(relation.cleanExtractionBuilds, 0);
  }
  assert.match(files.get('apps/finance/web/index.html'), /<script src="\/evm-read-session\.js" defer><\/script>/u);
  assert.match(files.get('apps/finance/scripts/finance-nonregressive-runtime.mjs'), /'evm-read-session\.js'/u);
  assert.match(files.get('internal/finance/server.go'), /GET \/evm-read-session\.js/u);
  assert.match(files.get('internal/finance/drain.go'), /"\/evm-read-session\.js"/u);
  const pin = await readFile(new URL('../web/verify-wallet-connect.mjs', import.meta.url), 'utf8');
  assert.match(pin, /REVIEWED_VERIFIER_MANIFEST_SHA256='462ae0743b1bb7ea641ff5be28de9a1bd4df0cd145ae5c7b669418ed02112865'/u);
  return candidate;
}

test('candidate binds every new Finance runtime input under the separately reviewed pin', async () => {
  await verifyCandidate();
});

test('candidate rejects changed bytes before independent pin review', async () => {
  await assert.rejects(verifyCandidate(async (url, encoding) => {
    if (String(url).endsWith('/evm-read-session.js')) return Buffer.from('tampered');
    return sourceFile(url, encoding);
  }), /evm-read-session\.js/u);
});
