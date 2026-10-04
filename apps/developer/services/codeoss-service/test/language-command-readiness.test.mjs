import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { LanguageCommandReadiness } = createRequire(import.meta.url)('../../../runtime/ynx-workbench/lib/language-command-readiness.js');
function fixture() {
  let start; const calls = [], handlers = {}, position = { value: 1, equalsSelection(other) { return this.value === other.value; } };
  const model = { version: 1, getVersionId() { return this.version; } };
  const control = { getModel: () => model, getSelection: () => ({ ...position }), getAction: () => null };
  const widget = { isDisposed: false, editor: { uri: { scheme: 'file' }, document: { languageId: 'solidity' }, getControl: () => control } };
  const editors = { currentEditor: widget };
  const plugins = { didStart: new Promise(resolve => { start = resolve; }), activateByLanguage: async language => calls.push({ language }) };
  const monacoCommands = { executeMonacoCommand: (id, ...args) => calls.push({ id, args }) };
  const contribution = new LanguageCommandReadiness(editors, plugins, monacoCommands);
  contribution.registerCommands({ registerHandler: (id, handler) => { handlers[id] = handler; } });
  return { calls, model, position, widget, editors, start, handler: handlers['editor.action.revealDefinition'] };
}
test('first definition command awaits actual host startup and language activation before standard action', async () => {
  const h = fixture(); assert.equal(h.handler.isEnabled(), true);
  const task = h.handler.execute('argument'); await Promise.resolve(); assert.deepEqual(h.calls, []);
  h.start(); await task;
  assert.deepEqual(h.calls, [{ language: 'solidity' }, { id: 'editor.action.revealDefinition', args: ['argument'] }]);
});
test('pending startup cannot redirect switched tab, edited source, changed cursor or disposed editor', async () => {
  for (const change of [h => { h.editors.currentEditor = undefined; }, h => { h.model.version++; }, h => { h.position.value++; }, h => { h.widget.isDisposed = true; }]) {
    const h = fixture(), task = h.handler.execute(); change(h); h.start(); await task;
    assert.deepEqual(h.calls, [{ language: 'solidity' }]);
  }
});
test('other languages and non-file editors retain their existing standard handler', () => {
  const h = fixture(); h.widget.editor.document.languageId = 'typescript'; assert.equal(h.handler.isEnabled(), false);
  h.widget.editor.document.languageId = 'solidity'; h.widget.editor.uri.scheme = 'ynx-review'; assert.equal(h.handler.isEnabled(), false);
});
