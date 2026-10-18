import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the actual packaged relative module graph without starting services,
// executing imports, contacting a registry, or changing the signed payload.
export async function verifyPackagedLocalImports(root) {
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
