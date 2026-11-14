import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { install, installProjectSaveDefault } = require('../../ynx-workbench/lib/native-file-picker');
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
test('native Save As returns only the current project destination and preserves cancellation and stale-document fences',async()=>{
 const root={resource:new URI('file:///project')},roots=[root],editor={editor:{document:{}}},editors={currentEditor:editor};
 let reply={uris:['file:///project/hello.js']},pending,requests=0;
 const target={ynxDesktopFiles:{async open(options){requests++;assert.equal(options.kind,'save');assert.equal(options.name,'hello.js');return pending?await pending:reply;}}};
 const dialogs={showSaveDialog:()=>assert.fail('native save must not open the browser picker')};
 installProjectSaveDefault({dialogs,editors,workspace:{tryGetRoots:()=>roots},target,URI});
 assert.equal((await dialogs.showSaveDialog({inputValue:'hello.js'},root)).toString(),'file:///project/hello.js');
 reply={cancelled:true};assert.equal(await dialogs.showSaveDialog({inputValue:'hello.js'}),undefined);
 for(const uri of ['file:///project-other/file.js','file:///project','https://example.com/file.js']){
  reply={uris:[uri]};await assert.rejects(dialogs.showSaveDialog({inputValue:'hello.js'}),/inside the current project/);
 }
 let release;pending=new Promise(resolve=>{release=resolve;});const saving=dialogs.showSaveDialog({inputValue:'hello.js'});
 editor.editor.document={};release({uris:['file:///project/hello.js']});assert.equal(await saving,undefined);
 pending=undefined;let releaseRoot;pending=new Promise(resolve=>{releaseRoot=resolve;});const switched=dialogs.showSaveDialog({inputValue:'hello.js'});
 roots[0]={resource:new URI('file:///other')};releaseRoot({uris:['file:///project/hello.js']});assert.equal(await switched,undefined);
 assert.equal(requests,7);
});

test('native Save As starts in the saved file directory, honors a valid explicit folder and falls back safely', async () => {
  const root = { resource: new URI('file:///project'), isDirectory: true };
  const source = new URI('file:///project/src/main.py');
  const directory = { resource: source.parent, isDirectory: true };
  const explicit = { resource: new URI('file:///project/exports'), isDirectory: true };
  const workspace = { tryGetRoots: () => [root] };
  const editors = { currentEditor: { editor: { uri: source, document: {} } } };
  const dialogs = { showSaveDialog: () => assert.fail('unexpected browser dialog') };
  const requests = [], resolved = [];
  let missing = false;
  const fileService = { async resolve(uri) {
    resolved.push(uri.toString());
    if (missing) throw Error('Directory removed');
    return directory;
  } };
  const target = { ynxDesktopFiles: { async open(request) { requests.push(request); return { cancelled: true }; } } };
  installProjectSaveDefault({ dialogs, editors, workspace, fileService, target, URI });
  const props = { inputValue: 'main.py' };
  assert.equal(await dialogs.showSaveDialog(props), undefined);
  assert.equal(await dialogs.showSaveDialog(props, explicit), undefined);
  assert.equal(await dialogs.showSaveDialog(props, { ...explicit, resource: new URI('file:///outside') }), undefined);
  missing = true;
  assert.equal(await dialogs.showSaveDialog(props), undefined);
  editors.currentEditor.editor.uri = new URI('untitled:Untitled-1');
  assert.equal(await dialogs.showSaveDialog(props), undefined);
  assert.deepEqual(resolved, [directory.resource.toString(), directory.resource.toString()]);
  assert.deepEqual(requests, [
    { kind: 'save', name: 'main.py', directoryUri: directory.resource.toString() },
    { kind: 'save', name: 'main.py', directoryUri: explicit.resource.toString() },
    { kind: 'save', name: 'main.py' },
    { kind: 'save', name: 'main.py' },
    { kind: 'save', name: 'main.py' },
  ]);
});

test('changing the active editor during native Save As directory lookup cancels before opening the picker', async () => {
  const root = { resource: new URI('file:///project') };
  const editors = { currentEditor: { editor: { uri: new URI('file:///project/src/main.py'), document: {} } } };
  const dialogs = { showSaveDialog: () => assert.fail('unexpected browser dialog') };
  installProjectSaveDefault({
    dialogs, editors, workspace: { tryGetRoots: () => [root] }, URI,
    target: { ynxDesktopFiles: { open: () => assert.fail('stale request opened a native picker') } },
    fileService: { async resolve(resource) {
      editors.currentEditor = { editor: { uri: new URI('file:///project/another.py'), document: {} } };
      return { resource, isDirectory: true };
    } },
  });
  assert.equal(await dialogs.showSaveDialog({ inputValue: 'main.py' }), undefined);
});

test('a native Save As result is retired when the editor or workspace changes and returns', async () => {
  for (const event of ['editor', 'roots', 'location']) {
    const root = { resource: new URI('file:///project') };
    const editor = { editor: { document: {} } };
    const listeners = { editor: new Set(), roots: new Set(), location: new Set() };
    const subscribe = name => callback => {
      listeners[name].add(callback);
      return { dispose: () => listeners[name].delete(callback) };
    };
    const editors = { currentEditor: editor, onCurrentEditorChanged: subscribe('editor') };
    let activeRoot = root;
    const workspace = {
      tryGetRoots: () => [activeRoot],
      onWorkspaceChanged: subscribe('roots'),
      onWorkspaceLocationChanged: subscribe('location'),
    };
    const dialogs = { showSaveDialog: () => assert.fail('unexpected browser dialog') };
    let complete;
    const target = { ynxDesktopFiles: { open: () => new Promise(resolve => { complete = resolve; }) } };
    installProjectSaveDefault({ dialogs, editors, workspace, target, URI });
    const pending = dialogs.showSaveDialog({ inputValue: 'main.py' });
    if (event === 'editor') editors.currentEditor = { editor: { document: {} } };
    if (event === 'roots') activeRoot = { resource: new URI('file:///another-project') };
    for (const notify of listeners[event]) notify();
    editors.currentEditor = editor;
    activeRoot = root;
    for (const notify of listeners[event]) notify();
    complete({ uris: ['file:///project/main.py'] });
    assert.equal(await pending, undefined, 'switch away and back invalidates the old save destination: ' + event);
    assert.ok(Object.values(listeners).every(set => set.size === 0));

    const retry = dialogs.showSaveDialog({ inputValue: 'main.py' });
    complete({ uris: ['file:///project/main.py'] });
    assert.equal((await retry).toString(), 'file:///project/main.py');
    assert.ok(Object.values(listeners).every(set => set.size === 0));
  }
});

test('the retained workspace save method uses native Save As without an editor and checks context through overwrite confirmation', async () => {
  const source = readFileSync(new URL('../node_modules/@theia/workspace/lib/browser/workspace-frontend-contribution.js', import.meta.url), 'utf8');
  const start = source.indexOf('    async saveWorkspaceAs() {'), end = source.indexOf('    canBeSavedAs(', start);
  assert.ok(start >= 0 && end > start);
  const original = vm.runInNewContext('({' + source.slice(start,end) + '}).saveWorkspaceAs', {
    workspace_commands_1: { WorkspaceCommands: { SAVE_WORKSPACE_AS: { label: 'Localized workspace command' } } },
  });
  class Contribution {
    registerMenus() {}
    getWorkspaceDialogFileFilters() { return {}; }
  }
  Contribution.prototype.saveWorkspaceAs = original;
  const root = { resource: new URI('file:///project') };
  const listeners = new Set(), picked = [], writes = [];
  const workspace = {
    tryGetRoots: () => [root],
    onWorkspaceLocationChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    async save(uri) {
      writes.push(uri.toString());
      for (const listener of listeners) listener();
    },
  };
  let confirmation = () => true, targetUri = 'file:///project/project.code-workspace';
  const target = { ynxDesktopFiles: { async open(request) {
    picked.push(request);
    return targetUri ? { uris: [targetUri] } : { cancelled: true };
  } } };
  const dialogs = { showSaveDialog: () => assert.fail('unexpected browser dialog') };
  install({ Contribution, URI, commands: {}, target });
  installProjectSaveDefault({ dialogs, editors: {}, workspace, target, URI });
  const contribution = Object.assign(new Contribution(), {
    workspaceService: workspace, fileDialogService: dialogs, fileService: { exists: async () => true },
    saveService: { confirmOverwrite: () => confirmation() },
    workspaceFileService: { getWorkspaceFileExtensions: () => ['.code-workspace'] },
  });
  assert.equal(await dialogs.showSaveDialog({ inputValue: 'main.py' }), undefined);
  assert.deepEqual(picked, []);
  assert.equal(await contribution.saveWorkspaceAs(), true);
  assert.deepEqual(writes, [targetUri]);
  assert.equal(listeners.size, 0);

  confirmation = () => { for (const listener of listeners) listener(); return true; };
  assert.equal(await contribution.saveWorkspaceAs(), false);
  assert.deepEqual(writes, [targetUri]);
  assert.equal(listeners.size, 0);

  targetUri = 'file:///outside/project.code-workspace';
  await assert.rejects(contribution.saveWorkspaceAs(), /inside the current project/);
  assert.equal(listeners.size, 0);
  targetUri = undefined;
  assert.equal(await contribution.saveWorkspaceAs(), false);
  assert.equal(listeners.size, 0);
  assert.equal(picked.length, 4);
});
