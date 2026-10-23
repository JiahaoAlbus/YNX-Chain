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
test('current Solidity Run compiles while explicit Debug retains the user launch; nonfile Run retains project fallback', () => {
  const f = routing(), selected = { name: 'user-selected chain debugger' };
  f.configurations.current = selected;
  f.handlers.get('ynx.workbench.runCurrentFile').execute();
  f.handlers.get('ynx.workbench.debugCurrentFile').execute();
  assert.deepEqual(f.calls, ['ynx.compileSolidity', 'workbench.action.debug.start']);
  assert.equal(f.configurations.current, selected);
  for (const scheme of ['untitled', 'debug', 'https']) {
    f.editors.currentEditor.editor.uri.scheme = scheme;
    f.handlers.get('ynx.workbench.runCurrentFile').execute();
    assert.equal(f.calls.at(-1), 'workbench.action.debug.run');
    assert.equal(f.configurations.current, selected);
  }
  f.configurations.current = undefined;
  assert.equal(f.contribution.currentFileCommand(false), 'workbench.action.debug.run');
});
test('primary Solidity label matches compile despite retained launch, and changes for another current target', () => {
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
  assert.equal(updates, first, 'a retained Debug selection does not change the current-file Compile action');
  assert.equal(toolbar.render(f.editors.currentEditor).props.children[0].props.title, 'Compile Solidity project');
  f.configurations.current = undefined; controls.refresh();
  f.editors.currentEditor.editor.document.languageId = 'go'; const before = updates; controls.refresh();
  assert.equal(updates, before + 1);
  assert.equal(toolbar.render(f.editors.currentEditor).props.children[0].props.title, 'Run current file or project');
});
