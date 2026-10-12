import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CommandRegistry } = require('@theia/core/lib/common/command');
const { NativeWorkbenchCommands } = require('../../ynx-workbench/lib/native-workbench-commands');
const requestId = 'fbcf6585-a642-40b7-bc06-57d8f7aff876';
function fixture() {
  const commands = new CommandRegistry({ getContributions: () => [] });
  const messages = [];
  const target = { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => messages.push(value) } } } };
  const contribution = new NativeWorkbenchCommands(commands, target);
  contribution.onStart();
  assert.deepEqual(messages.shift(), { action: 'locale', locale: 'en' });
  return { commands, messages, target, contribution };
}
test('native menus execute the actual enabled CommandRegistry handler and preserve arguments boundary', async () => {
  const f = fixture(); let executions = 0;
  f.commands.registerCommand({ id: 'terminal:new' }, { execute: (...args) => { assert.deepEqual(args, []); executions++; } });
  await f.target.__ynxLocalWorkbenchCommand('terminal:new', requestId);
  assert.equal(executions, 1);
  assert.deepEqual(f.messages, [{ action: 'command-result', requestId, accepted: true }]);
  f.contribution.onStop(); assert.equal(f.target.__ynxLocalWorkbenchCommand, undefined);
});
test('disabled, absent, unknown and failed commands do not report completion or disclose exception text', async () => {
  const f = fixture(); let executions = 0;
  f.commands.registerCommand({ id: 'terminal:new' }, { isEnabled: () => false, execute: () => executions++ });
  f.commands.registerCommand({ id: 'core.save' }, { execute: () => { throw Error('/private/user-secret-path'); } });
  for (const command of ['terminal:new', 'terminal:split', 'core.save', 'arbitrary.shell']) await f.target.__ynxLocalWorkbenchCommand(command, requestId);
  assert.equal(executions, 0);
  assert.equal(f.messages.length, 4);
  for (const message of f.messages) { assert.equal(message.accepted, false); assert.ok(message.error.length <= 160); assert.ok(!message.error.includes('/private')); }
  await f.target.__ynxLocalWorkbenchCommand('terminal:new', 'invalid');
  assert.equal(f.messages.length, 4);
});
test('ordinary browser receives no native hook', () => {
  const target = {}; new NativeWorkbenchCommands({}, target).onStart();
  assert.equal(target.__ynxLocalWorkbenchCommand, undefined);
});
