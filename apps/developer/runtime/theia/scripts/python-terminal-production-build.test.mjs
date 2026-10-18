import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('normal production esbuild entry installs the pinned creation augmentation before compiling plugin-host bundles', async () => {
  const source = await readFile(new URL('../esbuild.mjs', import.meta.url), 'utf8');
  const retained = {}, owned = {}, cpp = {}, browser = {}, calls = [];
  const nodeOptions = { outdir: 'lib/backend', plugins: [retained] }, browserOptions = { plugins: [browser] };
  const context = { nodeOptions, browserOptions, watch: false, pythonTerminalCreationPlugin: () => owned, cppDebugCleanupPlugin: () => cpp,
    esbuild: { async context(options) { calls.push({ options, plugins: [...options.plugins] }); return { async rebuild() {}, async dispose() {} }; } },
    process: { exit() { throw Error('production build rejected'); } },
  };
  // Evaluate the actual editable production entry; only mature external build
  // tools are PUBLIC doubles. The separate retained TerminalExt build tests
  // exercise the real pinned augmentation and shared external helper cache.
  await vm.runInNewContext('(async()=>{' + source.replace(/^import .*;\s*$/gm, '') + '\n})()', context);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.find(value => value.options === browserOptions).plugins, [browser]);
  const node = calls.find(value => value.options === nodeOptions);
  assert.equal(node.options.outdir, 'lib/backend');
  assert.equal(node.plugins.filter(value => value === owned).length, 1, 'actual normal production entry omitted pinned Python terminal augmentation');
  assert.equal(node.plugins.filter(value => value === cpp).length, 1, 'actual normal production entry omitted pinned C++ cleanup augmentation');
  assert.ok(node.plugins.includes(retained), 'existing generated Node build plugins are retained');
  assert.match(source, /import \{ pythonTerminalCreationPlugin \} from '\.\/scripts\/python-terminal-creation-build\.mjs'/);
});
