import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installProjectSaveDefault } = require('../../ynx-workbench/lib/native-file-picker');
const URI = require('../node_modules/@theia/core/lib/common/uri').default;
test('untitled and debugger views default to project; explicit folder and cancellation remain authoritative', async () => {
  const root = { resource: { isEqualOrParent: () => true } };
  const workspace = { tryGetRoots: () => [root] };
  const editors = { currentEditor: { editor: { uri: { scheme: 'debug' } } } };
  const seen = [], dialogs = { showSaveDialog: async (props, folder) => { seen.push(folder); return undefined; } };
  installProjectSaveDefault({ dialogs, editors, workspace, fileService: { resolve: () => { throw Error('must not coerce debugger path'); } } });
  assert.equal(await dialogs.showSaveDialog({}), undefined); assert.equal(seen[0], root);
  const chosen = {}; await dialogs.showSaveDialog({}, chosen); assert.equal(seen[1], chosen);
  editors.currentEditor.editor.uri.scheme = 'untitled'; await dialogs.showSaveDialog({}); assert.equal(seen[2], root);
});
test('saved file uses its project directory; outside resources cannot choose another root', async () => {
  const root = { resource: new URI('file:///project') };
  const workspace = { tryGetRoots: () => [root] };
  const editors = { currentEditor: { editor: { uri: new URI('file:///project/src/main.cpp') } } };
  const seen = [], directory = { resource: new URI('file:///project/src'), isDirectory: true };
  const dialogs = { showSaveDialog: async (_props, folder) => { seen.push(folder); return folder.resource; } };
  installProjectSaveDefault({ dialogs, editors, workspace, fileService: { resolve: async uri => { assert.equal(uri.toString(), 'file:///project/src'); return directory; } } });
  await dialogs.showSaveDialog({}); assert.equal(seen[0], directory);
  editors.currentEditor = { editor: { uri: new URI('file:///outside/source.cpp') } };
  await dialogs.showSaveDialog({}); assert.equal(seen[1], root);
});
test('workspace or document change during directory lookup cancels stale Save As', async () => {
  const root = { resource: new URI('file:///project') }, roots = [root];
  const editors = { currentEditor: { editor: { uri: new URI('file:///project/main.cpp') } } };
  let opened = 0;
  const dialogs = { showSaveDialog: async () => { opened++; } };
  installProjectSaveDefault({ dialogs, editors, workspace: { tryGetRoots: () => roots }, fileService: { resolve: async () => { editors.currentEditor = undefined; return root; } } });
  assert.equal(await dialogs.showSaveDialog({}), undefined); assert.equal(opened, 0);
});
