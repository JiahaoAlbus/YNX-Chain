import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DebugSelectionContribution } = require('../../ynx-workbench/lib/debug-selection');
require('reflect-metadata');
const { CommandRegistry } = require('@theia/core/lib/common/command');
test('extension debug-view command reveals the existing debugger without toggling it closed or launching a session', async () => {
  const registry = new CommandRegistry({ getContributions: () => [] });
  const openings = [], widget = { id: 'debug' };
  const view = { openView: async options => { openings.push(options); return widget; } };
  new DebugSelectionContribution(registry, {}, {}, view).registerCommands(registry);
  for (let i = 0; i < 2; i++) assert.equal(await registry.executeCommand('workbench.view.debug'), widget);
  assert.deepEqual(openings, [{ activate: true }, { activate: true }]);
});
test('debug-view compatibility preserves an existing implementation and propagates actual open failures', async () => {
  const registry = new CommandRegistry({ getContributions: () => [] });
  registry.registerCommand({ id: 'workbench.view.debug' }, { execute: () => 'original' });
  new DebugSelectionContribution(registry, {}, {}, { openView: () => assert.fail('must retain original') }).registerCommands(registry);
  assert.equal(await registry.executeCommand('workbench.view.debug'), 'original');
  const failed = new CommandRegistry({ getContributions: () => [] });
  new DebugSelectionContribution(failed, {}, {}, { openView: async () => { throw Error('view unavailable'); } }).registerCommands(failed);
  await assert.rejects(failed.executeCommand('workbench.view.debug'), /view unavailable/);
});
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
test('triangle current-editor route ignores selected launch configuration and refuses non-file or unsupported editors',()=>{
 const editors={currentEditor:{editor:{uri:{scheme:'file'},document:{languageId:'go'}}}},configurations={current:{name:'unrelated Node launch'}};
 const called=[],handlers=new Map();let enabled=true;
 const c=new DebugSelectionContribution({executeCommand:id=>called.push(id),isEnabled:()=>enabled},editors,configurations);
 c.registerCommands({registerCommand:(command,handler)=>handlers.set(command.id,handler)});
 const run=handlers.get('ynx.workbench.runEditorFile');assert.equal(run.isEnabled(),true);run.execute();
 assert.equal(called.pop(),'ynx.go.run');assert.equal(c.currentFileCommand(false),'workbench.action.debug.run');
 for(const [language,command] of [['javascript','ynx.js.runActive'],['cpp','ynx.cpp.runActive'],['python','python.execInTerminal'],['typescript','ynx.ts.runActive']]){
  editors.currentEditor.editor.document.languageId=language;run.execute();assert.equal(called.pop(),command);
 }
 enabled=false;assert.equal(run.isEnabled(),false);enabled=true;
 editors.currentEditor.editor.document.languageId='json';assert.equal(run.isEnabled(),false);assert.throws(()=>run.execute(),/No current-file runner/);
 editors.currentEditor.editor.document.languageId='javascript';editors.currentEditor.editor.uri.scheme='untitled';assert.equal(run.isEnabled(),false);
 editors.currentEditor=undefined;assert.equal(run.isEnabled(),false);assert.equal(called.length,0);
});
