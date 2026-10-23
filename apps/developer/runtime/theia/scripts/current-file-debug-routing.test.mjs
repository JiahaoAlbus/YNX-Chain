import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DebugSelectionContribution } = require('../../ynx-workbench/lib/debug-selection');
test('triangle Run follows the active language even while another project debugger remains selected', () => {
  const selected = { configuration: { name: 'YNX C++ active file', type: 'lldb-dap', request: 'launch' }, workspaceFolderUri: 'file:///project' };
  const configurations = { current: selected };
  const editor = { uri: { scheme: 'file' }, document: { languageId: 'javascript' } };
  const calls = [], handlers = new Map();
  const contribution = new DebugSelectionContribution({ executeCommand: id => calls.push(id), isEnabled: id => id !== 'workbench.action.debug.run' }, { currentEditor: { editor } }, configurations);
  contribution.registerCommands({ registerCommand: (command, handler) => handlers.set(command.id, handler) });
  for (const [language, run] of [['javascript','ynx.js.runActive'], ['python','python.execInTerminal'], ['go','ynx.go.run'], ['typescript','ynx.ts.runActive'], ['cpp','ynx.cpp.runActive'], ['solidity','ynx.compileSolidity']]) {
    editor.document.languageId = language;
    assert.equal(handlers.get('ynx.workbench.runCurrentFile').isEnabled(), true);
    handlers.get('ynx.workbench.runCurrentFile').execute();
    assert.equal(calls.pop(), run);
    assert.equal(configurations.current, selected, 'Never clear or replace the user launch selection');
  }
  assert.equal(contribution.currentFileCommand(true), 'workbench.action.debug.start');
});
test('current-file Run follows language and explicit Debug preserves launch selections', () => {
  const editors = { currentEditor: { editor: { uri: { scheme: 'file' }, document: { languageId: 'javascript' } } } };
  const configurations = {};
  const called = [], handlers = new Map();
  const commands = { executeCommand: id => called.push(id), isEnabled: () => true };
  const contribution = new DebugSelectionContribution(commands, editors, configurations);
  contribution.registerCommands({ registerCommand: (command, handler) => handlers.set(command.id, handler) });
  for (const [language, run, debug] of [
    ['javascript', 'ynx.js.runActive', 'ynx.js.debugActive'], ['cpp', 'ynx.cpp.runActive', 'ynx.cpp.debugActive'],
    ['python', 'python.execInTerminal', 'debugpy.debugInTerminal'], ['typescript', 'ynx.ts.runActive', 'ynx.ts.debugActive'],
  ]) {
    editors.currentEditor.editor.document.languageId = language;
    handlers.get('ynx.workbench.runCurrentFile').execute(); handlers.get('ynx.workbench.debugCurrentFile').execute();
    assert.deepEqual(called.splice(0), [run, debug]);
  }
  configurations.current = { name: 'user configuration' };
  assert.equal(contribution.currentFileCommand(true), 'workbench.action.debug.start');
  assert.equal(contribution.currentFileCommand(false), 'ynx.ts.runActive');
  configurations.current = undefined; editors.currentEditor.editor.uri.scheme = 'debug';
  assert.equal(contribution.currentFileCommand(true), 'select.debug.configuration');
});

test('standard debug view action opens and focuses the existing view without toggling or starting a session', async () => {
  require('reflect-metadata');
  const { CommandRegistry } = require('@theia/core/lib/common/command');
  const registry = new CommandRegistry({ getContributions: () => [] });
  const selected = { name: 'Keep user launch', type: 'lldb-dap' };
  const configurations = { current: selected };
  let opened = false, calls = 0;
  const debugView = { async openView(options) {
    assert.deepEqual(options, { activate: true }); opened = true; calls++;
    return 'existing-debug-view';
  } };
  new DebugSelectionContribution(registry, {}, configurations, debugView).registerCommands(registry);
  assert.ok(registry.getCommand('workbench.view.debug'), 'notification command must be registered');
  assert.equal(await registry.executeCommand('workbench.view.debug'), 'existing-debug-view');
  assert.equal(await registry.executeCommand('workbench.view.debug'), 'existing-debug-view');
  assert.equal(opened, true); assert.equal(calls, 2);
  assert.equal(configurations.current, selected);
  assert.equal(registry.getCommand('workbench.action.debug.start'), undefined, 'opening the view must not need a debugger or run command');
});
