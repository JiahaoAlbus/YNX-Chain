// The same fixed Noble primitives used by the explicit Node portable provider.
// Only public-key import, signature verification and hashes leave this module.
import {ml_dsa87} from '@noble/post-quantum/ml-dsa.js';
import {slh_dsa_sha2_256f} from '@noble/post-quantum/slh-dsa.js';
import {sha3_512} from '@noble/hashes/sha3.js';
import {sha512} from '@noble/hashes/sha2.js';
import {requireThat} from './codec-core.mjs';

export const releaseDependencies = Object.freeze({
  '@noble/post-quantum': '0.6.1', '@noble/hashes': '2.2.0',
});
export function createNobleHash(algorithm, copy) {
  requireThat(algorithm === 'sha3-512' || algorithm === 'sha512', 'unsupported portable hash');
  const wrap = state => ({
    update(input) { state.update(input); return this; },
    copy() { return wrap(state.clone()); },
    digest() { return copy(state.digest()); },
  });
  return wrap((algorithm === 'sha3-512' ? sha3_512 : sha512).create());
}
export function verifyNoble(keys, branch, message, signature) {
  requireThat(branch === 'A' || branch === 'B', 'unknown key branch');
  const algorithm = branch === 'A' ? ml_dsa87 : slh_dsa_sha2_256f;
  return algorithm.verify(signature, message, keys[branch], {context: new Uint8Array()});
}
