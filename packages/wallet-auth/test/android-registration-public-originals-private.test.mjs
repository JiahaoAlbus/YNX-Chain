import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { canonicalJSON } from '../src/canonical.js';
import { ynxAddressFromEVM } from '../src/crypto.js';
import { createOriginalDeviceCreateIntentDATA } from '../src/original-device-create-intent-data-core.js';
import { createOriginalDeviceRegistrationPublicOriginalsDATA } from '../src/original-device-registration-public-originals.mjs';
import { createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA } from '../src/original-device-registration-public-originals-core.mjs';
import { productPlatformBinding } from '../src/product-session-registry.js';
import registry from '../product-session-registry.json' with { type: 'json' };

const realm = vm.createContext({});
const factory = vm.runInContext(readFileSync(process.env.YNX_PENDING_BUNDLE, 'utf8'), realm);
vm.runInContext(`
  if (typeof Buffer !== 'undefined' || typeof TextEncoder !== 'undefined' ||
      typeof URL !== 'undefined') throw Error('Unexpected host global');
  Date.now = Math.random = () => { throw Error('Unexpected clock or random') };
`, realm);
let coreCalls = 0;
realm.core = () => { coreCalls++; throw Error('Unexpected Core proof'); };
const collect = factory(vm.runInContext(`Object.freeze({
  verifySourceStatementV2() { return core() },
  verifyRegisteredSourceCurrentN1V1() { return core() },
})`, realm));
const makeAllocation = collect.createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA;
const makeOriginals = collect.createOriginalDeviceRegistrationPublicOriginalsDATA;
const owner = '0x' + '11'.repeat(20);
const binding = productPlatformBinding(registry, 'developer', 'android');
const creationOperationId = '11'.repeat(32);
const mainDeviceOperationId = '22'.repeat(32);
const { approvedTerms: creationIntentOriginal } = createOriginalDeviceCreateIntentDATA({
  ...Object.fromEntries(['productId', 'clientId', 'platform', 'applicationId', 'bundleId',
    'packageId', 'origin', 'callback'].map(key => [key, binding[key]])),
  networkId: 'aa'.repeat(32),
  canonicalOwner: owner,
  account: ynxAddressFromEVM(owner),
  deviceId: 'PUBLIC-original-registration',
  generation: '3',
  operationId: creationOperationId,
  nonce: 'ab'.repeat(32),
  issuedAt: new Date(0).toISOString(),
  expiresAt: new Date(30_000).toISOString(),
});
const seed = {
  creationIntentOriginal,
  allocationSeedHex: '33'.repeat(112),
  allocatedAtMs: '1000',
  mainDeviceOperationId,
};
const seedOriginal = canonicalJSON(seed);
const cloneDATA = value => JSON.parse(JSON.stringify(value));

test('same private collector retains immutable DATA methods', () => {
  assert.equal(typeof collect, 'function');
  assert.ok(Object.isFrozen(collect));
  assert.equal(typeof collect.inspectOriginalDeviceCreationIdentityDATA, 'function');
  for (const [name, method] of [
    ['createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA', makeAllocation],
    ['createOriginalDeviceRegistrationPublicOriginalsDATA', makeOriginals],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(collect, name);
    assert.equal(descriptor.value, method);
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.configurable, false);
  }
});

test('canonical seed produces the original allocation with three distinct IDs', () => {
  const result = makeAllocation(seedOriginal);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(cloneDATA(result), createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA(seedOriginal));
  assert.equal(result.creationOperationId, creationOperationId);
  assert.equal(result.mainDeviceOperationId, mainDeviceOperationId);
  assert.equal(result.operationId, '33'.repeat(32));
  const allocation = JSON.parse(result.allocationOriginal);
  assert.equal(allocation.registrationId, '33333333-3333-4333-b333-333333333333');
  assert.deepEqual(allocation.scopes, ['account:read']);
  assert.equal(allocation.purpose, 'Register this original app device');
  assert.equal(result.userApproved, false);
  assert.equal(result.SourceAdmission, false);
  assert.equal(result.NativeAdmission, false);
  assert.equal(coreCalls, 0);
});

test('four original operands produce exact Auth registration and request bytes', () => {
  const { allocationOriginal } = makeAllocation(seedOriginal);
  const pkA = new Uint8Array(2592).fill(0x11);
  const pkB = new Uint8Array(64).fill(0x22);
  const result = makeOriginals(creationIntentOriginal, pkA.buffer, pkB.buffer, allocationOriginal);
  pkA.fill(0);
  pkB.fill(0);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(cloneDATA(result), createOriginalDeviceRegistrationPublicOriginalsDATA({
    creationIntentOriginal, allocationOriginal,
    publicPair: { pkA: '11'.repeat(2592), pkB: '22'.repeat(64) },
  }));
  const request = JSON.parse(result.requestOriginal);
  assert.deepEqual(request.scopes, ['account:read']);
  assert.equal(request.deviceRegistrationDigest, result.registrationDigest);
  assert.equal(Object.hasOwn(request, 'approvalDigest'), false);
  assert.equal(result.registered, false);
  assert.equal(result.userApproved, false);
  assert.equal(result.SourceAdmission, false);
  assert.equal(result.NativeAdmission, false);
  assert.equal(coreCalls, 0);
});

test('invalid buffers and extra operands fail without invoking Proxy traps', () => {
  const { allocationOriginal } = makeAllocation(seedOriginal);
  const pkA = new ArrayBuffer(2592);
  const pkB = new ArrayBuffer(64);
  const detached = new ArrayBuffer(2592);
  structuredClone(detached, { transfer: [detached] });
  let traps = 0;
  const proxy = new Proxy(pkA, {
    get() { traps++; throw Error('unexpected get'); },
    getPrototypeOf() { traps++; throw Error('unexpected getPrototypeOf'); },
  });
  for (const value of [proxy, detached, new SharedArrayBuffer(2592), new ArrayBuffer(2591), new Uint8Array(pkA)]) {
    assert.throws(() => makeOriginals(creationIntentOriginal, value, pkB, allocationOriginal), {
      code: 'DEVICE_REGISTRATION_PUBLIC_ORIGINALS_ARGUMENTS',
    });
  }
  assert.throws(() => makeOriginals(creationIntentOriginal, pkA, pkB, allocationOriginal, null));
  assert.equal(traps, 0);
  assert.equal(coreCalls, 0);
});

test('seed rejects extra operands, noncanonical input and reused operation IDs', () => {
  assert.throws(() => makeAllocation(seedOriginal, null));
  assert.throws(() => makeAllocation(seed));
  assert.throws(() => makeAllocation(seedOriginal + ' '));
  assert.throws(() => makeAllocation(canonicalJSON({ ...seed, scopes: ['account:write'] })));
  assert.throws(() => makeAllocation(canonicalJSON({ ...seed, mainDeviceOperationId: creationOperationId })));
  assert.throws(() => makeAllocation(canonicalJSON({ ...seed, mainDeviceOperationId: '33'.repeat(32) })));
  assert.equal(coreCalls, 0);
});
