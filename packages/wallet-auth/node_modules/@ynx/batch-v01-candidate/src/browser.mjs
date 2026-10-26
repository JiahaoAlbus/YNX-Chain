// Explicit verification-only ESM entry. No account/Source/Root is trusted here.
import * as wire from './browser-codec.mjs';
import {publicByteRuntime, concatBytes} from './public-bytes.mjs';
import {createTreeOperations} from './tree-core.mjs';
import {createVerifierFactory} from './verify-core.mjs';
import {createNobleHash, verifyNoble, releaseDependencies} from './public-noble.mjs';
export * from './browser-codec.mjs';

const copy = publicByteRuntime.copy;
const operations = createTreeOperations(wire, {copy, concat: concatBytes});
const information = Object.freeze({
  provider: 'noble-public', verificationOnly: true,
  algorithms: Object.freeze(['ML-DSA-87', 'SLH-DSA-SHA2-256f']),
  releaseDependencies,
  // ESM does not expose dependency package.json or loaded-source integrity.
  // The normal release loader must bind the package/lock/module bytes. These
  // fixed release declarations are not a runtime version attestation.
  dependencyVersionVerified: false,
  runtime: Object.freeze({environment: 'javascript-esm', dependencyVersions: 'not-observable',
    loadedModuleIntegrity: 'release-loader-responsibility'}),
});
const implementation = Object.freeze({
  info: () => information,
  importPublic: certificate => ({A: copy(wire.exact(certificate.pkA, 2592, 'pkA')),
    B: copy(wire.exact(certificate.pkB, 64, 'pkB'))}),
  verify: verifyNoble,
});
const makeVerifier = createVerifierFactory({wire, copy,
  tree: {...operations, createHasher: (context, count, optimized) =>
    operations.createHasher(context, count, optimized, algorithm => createNobleHash(algorithm, copy))},
  selectProvider(name) {
    wire.requireThat(name === 'noble-public', 'unknown public verification provider');
    return implementation;
  },
});
export function createVerifier(options) {
  wire.requireThat(options && typeof options === 'object' && !Object.hasOwn(options, 'provider'),
    'verification-only entry has no provider switch');
  return makeVerifier({...options, provider: 'noble-public'});
}
export function browserProviderInfo() { return information; }
