import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, appendFile, writeFile, mkdir, symlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCoreProject, verifyCoreExtensionInputs } from '../src/runtime-files.mjs';
const tools = fileURLToPath(new URL('../../../native/ynx-tools', import.meta.url));
async function stagedProject() {
  const root = await mkdtemp('/private/tmp/ynx-core-extension-review-');
  await mkdir(join(root, 'user-data/User'), { recursive: true });
  const settings = join(root, 'user-data/User/settings.json'); await writeFile(settings, '{"editor.fontSize":19}\n', { flag: 'wx' });
  await prepareCoreProject({ projectDirectory: root });
  const manifest = JSON.parse(await readFile(join(tools, 'package.json')));
  return { root, settings, target: join(root, 'extensions', `ynx.ynx-tools-${manifest.version}`) };
}
test('changed newly added language/diagnostics helpers refuse without overwriting code or user settings', async () => {
  for (const name of ['solidity-language.cjs', 'solidity-diagnostics.cjs']) {
    const h = await stagedProject(), file = join(h.target, 'src', name);
    await appendFile(file, '\n// user change must be preserved\n'); const changed = await readFile(file), settings = await readFile(h.settings);
    await assert.rejects(prepareCoreProject({ projectDirectory: h.root }), { code: 'core_tools_review_required' });
    assert.deepEqual(await readFile(file), changed); assert.deepEqual(await readFile(h.settings), settings);
  }
});
test('unexpected compiler or extra executable input refuses instead of silently extending the shipped plugin', async () => {
  for (const name of ['extra.cjs', 'compiler/compiler-worker.mjs']) {
    const h = await stagedProject(), file = join(h.target, name); await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'user input must remain intact', { flag: 'wx' });
    await assert.rejects(prepareCoreProject({ projectDirectory: h.root }), { code: 'core_tools_review_required' });
    assert.equal(await readFile(file, 'utf8'), 'user input must remain intact');
  }
});
test('linked helper directory refuses and preserves linked input and existing settings', async () => {
  const h = await stagedProject(), foreign = await mkdtemp('/private/tmp/ynx-core-extension-foreign-');
  await rename(join(h.target, 'src'), join(h.root, 'src-original-preserved'));
  await writeFile(join(foreign, 'solidity-language.cjs'), 'foreign source', { flag: 'wx' });
  await symlink(foreign, join(h.target, 'src'));
  await assert.rejects(prepareCoreProject({ projectDirectory: h.root }), { code: 'core_tools_review_required' });
  assert.equal(await readFile(join(foreign, 'solidity-language.cjs'), 'utf8'), 'foreign source');
  assert.equal(await readFile(h.settings, 'utf8'), '{"editor.fontSize":19}\n');
});
test('actual reviewed compiler bundle compares all assets and refuses altered worker, WASM and dependency bytes', async t => {
  const input = process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT;
  if (!input) return t.skip('Supply the existing reviewed bundled extension.');
  const qa = await mkdtemp('/private/tmp/ynx-core-compiler-review-'), target = join(qa, 'tools');
  await cp(input, target, { recursive: true }); await verifyCoreExtensionInputs(input, target);
  const assets = ['compiler/compiler-worker.mjs', 'compiler/node_modules/solc/soljson.js', 'compiler/node_modules/js-sha3/src/sha3.js'];
  if (process.env.YNX_SOLIDITY_FORMAT_EXTENSION_INPUT === 'retained') assets.push('formatter/node_modules/@nomicfoundation/solidity-language-server/out/index.js', 'formatter/node_modules/vscode-jsonrpc/lib/node/main.js');
  for (const name of assets) {
    const file = join(target, name), original = await readFile(file);
    await appendFile(file, '\n// changed by user\n'); const changed = await readFile(file);
    await assert.rejects(verifyCoreExtensionInputs(input, target), { code: 'core_tools_review_required' });
    assert.deepEqual(await readFile(file), changed);
    // Explicit fixture restoration only; every refusal preserves the mutation.
    await writeFile(file, original);
  }
  await verifyCoreExtensionInputs(input, target);
});
