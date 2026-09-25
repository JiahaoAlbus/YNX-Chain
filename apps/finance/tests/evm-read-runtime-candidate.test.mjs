import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const candidatePath = new URL('../evidence/evm-read-runtime-verifier-candidate-final-ui-01130b50-v4-20260925.json', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function verifyCandidate(read = readFile) {
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
  const pin = await read(new URL('../web/verify-wallet-connect.mjs', import.meta.url), 'utf8');
  assert.match(pin, /REVIEWED_VERIFIER_MANIFEST_SHA256='6611cc1795fb6c44cc1097ffcebc1c440f0441acec92273e8d520bf653068fc2'/u);
  return candidate;
}

test('candidate binds every new Finance runtime input under the separately reviewed pin', async () => {
  await verifyCandidate();
});

test('candidate rejects changed bytes before independent pin review', async () => {
  await assert.rejects(verifyCandidate(async (url, encoding) => {
    if (String(url).endsWith('/evm-read-session.js')) return Buffer.from('tampered');
    return readFile(url, encoding);
  }), /evm-read-session\.js/u);
});
