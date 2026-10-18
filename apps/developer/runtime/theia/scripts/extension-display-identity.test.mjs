import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const module = { exports: {} };
class VSXExtension {
  get displayName() { return this.metadata.displayName; }
  get verified() { return this.metadata.verified; }
  async enable() { this.enableCalls = (this.enableCalls || 0) + 1; }
  async disable() { if (this.disableFailure) throw this.disableFailure; return 'disabled'; }
  doInstall() { return this.runTask('Installing', async () => { if (this.installFailure) throw this.installFailure; return 'installed'; }); }
}
vm.runInNewContext(readFileSync(new URL('../../ynx-workbench/lib/extension-lifecycle.js', import.meta.url), 'utf8'), {
  module, require: id => id.endsWith('/vsx-extension') ? { VSXExtension } : { injectable: () => value => value, inject: () => () => {}, MessageService: class {} },
});
const { YnxVSXExtension, extensionDisplayName } = module.exports;
test('failed install reports a visible notification without waiting for dismissal or replacing its first cause', async () => {
  const extension = new YnxVSXExtension(), notices = [], failure = Error('original deployment failure');
  extension.ynxMessages = { error: text => { notices.push(text); return new Promise(() => {}); } };
  extension.installFailure = failure;
  await assert.rejects(extension.doInstall({ version: '1.2.3' }), error => error === failure);
  assert.equal(notices.length, 1); assert.match(notices[0], /installation failed/i);
  assert.equal(extension._currentTask, undefined);
  extension.installFailure = undefined; assert.equal(await extension.doInstall({ version: '1.2.3' }), 'installed');
  assert.equal(notices.length, 1);
});
test('failed disable preserves required host reload until a successful disable', async () => {
  const extension = new YnxVSXExtension(); extension.needsHostReload = true;
  extension.disableFailure = Error('host disable refused');
  await assert.rejects(extension.disable(), /host disable refused/);
  assert.equal(extension.needsHostReload, true);
  extension.disableFailure = undefined; assert.equal(await extension.disable(), 'disabled');
  assert.equal(extension.needsHostReload, false);
});
test('enabling an uninstalled entry is a no-op, while installed entry requests reload after success', async () => {
  const extension = new YnxVSXExtension();
  await extension.enable(); assert.equal(extension.enableCalls, undefined);
  assert.equal(extension.needsHostReload, undefined);
  extension.id = 'example.language'; extension.installedVersion = '1.2.3';
  extension.model = { doChange: async task => task() };
  await extension.enable(); assert.equal(extension.enableCalls, 1);
  assert.equal(extension.needsHostReload, true);
});
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
