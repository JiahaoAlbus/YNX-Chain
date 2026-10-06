import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the actual packaged relative module graph without starting services,
// executing imports, contacting a registry, or changing the signed payload.
export async function verifyPackagedLocalImports(root) {
  const result = await build({
    entryPoints: [resolve(root, 'desktop/local-workbench.mjs')],
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
