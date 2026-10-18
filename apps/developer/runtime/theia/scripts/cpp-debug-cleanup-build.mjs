// Compile-time augmentation of the retained Theia 1.76 process adapter creator.
// Upstream remains EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
export const PIN = '6cedbc4bb2394402547eb64b34eb3f3340c44354494638fcfac4857ec479bcfd';
export const INSERTED_IMPORT = './local-cpp-debug-cleanup';
const NEEDLE = 'exports.NodeDebugAdapterCreator = NodeDebugAdapterCreator;';
export function transformCppDebugCleanup(source) {
  if (createHash('sha256').update(source).digest('hex') !== PIN || source.split(NEEDLE).length !== 2)
    throw Error('The retained C/C++ debug adapter creator source changed.');
  return source.replace(NEEDLE, NEEDLE + '\nrequire("' + INSERTED_IMPORT + '").install(NodeDebugAdapterCreator.prototype);');
}
export function cppDebugCleanupPlugin() {
  const vendor = require.resolve('@theia/plugin-ext/lib/plugin/node/debug/plugin-node-debug-adapter-creator');
  return { name: 'ynx-pinned-cpp-debug-cleanup', setup(build) {
    if (!build.initialOptions.outdir || !resolve(build.initialOptions.outdir).endsWith('/lib/backend'))
      throw Error('C/C++ cleanup helper must be adjacent to backend bundles.');
    build.initialOptions.metafile = true;
    build.onEnd(result => {
      for (const [output, info] of Object.entries(result.metafile?.outputs || {}))
        if (info.imports.some(item => item.external && item.path === INSERTED_IMPORT) && dirname(resolve(output)) !== resolve(build.initialOptions.outdir))
          throw Error('C/C++ cleanup helper import escaped its backend directory.');
    });
    build.onResolve({ filter: /^\.\/local-cpp-debug-cleanup$/ }, args => args.importer === vendor ? { path: INSERTED_IMPORT, external: true } : undefined);
    build.onLoad({ filter: /\/plugin\/node\/debug\/plugin-node-debug-adapter-creator\.js$/ }, async args => {
      if (args.path !== vendor) return undefined;
      return { loader: 'js', resolveDir: dirname(vendor), contents: transformCppDebugCleanup(await readFile(vendor, 'utf8')) };
    });
  } };
}
