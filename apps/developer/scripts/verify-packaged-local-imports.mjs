import { createRequire } from 'node:module';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownedWorkbench = fileURLToPath(new URL('../runtime/theia/', import.meta.url));
// This is the existing workbench build-tool closure, not a Developer runtime
// dependency. Resolve at its declared package and exact lock; never via cwd,
// NODE_PATH, a global install, an environment binary override or npm install.
export async function loadOwnedEsbuild(workbenchRoot = ownedWorkbench) {
  const root = resolve(workbenchRoot), manifest = JSON.parse(await readFile(join(root, 'package.json'))),
    lock = JSON.parse(await readFile(join(root, 'package-lock.json')));
  const cli = manifest.devDependencies?.['@theia/cli'];
  if (lock.lockfileVersion !== 3 || cli !== '1.76.0' || lock.packages?.['']?.devDependencies?.['@theia/cli'] !== cli ||
      lock.packages?.['node_modules/@theia/cli']?.version !== cli ||
      lock.packages['node_modules/@theia/cli'].dependencies?.['@theia/application-manager'] !== cli ||
      lock.packages?.['node_modules/@theia/application-manager']?.version !== cli ||
      lock.packages['node_modules/@theia/application-manager'].dependencies?.esbuild !== '^0.28.2' ||
      lock.packages?.['node_modules/esbuild']?.version !== '0.28.2') throw Error('Owned workbench esbuild declaration/lock differs');
  if (process.env.ESBUILD_BINARY_PATH) throw Error('An ambient esbuild binary override is not permitted');
  const require = createRequire(join(root, 'package.json'));
  const entry = require.resolve('esbuild'), packageFile = require.resolve('esbuild/package.json');
  const exactRoot = join(await realpath(root), 'node_modules/esbuild');
  if ((await lstat(exactRoot)).isSymbolicLink() || await realpath(packageFile) !== join(exactRoot, 'package.json') ||
      await realpath(entry) !== join(exactRoot, 'lib/main.js')) throw Error('esbuild resolved outside the owned workbench closure');
  const actual = JSON.parse(await readFile(packageFile));
  if (actual.version !== '0.28.2') throw Error('Owned esbuild version differs from its lock');
  const platform = '@esbuild/' + process.platform + '-' + process.arch;
  if (actual.optionalDependencies?.[platform] !== actual.version || lock.packages?.['node_modules/' + platform]?.version !== actual.version)
    throw Error('Owned esbuild platform closure differs');
  const platformRoot = join(await realpath(root), 'node_modules', platform);
  if ((await lstat(platformRoot)).isSymbolicLink() || await realpath(platformRoot) !== platformRoot ||
      JSON.parse(await readFile(join(platformRoot, 'package.json'))).version !== actual.version) throw Error('Owned esbuild platform package differs');
  const api = require(entry);
  if (api.version !== actual.version || typeof api.build !== 'function') throw Error('Owned esbuild API differs');
  return api;
}

// Resolve the actual packaged relative module graph without starting services,
// executing imports, contacting a registry, or changing the signed payload.
export async function verifyPackagedLocalImports(root, workbenchRoot = ownedWorkbench) {
  const { build } = await loadOwnedEsbuild(workbenchRoot);
  const result = await build({
    // The native server loads Go/control modules through computed file URLs.
    // Explicit entries make those real runtime imports part of this guard.
    entryPoints: ['desktop/local-workbench.mjs', 'desktop/wallet-admission-startup.mjs',
      'desktop/local-go-selection.mjs', 'desktop/native-parent-control.mjs',
      'desktop/original-service-pipe.mjs'].map(entry => resolve(root, entry)),
    outdir: resolve(root, '.import-verification'),
    absWorkingDir: resolve(root), bundle: true, write: false,
    platform: 'node', format: 'esm', packages: 'external',
    metafile: true, logLevel: 'silent',
  });
  return { relativeModules: Object.keys(result.metafile.inputs).length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('An exact packaged Developer root is required');
  console.log(JSON.stringify(await verifyPackagedLocalImports(process.argv[2])));
}
