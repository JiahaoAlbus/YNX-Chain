import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DebugSelectionContribution } = require('../../ynx-workbench/lib/debug-selection');
test('current-file routing follows language and preserves explicit launch selections', () => {
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
  assert.equal(contribution.currentFileCommand(false), 'workbench.action.debug.run');
  configurations.current = undefined; editors.currentEditor.editor.uri.scheme = 'debug';
  assert.equal(contribution.currentFileCommand(true), 'select.debug.configuration');
});
