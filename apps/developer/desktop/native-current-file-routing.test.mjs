import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CommandRegistry } = require('@theia/core/lib/common/command');
const { NativeWorkbenchCommands } = require('../runtime/ynx-workbench/lib/native-workbench-commands');
const { DebugSelectionContribution } = require('../runtime/ynx-workbench/lib/debug-selection');
const request = 'fbcf6585-a642-40b7-bc06-57d8f7aff876';
function fixture(language = 'cpp') {
  const calls = [], messages = [];
  const commands = new CommandRegistry({ getContributions: () => [] });
  const editors = { currentEditor: { editor: { uri: { scheme: 'file' }, document: { languageId: language } } } };
  const configurations = {}, state = { active: false };
  const contextKeys = { match(expression) { assert.equal(expression, 'inDebugMode'); return state.active; } };
  for (const id of ['workbench.action.debug.start', 'workbench.action.debug.run', 'workbench.action.debug.stop',
    'ynx.cpp.runActive', 'ynx.cpp.debugActive', 'ynx.js.runActive', 'ynx.js.debugActive',
    'ynx.ts.runActive', 'ynx.ts.debugActive', 'python.execInTerminal', 'debugpy.debugInTerminal',
    'ynx.go.run', 'select.debug.configuration']) {
    commands.registerCommand({ id }, { execute: (...args) => { assert.deepEqual(args, []); calls.push(id); } });
  }
  new DebugSelectionContribution(commands, editors, configurations).registerCommands(commands);
  const target = { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => messages.push(value) } } } };
  const bridge = new NativeWorkbenchCommands(commands, target, 'en', contextKeys);
  bridge.onStart(); messages.length = 0;
  return { commands, editors, configurations, state, calls, messages, target, bridge,
    dispatch: id => target.__ynxLocalWorkbenchCommand(id, request) };
}
for (const [language, run, debug] of [
  ['cpp', 'ynx.cpp.runActive', 'ynx.cpp.debugActive'], ['c', 'ynx.cpp.runActive', 'ynx.cpp.debugActive'],
  ['javascript', 'ynx.js.runActive', 'ynx.js.debugActive'], ['typescript', 'ynx.ts.runActive', 'ynx.ts.debugActive'],
  ['python', 'python.execInTerminal', 'debugpy.debugInTerminal'],
]) test(`native Run menu reaches existing ${language} production selection`, async () => {
  const f = fixture(language);
  await f.dispatch('workbench.action.debug.run'); await f.dispatch('workbench.action.debug.start');
  assert.deepEqual(f.calls, [run, debug]);
  assert.equal(f.messages.length, 2); assert.ok(f.messages.every(message => message.accepted));
});
test('active debug session retains upstream start/continue and run behavior', async () => {
  const f = fixture(); f.state.active = true;
  await f.dispatch('workbench.action.debug.start'); await f.dispatch('workbench.action.debug.run');
  await f.dispatch('workbench.action.debug.stop');
  assert.deepEqual(f.calls, ['workbench.action.debug.start', 'workbench.action.debug.run', 'workbench.action.debug.stop']);
});
test('explicit project configuration remains authoritative through production selector', async () => {
  const f = fixture(); f.configurations.current = { name: 'user launch' };
  await f.dispatch('workbench.action.debug.start'); await f.dispatch('workbench.action.debug.run');
  assert.deepEqual(f.calls, ['workbench.action.debug.start', 'workbench.action.debug.run']);
});
test('disabled language target refuses without falling back to an unrelated debugger', async () => {
  const f = fixture(); f.commands.unregisterCommand('ynx.cpp.runActive');
  f.commands.registerCommand({ id: 'ynx.cpp.runActive' }, { isEnabled: () => false, execute: () => assert.fail('disabled') });
  await f.dispatch('workbench.action.debug.run');
  assert.deepEqual(f.calls, []); assert.equal(f.messages[0].accepted, false);
});
test('missing context state preserves upstream rather than guessing session state', async () => {
  const f = fixture(); f.bridge.onStop();
  new NativeWorkbenchCommands(f.commands, f.target).onStart();
  await f.dispatch('workbench.action.debug.start');
  assert.deepEqual(f.calls, ['workbench.action.debug.start']);
});
