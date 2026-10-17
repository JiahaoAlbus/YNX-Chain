import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePQNetworkBinding, pqDecodeBase64url, pqBase64url} from '../src/pq-wallet-contract.js';
test('original network/account records reject getters, unknown fields and noncanonical identity', () => {
  const original = {chainId: 'ab'.repeat(32), owner: 'ynx-preserved-address'};
  const snapshot = validatePQNetworkBinding(original);
  original.owner = 'changed';
  assert.equal(snapshot.owner, 'ynx-preserved-address');
  assert(Object.isFrozen(snapshot));
  let invoked = false;
  assert.throws(() => validatePQNetworkBinding({chainId: original.chainId, get owner() { invoked = true; return 'owner'; }}), {code: 'PQ_SCHEMA_INVALID'});
  assert.equal(invoked, false);
  for (const value of [{...original, chainId: 'AB'.repeat(32)}, {...original, owner: 'ynx\naddress'},
    {...original, legacyFallback: true}]) assert.throws(() => validatePQNetworkBinding(value));
});
test('base64url rejects noncanonical pad bits and shared mutable memory', () => {
  assert.deepEqual(pqDecodeBase64url('AA', {exact: 1}), new Uint8Array([0]));
  assert.throws(() => pqDecodeBase64url('AB', {exact: 1}), {code: 'PQ_ENCODING_INVALID'});
  assert.throws(() => pqDecodeBase64url('AA==', {exact: 1}), {code: 'PQ_ENCODING_INVALID'});
  assert.throws(() => pqBase64url(new Uint8Array(new SharedArrayBuffer(1))), {code: 'PQ_BYTES_REQUIRED'});
});
