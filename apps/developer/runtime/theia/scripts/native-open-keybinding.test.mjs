import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { install, installNativeOpenKeybindings } = require('../../ynx-workbench/lib/native-file-picker');
const URI = require('@theia/core/lib/common/uri').default;
const commands = Object.fromEntries(Object.entries({ OPEN: 'workspace:open', OPEN_FILE: 'workspace:openFile', OPEN_FOLDER: 'workspace:openFolder', OPEN_WORKSPACE: 'workspace:openWorkspace', OPEN_RECENT_WORKSPACE: 'workspace:openRecent', SAVE_AS: 'file.saveAs', COPY_RELATIVE_FILE_PATH: 'file.copyRelativePath' }).map(([key, id]) => [key, { id }]));
// Execute the pinned framework's actual two default registration methods; this
// is the browser-target collision observed in the installed Cocoa App.
function frameworkMethod(path) {
  const source = readFileSync(new URL('../node_modules/' + path, import.meta.url), 'utf8');
  const start = source.indexOf('    registerKeybindings(keybindings) {');
  assert.ok(start >= 0);
  const end = source.indexOf('\n    }', start) + 6;
  return vm.runInNewContext('({' + source.slice(start, end) + '}).registerKeybindings', {
    core_1: { isOSX: true }, common_1: { isWindows: false }, workspace_commands_1: { WorkspaceCommands: commands },
  });
}
const workspaceMethod = frameworkMethod('@theia/workspace/lib/browser/workspace-frontend-contribution.js');
const symbolMethod = frameworkMethod('@theia/monaco/lib/browser/workspace-symbol-command.js');
function fixture(native) {
  class Workspace { isElectron() { return false; } }
  class Symbols { isElectron() { return false; } }
  Workspace.prototype.registerKeybindings = workspaceMethod;
  Symbols.prototype.registerKeybindings = symbolMethod;
  const options = { Contribution: Workspace, SymbolContribution: Symbols, commands, target: native ? { ynxDesktopFiles: {} } : {} };
  const registrations = [], registry = { registerKeybinding(binding, ...args) { assert.equal(this, registry); registrations.push({ ...binding, args }); return binding; } };
  const symbols = new Symbols(); symbols.command = { id: 'languages.workspace.symbol' };
  return { options, registry, registrations, workspace: new Workspace(), symbols };
}
test('actual browser defaults demonstrate CmdO symbol collision and remain unchanged without native bridge', () => {
  const f = fixture(false); installNativeOpenKeybindings(f.options);
  f.workspace.registerKeybindings(f.registry); f.symbols.registerKeybindings(f.registry);
  assert.equal(f.registrations.find(x => x.keybinding === 'ctrlcmd+o').command, 'languages.workspace.symbol');
  assert.equal(f.registrations.find(x => x.command === 'workspace:open').keybinding, 'ctrlcmd+alt+o');
});
test('native defaults route CmdO to explicit file picker in either contribution order, once', () => {
  for (const reverse of [false, true]) {
    const f = fixture(true); installNativeOpenKeybindings(f.options); installNativeOpenKeybindings(f.options);
    for (const contribution of reverse ? [f.symbols, f.workspace] : [f.workspace, f.symbols]) contribution.registerKeybindings(f.registry);
    assert.deepEqual(f.registrations.filter(x => x.keybinding === 'ctrlcmd+o').map(x => x.command), ['workspace:openFile']);
    assert.equal(f.registrations.find(x => x.command === 'languages.workspace.symbol').keybinding, 'ctrlcmd+t');
    assert.equal(f.registrations.find(x => x.command === 'workspace:openWorkspace').keybinding, 'ctrlcmd+alt+w');
    assert.equal(f.registrations.find(x => x.command === 'file.saveAs').keybinding, 'ctrlcmd+shift+s');
    assert.ok(f.registrations.every(x => x.args.length === 0 && !Object.hasOwn(x, 'scope')), 'normal default registration, no higher scope');
  }
});
test('adapter does not wrap registry or mutate user and workspace remaps', () => {
  const f = fixture(true), register = f.registry.registerKeybinding;
  installNativeOpenKeybindings(f.options); f.workspace.registerKeybindings(f.registry);
  assert.equal(f.registry.registerKeybinding, register);
  for (const scope of [1, 2]) {
    const custom = { command: 'languages.workspace.symbol', keybinding: 'ctrlcmd+o' };
    f.registry.registerKeybinding(custom, scope);
    assert.deepEqual(f.registrations.at(-1), { ...custom, args: [scope] });
  }
});

test('native Open ignores old file and workspace replies when the workspace changes and returns', async () => {
  for (const [method, stage] of [['doOpenFile', 'picker'], ['doOpenFile', 'resolve'], ['doOpenWorkspace', 'read']]) {
    class Contribution {
      registerMenus() {}
      doOpenFile() { return 'browser file'; }
    }
    const roots = [{ resource: new URI('file:///project') }], events = new Set(), effects = [];
    const workspaceService = {
      tryGetRoots: () => roots,
      onWorkspaceLocationChanged(callback) {
        events.add(callback);
        return { dispose: () => events.delete(callback) };
      },
      async open(uri) { effects.push(uri.toString()); },
    };
    const fileUri = method === 'doOpenWorkspace' ? 'file:///project/demo.code-workspace' : 'file:///project/main.py';
    const reply = { uris: [fileUri], rootUri: roots[0].resource.toString() };
    let release, entered, wait = true;
    const pendingStage = new Promise(resolve => { entered = resolve; });
    const stageResult = (at, value) => {
      if (!wait || stage !== at) return Promise.resolve(value);
      entered();
      return new Promise(resolve => { release = () => resolve(value); });
    };
    const target = { ynxDesktopFiles: { open: () => stageResult('picker', reply) } };
    install({
      Contribution, URI, commands, target, localize: (_key, text) => text, parse: JSON.parse,
      open: async (_service, uri) => { effects.push(uri.toString()); },
    });
    const contribution = new Contribution();
    Object.assign(contribution, {
      workspaceService,
      fileService: {
        resolve: () => stageResult('resolve', { isFile: true, size: 32 }),
        readFile: () => stageResult('read', { value: Buffer.from('{"folders":[{"path":"."}]}') }),
      },
      messageService: { error: message => effects.push(message) },
    });
    const pending = contribution[method]();
    await pendingStage;
    const root = roots[0];
    roots[0] = { resource: new URI('file:///another') };
    for (const notify of events) notify();
    roots[0] = root;
    for (const notify of events) notify();
    release();
    assert.equal(await pending, undefined, method + ' after ' + stage);
    assert.deepEqual(effects, []);
    assert.equal(events.size, 0);
    wait = false;
    await contribution[method]();
    assert.deepEqual(effects, [fileUri]);
    assert.equal(events.size, 0);
    target.ynxDesktopFiles = undefined;
    assert.equal(await contribution.doOpenFile(), 'browser file');
  }
});

test('native Open failure disposes listeners immediately and retry opens while its notice is pending', { timeout: 1000 }, async () => {
  class Contribution { registerMenus() {} }
  const root = { resource: new URI('file:///project') }, listeners = new Set(), messages = [], opened = [];
  const subscribe = listener => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  const uri = 'file:///project/main.py';
  let attempts = 0;
  const target = { ynxDesktopFiles: { async open() {
    if (++attempts === 1) throw Error('The selected file disappeared');
    return { uris: [uri] };
  } } };
  install({
    Contribution, URI, target, commands, localize: (_key, text) => text,
    open: async (_service, selected) => opened.push(selected.toString()),
  });
  const contribution = Object.assign(new Contribution(), {
    workspaceService: { tryGetRoots: () => [root], onWorkspaceChanged: subscribe, onWorkspaceLocationChanged: subscribe },
    messageService: { error(message) { messages.push(message); return new Promise(() => {}); } },
    fileService: { resolve: async () => ({ isFile: true }) },
  });
  assert.equal(await contribution.doOpenFile(), undefined);
  assert.equal(listeners.size, 0);
  assert.deepEqual(messages, ['The selected file disappeared']);
  assert.equal((await contribution.doOpenFile())[0].toString(), uri);
  assert.deepEqual(opened, [uri]);
  assert.equal(listeners.size, 0);
});
