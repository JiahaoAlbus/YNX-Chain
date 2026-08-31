#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const financeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(financeRoot));
const evidenceRoot = join(financeRoot, 'evidence');
const archive = join(evidenceRoot, 'release-candidates', 'ynx-finance-7d145955a052-linux-amd64.tar.gz');
const carrier = JSON.parse(readFileSync(join(evidenceRoot, 'finance-p0318-build-identity-route-successor-unsigned-carrier-lease-20260831.json'), 'utf8'));
const contract = JSON.parse(readFileSync(join(evidenceRoot, 'finance-p0318-build-identity-route-successor-two-phase-contract-20260831.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const extract = relativePath => {
  const result = spawnSync('tar', ['-xOzf', archive, `ynx-finance-7d145955a052/${relativePath}`]);
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};

assert.equal(carrier.lease.signed, false);
assert.equal(carrier.executionCandidate.executable, false);
assert.equal(carrier.lease.id, contract.phase3.carrierNamespace);
assert.equal(contract.phase3.stageNamespace, `${carrier.lease.id}-deploy`);
assert.equal(contract.phase3.backupNamespace, carrier.lease.id);
assert.equal(contract.phase3.releaseNamespace, carrier.lease.id);
assert.equal(contract.carrierPreparation.archive.bytes, readFileSync(archive).length);
assert.equal(contract.carrierPreparation.archive.sha256, sha(readFileSync(archive)));
assert.equal(carrier.candidate.archive.bytes, contract.carrierPreparation.archive.bytes);
assert.equal(carrier.candidate.archive.sha256, contract.carrierPreparation.archive.sha256);

for (const [url, status, bytes, expectedSha] of contract.candidateVerification.frontend) {
  assert.equal(status, 200);
  const name = url === '/' ? 'web/index.html' : `web/${url.slice(1)}`;
  const body = extract(name);
  assert.equal(body.length, bytes, `${url} bytes`);
  assert.equal(sha(body), expectedSha, `${url} sha256`);
}
const [identityUrl, identityStatus, identityBytes, identitySha] = contract.candidateVerification.buildIdentity;
assert.equal(identityUrl, '/build-identity.json');
assert.equal(identityStatus, 200);
const identity = extract('web/build-identity.json');
assert.equal(identity.length, identityBytes);
assert.equal(sha(identity), identitySha);
assert.deepEqual(JSON.parse(identity), {
  sourceCommit: contract.candidateSource,
  release: 'ynx-finance-7d145955a052',
  buildTime: '2026-08-31T06:00:48.000Z',
  frontendSourceCommit: '75f0299aaf53263e4279acf93e9a06db9d055e38'
});
const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
assert.equal(listing.status, 0, listing.stderr);
assert.equal(listing.stdout.includes('/web/wallet-connect.js\n'), false, 'legacy wallet-connect.js must remain absent');

const serverSource = readFileSync(join(repoRoot, 'internal', 'finance', 'server.go'), 'utf8');
assert.match(serverSource, /HandleFunc\("GET \/build-identity\.json", s\.web\)/);
assert.match(serverSource, /"\/build-identity\.json": "build-identity\.json"/);
const serverTest = readFileSync(join(repoRoot, 'internal', 'finance', 'finance_test.go'), 'utf8');
assert.match(serverTest, /source-bound build identity is not served byte-exact/);

process.stdout.write('finance P0-318 build-identity route successor fixture: pass\n');
