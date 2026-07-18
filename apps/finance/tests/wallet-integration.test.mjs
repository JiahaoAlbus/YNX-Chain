import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root=new URL('../integration/wallet-auth/',import.meta.url);
const registry=JSON.parse(readFileSync(new URL('registry-entry.json',root),'utf8'));
const vector=JSON.parse(readFileSync(new URL('test-vector.json',root),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('integration-manifest.json',root),'utf8'));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

test('Finance registry is the exact central Wallet Auth v2 shape',()=>{
  assert.deepEqual(Object.keys(registry).sort(),['bundleId','callbacks','maxScopes','productClientId','productDeviceAlgorithms','requestingProduct','schemaVersion','scopes'].sort());
  assert.equal(registry.schemaVersion,2);
  assert.equal(registry.productClientId,'ynx-finance-v1');
  assert.deepEqual(registry.callbacks,['ynxfinance://wallet-auth/callback']);
  assert.deepEqual(registry.scopes,[...registry.scopes].sort());
  assert.deepEqual(registry.productDeviceAlgorithms,['p256-sha256']);
  assert.deepEqual(vector.registryEntry,registry);
});

test('Finance request digest matches the canonical cross-product test vector',()=>{
  const digest=createHash('sha256').update(`YNX_WALLET_AUTH_REQUEST_V1\n${canonical(vector.request)}`).digest('hex');
  assert.equal(digest,vector.requestDigest);
  assert.equal(vector.approval.requestDigest,digest);
  assert.equal(vector.completion.challenge.requestDigest,digest);
  assert.equal(vector.session.requestDigest,digest);
  assert.equal(vector.session.verifierVersion,'wallet-auth-v1');
});

test('central status remains false until registry merge, deployment and installed approval pass',()=>{
  assert.equal(manifest.centralIntegration.registryMerged,false);
  assert.equal(manifest.centralIntegration.gatewayDeployed,false);
  assert.equal(manifest.centralIntegration.walletApprovalTestedOnInstalledBuild,false);
});
