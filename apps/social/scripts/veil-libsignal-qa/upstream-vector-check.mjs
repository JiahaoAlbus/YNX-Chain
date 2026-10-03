// Upstream test adaptations: Copyright 2021-2023 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated QA only. No production activation or license disposition implied.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageRoot, evidenceRoot] = process.argv.slice(2);
if (!packageRoot || !evidenceRoot) throw new Error('Expected isolated package root and evidence directory');
const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@signalapp/libsignal-client');
assert.equal(metadata.version, '0.104.0');
const sdk = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
const publicFixture = await readFile(resolve(evidenceRoot, 'upstream-kyber1024-public-key.dat'));
const upstream = '257105c55a7389ca6b1e85185e2769465e6729f1';
const checks = [];
function check(name, action) {
  action();
  checks.push({ name, result: 'PASS' });
  console.log(`PASS ${name}`);
}
try {
  check('original public fixture exact upstream Git blob and byte count', () => {
    assert.equal(publicFixture.length, 1568);
    const blob = createHash('sha1').update(`blob ${publicFixture.length}\0`).update(publicFixture).digest('hex');
    assert.equal(blob, '5b230f1e46c0ca850e420bf902a7e3236d7d3333');
  });
  const serialized = Buffer.concat([Buffer.of(0x08), publicFixture]);
  check('upstream Kyber1024 public fixture native deserialize/serialize', () => {
    assert.deepEqual(Buffer.from(sdk.KEMPublicKey.deserialize(serialized).serialize()), serialized);
  });
  check('native KEM rejects truncated public key', () => {
    assert.throws(() => sdk.KEMPublicKey.deserialize(serialized.subarray(0, serialized.length - 1)));
  });
  check('native KEM rejects unknown type rather than falling back', () => {
    assert.throws(() => sdk.KEMPublicKey.deserialize(Buffer.concat([Buffer.of(0xff), publicFixture])));
  });
  const uuid = '8c78cd2a-16ff-427d-83dc-1a5e36ce713d';
  const raw = Buffer.from(uuid.replaceAll('-', ''), 'hex');
  const aci = sdk.Aci.fromUuid(uuid);
  const pni = sdk.Pni.fromUuid(uuid);
  check('original fixed ACI identity encoding vector', () => {
    assert.equal(aci.getServiceIdString(), uuid);
    assert.deepEqual(Buffer.from(aci.getServiceIdBinary()), raw);
    assert.equal(sdk.ServiceId.parseFromServiceIdBinary(raw).getServiceIdString(), uuid);
  });
  check('original fixed PNI identity encoding vector', () => {
    const expected = Buffer.concat([Buffer.of(0x01), raw]);
    assert.equal(pni.getServiceIdString(), `PNI:${uuid}`);
    assert.deepEqual(Buffer.from(pni.getServiceIdBinary()), expected);
    assert.equal(sdk.ServiceId.parseFromServiceIdBinary(expected).getServiceIdString(), `PNI:${uuid}`);
  });
  check('ACI and PNI remain distinct device address namespaces', () => {
    assert.notEqual(sdk.ProtocolAddress.new(aci, 1).toString(), sdk.ProtocolAddress.new(pni, 1).toString());
    assert.equal(aci.isEqual(pni), false);
  });
  check('native device address rejects out-of-range ID', () => {
    assert.throws(() => sdk.ProtocolAddress.new('name', 128));
  });
  check('native service identity rejects empty wire and string inputs', () => {
    assert.throws(() => sdk.ServiceId.parseFromServiceIdBinary(Buffer.of()));
    assert.throws(() => sdk.ServiceId.parseFromServiceIdString(''));
  });
  const report = {
    schema: 'ynx-social-upstream-native-vector-qa-v1',
    package: metadata.name, version: metadata.version, upstream_commit: upstream,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    fixture: {
      path: 'rust/protocol/src/kem/test-data/pk.dat',
      git_blob: '5b230f1e46c0ca850e420bf902a7e3236d7d3333',
      bytes: publicFixture.length,
      sha256: createHash('sha256').update(publicFixture).digest('hex'),
      classification: 'upstream public test key, not user data or a secret key',
    },
    address_vectors_source: 'node/ts/test/protocol/AddressTest.ts',
    address_vectors_git_blob: 'f6c3a1815e9bd902db55dd05ffe95872f58fb61e',
    checks,
    not_proven: [
      'KEM encapsulation known-answer vectors',
      'PQXDH transcript and independent SPQR actual key contribution',
      'persistent crash/restart atomicity or multi-node prekey consumption',
      'native mobile/browser integration, migration, activation, security review or user acceptance',
    ],
  };
  await writeFile(resolve(evidenceRoot, 'upstream-vector-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASS ${checks.length} bounded upstream fixture/encoding checks`);
} catch (error) {
  // Do not dump native errors, buffers, session material or stack traces.
  console.error(`FAIL ${error?.name === 'AssertionError' ? 'AssertionError' : 'NativeOrRuntimeError'}`);
  process.exitCode = 1;
}
