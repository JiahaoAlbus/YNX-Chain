import { createRequire } from 'node:module';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const require = createRequire(import.meta.url);
export const COMPILER_VERSION = '0.8.24';
export const COMPILER_SHA256 = 'fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9';
export const COMPILER_PACKAGE_SHA256 = '5a07c7be20943396b173c50e7fda861fcced70dfcad8f817585eb013378bf363';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function inputPaths(input) {
  if (input) {
    if (!isAbsolute(input) || !lstatSync(input).isDirectory() || lstatSync(input).isSymbolicLink()) throw new Error('An absolute reviewed compiler package is required.');
    return { package: join(input, 'package.json'), artifact: join(input, 'soljson.js'), entry: join(input, 'index.js') };
  }
  return { package: require.resolve('solc/package.json'), artifact: require.resolve('solc/soljson.js'), entry: require.resolve('solc') };
}
function packageDigest(root) {
  const files = {};
  function visit(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name, full = join(root, path), stat = lstatSync(full);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) files[path] = sha256(readFileSync(full));
      else throw new Error('Compiler input cannot contain links or special files.');
    }
  }
  visit();
  return sha256(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
}

// Resolve only the existing local package. No download, lifecycle script or
// fallback compiler is allowed to satisfy the Testnet compiler contract.
export function compilerReadiness(input = process.env.YNX_IDE_SOLC_INPUT) {
  try {
    const paths = inputPaths(input);
    const installedVersion = JSON.parse(readFileSync(paths.package, 'utf8')).version;
    const artifactSha256 = sha256(readFileSync(paths.artifact));
    const packageSha256 = input ? packageDigest(input) : undefined;
    const available = installedVersion === COMPILER_VERSION && artifactSha256 === COMPILER_SHA256 && (!input || packageSha256 === COMPILER_PACKAGE_SHA256);
    return { available, pinned: available, expectedVersion: COMPILER_VERSION, expectedArtifactSha256: COMPILER_SHA256,
      ...(input ? { inputKind: 'reviewed-offline-package', packageSha256, expectedPackageSha256: COMPILER_PACKAGE_SHA256 } : { inputKind: 'installed-package' }),
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

export function loadPinnedCompiler() {
  assertCompilerPin();
  return require(inputPaths(process.env.YNX_IDE_SOLC_INPUT).entry);
}
