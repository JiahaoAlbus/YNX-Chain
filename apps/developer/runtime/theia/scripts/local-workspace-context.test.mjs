import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const { Emitter } = require('@theia/core/lib/common/event');
const { CommandRegistry } = require('@theia/core/lib/common/command');
// Execute unchanged owned CJS with the retained installation's normal module
// search paths: the producer normally copies it into that installation.
const ownedPath = fileURLToPath(new URL('../../ynx-workbench/lib/local-workspace-context.js', import.meta.url));
const ownedModule = new Module(ownedPath); ownedModule.paths = require.resolve.paths('@theia/core');
ownedModule._compile(readFileSync(ownedPath, 'utf8'), ownedPath);
const { LocalWorkspaceContext } = ownedModule.exports;
const boundPath = '/private/tmp/YNX 项目 #one';
const bound = URI.fromComponents({ scheme: 'file', path: boundPath });
const wrong = URI.fromComponents({ scheme: 'file', path: '/private/tmp/other-project' });
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { native = true, getContext = async () => ({ mode: 'local', workspace: boundPath }), ready = Promise.resolve() } = {}) {
  const commands = new CommandRegistry({ getContributions: () => [] }), changed = new Emitter();
  const posted = [], warnings = [], opened = [], choices = [];
  let roots = [{ resource: bound }], listeners = 0;
  const workspace = {
    ready, get roots() { return Promise.resolve(roots); },
    onWorkspaceChanged(listener) {
      listeners++; const subscription = changed.event(listener);
      let disposed = false;
      return { dispose() { if (!disposed) { disposed = true; listeners--; subscription.dispose(); } } };
    },
    async open(uri, options) { opened.push({ uri, options }); },
  };
  const target = native ? { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => posted.push(value) } } } } : {};
  const messages = { async warn(...args) { warnings.push(args); return choices.shift(); } };
  const contribution = new LocalWorkspaceContext(workspace, { getContext }, commands, messages, target);
  contribution.registerCommands(commands);
  t.after(() => { contribution.onStop(); changed.dispose(); });
  return { contribution, commands, messages, posted, warnings, opened, choices, get listeners() { return listeners; },
    change(values) { roots = values.map(resource => ({ resource })); changed.fire(roots); },
  };
}
test('canonical bound URI with spaces, Unicode and hash never warns on normal workspace events', async t => {
  const f = fixture(t); await f.contribution.onStart();
  assert.equal(f.listeners, 1); assert.equal(f.contribution.boundRoot.toString(), bound.toString());
  f.change([bound]); await settle();
  assert.deepEqual(f.warnings, []); assert.deepEqual(f.posted, []); assert.deepEqual(f.opened, []);
});
test('wrong URL workspace roots warn and Return to Open Project uses the actual bound file URI', async t => {
  const f = fixture(t); await f.contribution.onStart(); f.choices.push('Return to Open Project');
  f.change([wrong]); await settle();
  assert.equal(f.warnings.length, 1); assert.ok(f.warnings[0].includes('Return to Open Project'));
  assert.equal(f.opened.length, 1); assert.ok(f.opened[0].uri instanceof URI);
  assert.equal(f.opened[0].uri.toString(), bound.toString()); assert.deepEqual(f.opened[0].options, { preserveWindow: true });
  assert.deepEqual(f.posted, []);
});
test('native Open Folder command posts only the picker action, ignoring untrusted caller path arguments', async t => {
  const f = fixture(t); await f.contribution.onStart();
  assert.equal(f.commands.isEnabled('ynx.workbench.openFolder'), true);
  await f.commands.executeCommand('ynx.workbench.openFolder', '/private/tmp/attacker-path', { path: '/outside' });
  assert.deepEqual(f.posted, [{ action: 'open-folder' }]); assert.deepEqual(f.opened, []);
  f.choices.push('Open Folder…'); f.change([wrong]); await settle();
  assert.deepEqual(f.posted, [{ action: 'open-folder' }, { action: 'open-folder' }]);
});
test('ordinary browser disables the actual Open Folder handler and omits its warning action', async t => {
  const f = fixture(t, { native: false }); await f.contribution.onStart();
  assert.equal(f.commands.isEnabled('ynx.workbench.openFolder'), false);
  await assert.rejects(f.commands.executeCommand('ynx.workbench.openFolder'));
  f.change([wrong]); await settle();
  assert.equal(f.warnings.length, 1); assert.ok(!f.warnings[0].includes('Open Folder…'));
  assert.ok(f.warnings[0].includes('Return to Open Project')); assert.deepEqual(f.posted, []);
});
test('failed context lookup and nonlocal or invalid context do not infer a project or warn', async t => {
  for (const getContext of [async () => { throw Error('context unavailable'); }, async () => ({ mode: 'core', workspace: boundPath }),
    async () => ({ mode: 'local', workspace: 'relative/project' }), async () => undefined]) {
    const f = fixture(t, { getContext }); f.change([wrong]); await f.contribution.onStart();
    f.change([wrong]); await settle(); assert.deepEqual(f.warnings, []); assert.equal(f.listeners, 0);
    assert.equal(f.commands.isEnabled('ynx.workbench.returnToProject'), false);
  }
});
test('mismatch warnings deduplicate until the bound project is restored; stop cancels event listening', async t => {
  const f = fixture(t); await f.contribution.onStart();
  f.change([wrong]); await settle(); f.change([wrong]); await settle(); assert.equal(f.warnings.length, 1);
  f.change([bound]); await settle(); f.change([wrong]); await settle(); assert.equal(f.warnings.length, 2);
  f.contribution.onStop(); assert.equal(f.listeners, 0);
  f.change([URI.fromComponents({ scheme: 'file', path: '/private/tmp/third-project' })]); await settle();
  assert.equal(f.warnings.length, 2);
});
test('stop while actual workspace readiness is pending cannot register a late listener or warn', async t => {
  let makeReady; const ready = new Promise(resolve => { makeReady = resolve; });
  const f = fixture(t, { ready }), startup = f.contribution.onStart();
  await settle(); f.contribution.onStop(); f.change([wrong]); makeReady(); await startup;
  assert.equal(f.listeners, 0); assert.deepEqual(f.warnings, []);
});
test('warning resolved after stop cannot reopen a project through the native command registry', async t => {
  const f = fixture(t); await f.contribution.onStart();
  let choose; const choice = new Promise(resolve => { choose = resolve; });
  f.messages.warn = async (...args) => { f.warnings.push(args); return choice; };
  f.change([wrong]); await settle(); assert.equal(f.warnings.length, 1);
  f.contribution.onStop(); choose('Return to Open Project'); await settle();
  assert.deepEqual(f.opened, []); assert.deepEqual(f.posted, []); assert.equal(f.listeners, 0);
});

test('initial mismatch prompt cannot block startup and its later recovery choice remains live',async t=>{
  const f=fixture(t,{native:false});f.change([wrong]);let choose;
  f.messages.warn=async(...args)=>{f.warnings.push(args);return new Promise(resolve=>{choose=resolve;});};
  let started=false;const startup=f.contribution.onStart().then(()=>{started=true;});await settle();
  assert.equal(started,true);assert.equal(f.listeners,1);assert.equal(f.warnings.length,1);assert.equal(f.opened.length,0);
  choose('Return to Open Project');await settle();assert.equal(f.opened.length,1);
  assert.equal(f.opened[0].uri.toString(),bound.toString());await startup;
});
