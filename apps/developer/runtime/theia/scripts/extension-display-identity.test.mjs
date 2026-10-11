import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const module = { exports: {} };
class VSXExtension {
  get displayName() { return this.metadata.displayName; }
  get verified() { return this.metadata.verified; }
}
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/extension-lifecycle.js', import.meta.url), 'utf8'), {
  module, require: id => id.endsWith('/vsx-extension') ? { VSXExtension } : { injectable: () => value => value },
});
const { YnxVSXExtension, extensionDisplayName } = module.exports;
test('language-pack presentation uses functional product label without changing package identity or verification', () => {
  const extension = new YnxVSXExtension();
  extension.id = 'ms-ceintl.vscode-language-pack-zh-hans';
  extension.metadata = { displayName: 'Chinese (Simplified) Language Pack for Visual Studio Code', verified: false, publisher: 'MS-CEINTL' };
  assert.equal(extension.displayName, '简体中文语言包'); assert.equal(extension.verified, false);
  assert.equal(extension.id, 'ms-ceintl.vscode-language-pack-zh-hans'); assert.equal(extension.metadata.publisher, 'MS-CEINTL');
  assert.equal(extension.metadata.displayName, 'Chinese (Simplified) Language Pack for Visual Studio Code');
});
test('display labels remove compatibility branding without editing source metadata', () => {
  assert.equal(extensionDisplayName('example.python', 'Python for Visual Studio Code'), 'Python');
  assert.equal(extensionDisplayName('example.theme', 'Theme for VS Code'), 'Theme');
  assert.equal(extensionDisplayName('example.tools', 'VSCode Tools'), 'Tools');
  assert.equal(extensionDisplayName('example.cpp', 'C/C++'), 'C/C++');
});
test('failed extension operation preserves its error, clears busy state and permits retry', async () => {
  const extension = new YnxVSXExtension();
  const failure = new Error('deployment refused');
  await assert.rejects(extension.runTask('Installing', () => { throw failure; }), error => error === failure);
  assert.equal(extension._currentTask, undefined); assert.equal(extension._currentTaskName, undefined);
  assert.equal(await extension.runTask('Installing', async () => 'installed'), 'installed');
  assert.equal(extension._currentTask, undefined);
});
test('inflight extension operation owns its status and rejects duplicate dispatch', async () => {
  const extension = new YnxVSXExtension(); let resolve, calls = 0;
  const pending = extension.runTask('Installing', () => { calls++; return new Promise(done => { resolve = done; }); });
  await assert.rejects(extension.runTask('Uninstalling', () => { calls++; }), value => value === 'busy');
  assert.equal(calls, 1); assert.equal(extension._currentTaskName, 'Installing');
  resolve('installed'); await pending;
  assert.equal(extension._currentTaskName, undefined);
});
test('asynchronous deployment rejection is delivered once without an orphan rejection', async () => {
  const extension = new YnxVSXExtension(); const unexpected = [];
  const listener = error => unexpected.push(error); process.on('unhandledRejection', listener);
  try {
    await assert.rejects(extension.runTask('Installing', async () => { throw new Error('download failed'); }), /download failed/);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unexpected, []); assert.equal(extension._currentTask, undefined);
  } finally { process.removeListener('unhandledRejection', listener); }
});
