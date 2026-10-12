// Owned compile-time augmentation of retained Theia 1.76 terminal-ext.js.
// Upstream component remains EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0.
// No retained source bytes are changed. The single addition transports a private
// owned creation capability through the existing TerminalOptions.attributes.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
export const PIN = '5e5e4d521fe829aecf4e4f904fdf5da86d409a0ba5d9ef113bed0a79194b5f9f';
export const INSERTED_IMPORT = './python-terminal-creation';
const NEEDLE = 'options = {\n                    name: nameOrOptions.name,\n                };';
export function transformTerminalCreation(source) {
  if (createHash('sha256').update(source).digest('hex') !== PIN || source.split(NEEDLE).length !== 2) throw Error('The retained Python terminal creation source changed.');
  return 'require("./python-terminal-creation").registerCompiledCreationContract("' + PIN + '");\n' + source.replace(NEEDLE,
    'options = {\n                    name: nameOrOptions.name,\n                    ...require("./python-terminal-creation").takeCreationAttributes(nameOrOptions),\n                };');
}
export function pythonTerminalCreationPlugin() {
  const vendor = require.resolve('@theia/plugin-ext/lib/plugin/terminal-ext');
  return { name: 'ynx-pinned-python-terminal-creation', setup(build) {
    if (!build.initialOptions.outdir || !resolve(build.initialOptions.outdir).endsWith('/lib/backend')) throw Error('Python terminal helper must be adjacent to backend bundles.');
    build.initialOptions.metafile = true;
    build.onEnd(result => {
      for (const [output, info] of Object.entries(result.metafile?.outputs || {})) {
        if (info.imports.some(item => item.external && item.path === INSERTED_IMPORT) && dirname(resolve(output)) !== resolve(build.initialOptions.outdir))
          throw Error('Python terminal helper import escaped its backend directory.');
      }
    });
    build.onResolve({ filter: /^\.\/python-terminal-creation$/ }, args => {
      if (args.importer !== vendor) return undefined;
      return { path: INSERTED_IMPORT, external: true };
    });
    build.onLoad({ filter: /\/plugin\/terminal-ext\.js$/ }, async args => {
      if (args.path !== vendor) return undefined;
      const source = await readFile(vendor, 'utf8');
      const contents = transformTerminalCreation(source);
      console.log('YNX retained terminal creation augmentation ' + PIN + ' (EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0)');
      return { loader: 'js', resolveDir: dirname(vendor), contents };
    });
  } };
}
