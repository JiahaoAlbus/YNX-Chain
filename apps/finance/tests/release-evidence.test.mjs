import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../', import.meta.url);
const verifier = await readFile(new URL('scripts/verify-p0-release-evidence.mjs', base), 'utf8');
const probe = await readFile(new URL('scripts/probe-accepted-connectivity.mjs', base), 'utf8');

test('release evidence verifier keeps Finance fail-closed and does not assert an installed wallet success', () => {
  for (const marker of [
    "financeProductStatus: manifest.endpointStates.products.finance.status",
    "productSession: 'PENDING_AND_NOT_CALLED'",
    "installedWalletSuccess: 'NOT_ASSERTED_BY_THIS_VERIFIER'",
    "release.releaseStates?.deployedPublic === false",
    "release.releaseStates?.downloadHosted === false",
    "release.artifact?.android?.sha256 === artifact.sha256",
  ]) assert.ok(verifier.includes(marker), marker);
});

test('direct connectivity probe reads only declared manifest health routes and forbids the pending Finance product API', () => {
  assert.ok(probe.includes("manifest.endpointStates.products.finance.status !== 'PENDING'"));
  assert.ok(probe.includes("financeProductApiCalled: false"));
  assert.ok(probe.includes('endpoint.health'));
  for (const forbidden of ['localhost', '127.0.0.1', '10.0.2.2', 'finance.ynxweb4.com']) assert.equal(probe.includes(forbidden), false, forbidden);
});
