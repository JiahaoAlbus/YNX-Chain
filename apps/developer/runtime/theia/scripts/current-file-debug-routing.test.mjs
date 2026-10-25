import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DebugSelectionContribution } = require('../../ynx-workbench/lib/debug-selection');

test('default run shortcuts reach all supported file runners while debug defaults do not intercept an active session or unsupported debugger', async () => {
  const { pathToFileURL } = await import('node:url');
  // Use the expression implementation from the same pinned Monaco runtime.
  // A dummy ContextKeyService.match returning true would hide missing bindings.
  const { ContextKeyExpr } = await import(pathToFileURL(require.resolve('@theia/monaco-editor-core/esm/vs/platform/contextkey/common/contextkey.js')));
  const { registerDefaultKeybindings } = require('../../ynx-workbench/lib/default-keybindings');
  const bindings = [];
  registerDefaultKeybindings({ registerKeybinding: binding => bindings.push(binding) }, 'core.close.tab');
  const matches = (command, language, changes = {}) => bindings.some(binding => binding.command === command &&
    ContextKeyExpr.deserialize(binding.when).evaluate({ getValue: key => ({ editorTextFocus: true, resourceScheme: 'file', inDebugMode: false, editorLangId: language, ...changes })[key] }));
  for (const language of ['c', 'cpp', 'javascript', 'python', 'typescript', 'typescriptreact', 'go', 'solidity']) {
    assert.equal(matches('ynx.workbench.runCurrentFile', language), true, `${language}: normal run shortcut must reach its current-file runner`);
    for (const changes of [{ inDebugMode: true }, { editorTextFocus: false }, { resourceScheme: 'untitled' }]) {
      assert.equal(matches('ynx.workbench.runCurrentFile', language, changes), false);
      assert.equal(matches('ynx.workbench.debugCurrentFile', language, changes), false);
    }
  }
  for (const language of ['c', 'cpp', 'javascript', 'python', 'typescript', 'typescriptreact']) {
    assert.equal(matches('ynx.workbench.debugCurrentFile', language), true, `${language}: supported debug shortcut`);
  }
  for (const language of ['go', 'solidity', 'plaintext', 'json']) assert.equal(matches('ynx.workbench.debugCurrentFile', language), false);
  const run = bindings.find(binding => binding.command === 'ynx.workbench.runCurrentFile');
  const debug = bindings.find(binding => binding.command === 'ynx.workbench.debugCurrentFile');
  assert.equal(run.keybinding, 'ctrl+f5'); assert.equal(debug.keybinding, 'f5');
});
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

// Configuration/artifact tabs never select a stale project launcher.
const nonProgramTargetFixture=language=>new DebugSelectionContribution({isEnabled:()=>true},{currentEditor:{editor:{uri:{scheme:'file'},document:{languageId:language}}}},{current:{type:'pwa-node',name:'Last unrelated Node target'}},{openView:async()=>{}});
for(const language of ['json','jsonc','markdown','plaintext'])test('current-file Run on '+language+' must not launch the last workspace debugger',()=>{assert.equal(nonProgramTargetFixture(language).currentFileCommand(false),undefined);});
test('explicit Debug preserves the configured project entry',()=>{assert.equal(nonProgramTargetFixture('jsonc').currentFileCommand(true),'workbench.action.debug.start');});
test('supported source Run stays language-specific after inspecting configuration files',()=>{const f=nonProgramTargetFixture('cpp');assert.equal(f.currentFileCommand(false),'ynx.cpp.runActive');f.editors.currentEditor.editor.document.languageId='python';assert.equal(f.currentFileCommand(false),'python.execInTerminal');f.editors.currentEditor.editor.document.languageId='go';assert.equal(f.currentFileCommand(false),'ynx.go.run');f.editors.currentEditor.editor.document.languageId='solidity';assert.equal(f.currentFileCommand(false),'ynx.compileSolidity');});
test('other extension project debuggers retain the existing fallback',()=>{assert.equal(nonProgramTargetFixture('rust').currentFileCommand(false),'workbench.action.debug.run');});
test('registered current-file action stays disabled for config and executes no unrelated launcher',()=>{const f=nonProgramTargetFixture('jsonc'),handlers=new Map(),calls=[];f.commands.executeCommand=command=>calls.push(command);f.registerCommands({registerCommand:(command,handler)=>handlers.set(command.id,handler)});const run=handlers.get('ynx.workbench.runCurrentFile');assert.equal(run.isEnabled(),false);assert.throws(()=>run.execute(),/No applicable/);assert.deepEqual(calls,[]);f.editors.currentEditor.editor.document.languageId='cpp';assert.equal(run.isEnabled(),true);run.execute();assert.deepEqual(calls,['ynx.cpp.runActive']);});

for (const [label, editors] of [
  ['no active editor', {}],
  ['unsaved buffer', {currentEditor:{editor:{uri:{scheme:'untitled'},document:{languageId:'cpp'}}}}],
  ['debug source', {currentEditor:{editor:{uri:{scheme:'debug'},document:{languageId:'javascript'}}}}],
  ['editor without resource', {currentEditor:{editor:{document:{languageId:'go'}}}}],
]) test('current-file Run cannot execute the last project target with '+label,()=>{
  const calls=[],handlers=new Map(),selected={name:'Unrelated saved launch',type:'pwa-node'};
  const f=new DebugSelectionContribution({executeCommand:id=>calls.push(id),isEnabled:()=>true},editors,{current:selected});
  f.registerCommands({registerCommand:(command,handler)=>handlers.set(command.id,handler)});
  const run=handlers.get('ynx.workbench.runCurrentFile');
  assert.equal(run.isEnabled(),false);
  assert.throws(()=>run.execute(),/No applicable/);
  assert.deepEqual(calls,[]);
  assert.equal(f.configurations.current,selected);
  assert.equal(f.currentFileCommand(true),'workbench.action.debug.start','explicit project Debug remains available');
});
