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
  async uninstall(){return 'uninstalled';}
  async install(options) { if(this.preflightFailure)throw this.preflightFailure;if(this.cancelInstall)return;return this.doInstall(options); }
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
  await assert.rejects(extension.install({ version: '1.2.3' }), error => error === failure);
  assert.equal(notices.length, 1); assert.match(notices[0], /installation failed/i);
  assert.equal(extension._currentTask, undefined);
  extension.installFailure = undefined; assert.equal(await extension.install({ version: '1.2.3' }), 'installed');
  assert.equal(notices.length, 1);
});
test('missing version and pre-deployment errors also notify once and preserve their original failure',async()=>{
  const extension=new YnxVSXExtension(),notices=[];
  extension.ynxMessages={error:text=>{notices.push(text);return new Promise(()=>{});}};
  await assert.rejects(extension.install(),/Select an extension version/);
  assert.equal(notices.length,1);
  const first=Error('PUBLIC pre-deployment failure');extension.preflightFailure=first;
  await assert.rejects(extension.install({version:'1.2.3'}),e=>e===first);
  assert.equal(notices.length,2);
});
function languageFixture(){
  const extension=new YnxVSXExtension(),listeners=new Set(),notices=[],commands=[];
  extension.installed=true;extension.installedVersion='1.2.3';
  extension.pluginSupport={onDidChangePlugins(fn){listeners.add(fn);return{dispose(){assert.equal(typeof this.dispose,'function');listeners.delete(fn);}};}};
  extension.ynxMessages={error(){},info(text,action){let choose;const pending=new Promise(resolve=>choose=resolve);notices.push({text,action,choose});return pending;}};
  extension.ynxCommands={executeCommand(id){commands.push(id);}};
  const publish=(language=true)=>{extension.plugin={metadata:{model:{version:'1.2.3'}},contributes:language?{localizations:[{languageId:'zh-cn'}]}:{}};for(const fn of [...listeners])fn();};
  return{extension,listeners,notices,commands,publish};
}
test('language install waits for actual host contribution, then offers the normal language command without auto-reloading',async()=>{
  const f=languageFixture();await f.extension.install({version:'1.2.3'});
  assert.equal(f.notices.length,0);assert.equal(f.listeners.size,1);
  f.publish();f.publish();assert.equal(f.notices.length,1);assert.equal(f.listeners.size,0);assert.deepEqual(f.commands,[]);
  f.notices[0].choose(f.notices[0].action);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.commands,['workbench.action.configureLanguage']);
});
test('cancelled, failed and non-language installs do not offer a language switch',async()=>{
  const cancelled=languageFixture();cancelled.extension.cancelInstall=true;await cancelled.extension.install({version:'1.2.3'});cancelled.publish();
  assert.equal(cancelled.notices.length,0);assert.equal(cancelled.listeners.size,0);
  const failed=languageFixture();failed.extension.installFailure=Error('PUBLIC_INSTALL_FAILURE');await assert.rejects(failed.extension.install({version:'1.2.3'}));failed.publish();
  assert.equal(failed.notices.length,0);assert.equal(failed.listeners.size,0);
  const ordinary=languageFixture();await ordinary.extension.install({version:'1.2.3'});ordinary.publish(false);
  assert.equal(ordinary.notices.length,0);assert.equal(ordinary.listeners.size,0);
});
test('uninstall retires a pending language listener and stale notification choices cannot change language',async()=>{
  const f=languageFixture();await f.extension.install({version:'1.2.3'});await f.extension.uninstall();f.publish();
  assert.equal(f.notices.length,0);assert.equal(f.listeners.size,0);
  const stale=languageFixture();await stale.extension.install({version:'1.2.3'});stale.publish();stale.extension.installedVersion='1.2.4';
  stale.notices[0].choose(stale.notices[0].action);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(stale.commands,[]);
});
test('retired frontend metadata cannot convert a completed deployment into an install failure',async()=>{
  const f=languageFixture();Object.defineProperty(f.extension,'plugin',{get(){throw Error('PUBLIC_FRONTEND_RETIRED');}});
  assert.equal(await f.extension.install({version:'1.2.3'}),'installed');assert.equal(f.listeners.size,0);
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
