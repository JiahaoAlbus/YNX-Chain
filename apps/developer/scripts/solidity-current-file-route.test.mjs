import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { DebugSelectionContribution } = require('../runtime/ynx-workbench/lib/debug-selection.js');
function routing() {
  const editors = { currentEditor: { editor: { uri: { scheme: 'file' }, document: { languageId: 'solidity' } } } }, configurations = {}, calls = [], handlers = new Map();
  const commands = { executeCommand: id => calls.push(id), isEnabled: id => typeof id === 'string' };
  const contribution = new DebugSelectionContribution(commands, editors, configurations);
  contribution.registerCommands({ registerCommand: (command, handler) => handlers.set(command.id, handler) });
  return { editors, configurations, calls, commands, contribution, handlers };
}
test('Solidity primary action compiles through existing command; absent debugger cannot fall back to JS picker', () => {
  const f = routing();
  assert.equal(f.contribution.currentFileCommand(false), 'ynx.compileSolidity');
  assert.equal(f.handlers.get('ynx.workbench.runCurrentFile').isEnabled(), true);
  f.handlers.get('ynx.workbench.runCurrentFile').execute();
  assert.deepEqual(f.calls, ['ynx.compileSolidity']);
  assert.equal(f.handlers.get('ynx.workbench.debugCurrentFile').isEnabled(), false);
  assert.throws(() => f.handlers.get('ynx.workbench.debugCurrentFile').execute(), /No applicable/);
  assert.deepEqual(f.calls, ['ynx.compileSolidity']);
  f.commands.isEnabled = () => false;
  assert.equal(f.handlers.get('ynx.workbench.runCurrentFile').isEnabled(), false);
});
test('explicit user launch choice remains authoritative; nonfile documents do not enter Solidity compiler', () => {
  const f = routing(); f.configurations.current = { name: 'user-selected chain debugger' };
  assert.equal(f.contribution.currentFileCommand(false), 'workbench.action.debug.run');
  assert.equal(f.contribution.currentFileCommand(true), 'workbench.action.debug.start');
  f.configurations.current = undefined; f.editors.currentEditor.editor.uri.scheme = 'untitled';
  assert.equal(f.contribution.currentFileCommand(false), 'workbench.action.debug.run');
});
test('primary Solidity label says compile, and changes when current target or explicit selection changes', () => {
  const source = readFileSync(new URL('../runtime/ynx-workbench/lib/workbench-controls.js', import.meta.url), 'utf8'), module = { exports: {} };
  vm.runInNewContext(source, { module, require: name => name === 'react' ? { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } : require(name), setInterval, clearInterval });
  const { WorkbenchControlsContribution } = module.exports, f = routing(); let toolbar, updates = 0;
  const controls = Object.assign(Object.create(WorkbenchControlsContribution.prototype), {
    editors: { ...f.editors, all: [f.editors.currentEditor] }, debugConfigurations: f.configurations,
    disposables: [], nodes: [], stopped: false, state: () => ({ enabled: true }),
    translate: (_key, label) => label, changed: { event() {}, fire() { updates++; } },
  });
  controls.registerToolbarItems({ registerItem: item => { toolbar = item; return { dispose() {} }; } });
  assert.equal(toolbar.render(f.editors.currentEditor).props.children[0].props.title, 'Compile Solidity project');
  controls.refresh(); const first = updates;
  f.configurations.current = { name: 'explicit target' }; controls.refresh();
  assert.equal(updates, first + 1);
  assert.equal(toolbar.render(f.editors.currentEditor).props.children[0].props.title, 'Run current file or project');
  f.configurations.current = undefined; controls.refresh();
  f.editors.currentEditor.editor.document.languageId = 'go'; const before = updates; controls.refresh();
  assert.equal(updates, before + 1);
});
