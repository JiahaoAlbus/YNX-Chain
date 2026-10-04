import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
export const COMPILER_VERSION = '0.8.24';
export const COMPILER_SHA256 = 'fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9';

// Resolve only the existing local package. No download, lifecycle script or
// fallback compiler is allowed to satisfy the Testnet compiler contract.
export function compilerReadiness() {
  try {
    const installedVersion = JSON.parse(readFileSync(require.resolve('solc/package.json'), 'utf8')).version;
    const artifactSha256 = createHash('sha256').update(readFileSync(require.resolve('solc/soljson.js'))).digest('hex');
    const available = installedVersion === COMPILER_VERSION && artifactSha256 === COMPILER_SHA256;
    return { available, pinned: available, expectedVersion: COMPILER_VERSION, expectedArtifactSha256: COMPILER_SHA256,
      installedVersion, artifactSha256, ...(!available ? { code: 'compiler_pin_mismatch', error: 'The installed Solidity compiler does not match the reviewed 0.8.24 artifact.' } : {}) };
  } catch {
    return { available: false, pinned: false, expectedVersion: COMPILER_VERSION, expectedArtifactSha256: COMPILER_SHA256,
      code: 'compiler_unavailable', error: 'The reviewed Solidity 0.8.24 compiler is not installed.' };
  }
}

export function assertCompilerPin() {
  const state = compilerReadiness();
  if (!state.available) throw Object.assign(new Error(state.error), { status: 503, code: state.code, compiler: state });
  return state;
}
