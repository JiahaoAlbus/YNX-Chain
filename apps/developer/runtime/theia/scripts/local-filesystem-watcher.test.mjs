import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { localWorkbenchSandboxPolicy, localWorkbenchPathIdentities } from '../../../desktop/local-workbench.mjs';
const require = createRequire(import.meta.url);
// Rendering is headless. DI, FileService, FileTree resolution and native events are retained.
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.events = {}; this._text = ''; this._value = ''; this.classList = { add() {}, remove() {}, contains: () => false, toggle() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  set value(value) { this._value = value; }
  get value() { return this._value; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; if (this.tagName === 'SELECT' && this.children.length === 1) this.value = node.value; } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, callback) { (this.events[key] ||= []).push(callback); }
  removeEventListener(key, callback) { this.events[key] = (this.events[key] || []).filter(x => x !== callback); }
  fire(key, event = {}) { for (const callback of this.events[key] || []) callback(event); }
  matches(selector) { if (selector === 'option[value=Workspace]') return this.tagName === 'OPTION' && this.value === 'Workspace'; if (selector === '[role="alert"]') return this.attrs.role === 'alert'; return this.tagName.toLowerCase() === selector; }
  querySelector(selector) { return this.children.find(child => child.matches(selector)) || this.children.map(child => child.querySelector(selector)).find(Boolean); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  getContext() { return {createLinearGradient:()=>({addColorStop(){}}), fillRect(){}, measureText:t=>({width:String(t).length*8}),getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})}; }
  focus() {} select() {} showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
}
const document = { queryCommandSupported:()=>false, createElement: tag => { const node = new Element(tag); node.ownerDocument = document; return node; }, addEventListener() {}, removeEventListener() {} };
document.body = document.createElement('body'); document.documentElement = document.createElement('html');
globalThis.Element = Element; globalThis.HTMLElement = Element; globalThis.document = document;
globalThis.DragEvent = class {};
globalThis.window = { document, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel', userAgent: 'retained-node-test' }, configurable: true });
window.navigator = globalThis.navigator; globalThis.self=window;
require('reflect-metadata');
process.env.NODE_PATH = fileURLToPath(new URL('../node_modules', import.meta.url)); Module._initPaths();
Module._extensions['.css'] = module => {module.exports={};};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({applicationName:'YNX Test'});

const { Container } = require('@theia/core/shared/inversify');
const { ILogger } = require('@theia/core/lib/common');
const { bindFileSystemWatcherServer } = require('@theia/filesystem/lib/node/filesystem-backend-module');
const { FileSystemWatcherService, FileSystemWatcherServer } = require('@theia/filesystem/lib/common/filesystem-watcher-protocol');
const { ParcelWatcherOptions } = require('@theia/filesystem/lib/node/parcel-watcher/parcel-options');
const { DiskFileSystemProvider } = require('@theia/filesystem/lib/node/disk-file-system-provider');
const { FileService } = require('@theia/filesystem/lib/browser/file-service');
const { FileTree, DirNode } = require('@theia/filesystem/lib/browser/file-tree/file-tree');
const { FileTreeModel } = require('@theia/filesystem/lib/browser/file-tree/file-tree-model');
const URI = require('@theia/core/lib/common/uri').default;
const { bindLocalFilesystemWatcher } = require('../../ynx-workbench/lib/local-filesystem-watcher');
const logger = { warn() {}, debug() {}, info() {}, error(error) { console.error(error); }, child() { return this; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => new URI(pathToFileURL(path).href);
const timeout = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await sleep(30); } assert.fail('Expected real watcher/tree event within 3 seconds'); };

test('watcher binding leaves hosted mode and other OS backends untouched', () => {
  for (const [mode, platform] of [['hosted', 'darwin'], ['local', 'linux'], ['local', 'win32']]) {
    bindLocalFilesystemWatcher(() => assert.fail('Unexpected rebind'), { YNX_WORKSPACE_MODE: mode }, platform);
  }
});

async function exercise(root) {
  const container = new Container();
  container.bind(ILogger).toConstantValue(logger);
  bindFileSystemWatcherServer(container.bind.bind(container));
  bindLocalFilesystemWatcher(container.rebind.bind(container), { YNX_WORKSPACE_MODE: 'local' }, 'darwin');
  assert.equal(container.get(ParcelWatcherOptions).backend, 'kqueue');
  const service = container.get(FileSystemWatcherService);
  assert.equal(service.options.parcelOptions.backend, 'kqueue');
  assert.equal(container.get(FileSystemWatcherService), service);
  const disk = new DiskFileSystemProvider(); disk.watcher = container.get(FileSystemWatcherServer); disk.logger = logger; disk.init();
  const files = new FileService(); files.preferences = { get: (key, fallback) => fallback }; files.logger = logger;
  files.encodingService = new (require('@theia/core/lib/common/encoding-service').EncodingService)();
  files.encodingRegistry = new (require('@theia/core/lib/browser/encoding-registry').EncodingRegistry)();
  files.encodingRegistry.encodingService = files.encodingService; files.encodingRegistry.preferences = files.preferences;
  files.progressService = { withProgress: async (label, place, task) => task() };
  files.labelProvider = { getLongName: resource => resource.toString() };
  files.registerProvider('file', disk);
  const tree = new FileTree(); tree.fileService = files; tree.messagingService = { error: error => assert.fail(error) };
  const rootNode = DirNode.createRoot(await files.resolve(uri(root))); rootNode.expanded = true;
  // Retained FileTreeModel event classification/affected-node routing, with only
  // the Lumino model/container lifecycle replaced by this headless node map.
  const model = Object.create(FileTreeModel.prototype); model.compressionToggle = { compress: false };
  model.tree = { root: rootNode };
  const nodes = new Map([[rootNode.uri.toString(), rootNode]]); let pending = Promise.resolve();
  model.getNode = id => nodes.get(id);
  model.refresh = node => { pending = pending.then(async () => {
    node.children = await tree.resolveChildren(node);
    for (const child of node.children) nodes.set(child.uri.toString(), child);
  }); return pending; };
  const events = []; let errors = 0;
  const listener = files.onDidFilesChange(event => { events.push(...event.changes); model.onFilesChanged(event); });
  const errorListener = disk.onFileWatchError(() => errors++);
  const watch = files.watch(uri(root), { recursive: true, excludes: ['**/excluded/**'] });
  const names = () => rootNode.children.map(node => node.uri.path.base).sort();
  try {
    await timeout(() => service.watchers.size > 0);
    await Promise.all([...service.watchers.values()].map(watcher => watcher.whenStarted));
    await files.create(uri(join(root, 'hello.cpp')));
    await timeout(() => names().includes('hello.cpp'));
    await files.write(uri(join(root, 'hello.cpp')), 'int main() { return 0; }\n');
    await timeout(() => events.some(event => event.type === 0 && event.resource.path.base === 'hello.cpp'));
    assert.equal(await readFile(join(root, 'hello.cpp'), 'utf8'), 'int main() { return 0; }\n');
    await files.move(uri(join(root, 'hello.cpp')), uri(join(root, 'renamed.cpp')));
    await timeout(() => names().includes('renamed.cpp') && !names().includes('hello.cpp'));
    await writeFile(join(root, 'external.cpp'), 'external');
    await timeout(() => names().includes('external.cpp'));
    const start = events.length;
    await writeFile(join(root, 'external.cpp'), 'external changed');
    await timeout(() => events.slice(start).some(event => event.type === 0 && event.resource.path.base === 'external.cpp'));
    await rename(join(root, 'external.cpp'), join(root, 'external-renamed.cpp'));
    await timeout(() => names().includes('external-renamed.cpp') && !names().includes('external.cpp'));
    await mkdir(join(root, '.vscode'));
    await timeout(() => names().includes('.vscode'));
    const nested = nodes.get(uri(join(root, '.vscode')).toString()); nested.expanded = true;
    await writeFile(join(root, '.vscode', 'tasks.json'), '{}');
    await timeout(() => nested.children.some(node => node.uri.path.base === 'tasks.json'));
    await files.delete(uri(join(root, 'renamed.cpp')));
    await rm(join(root, 'external-renamed.cpp'));
    await timeout(() => !names().includes('renamed.cpp') && !names().includes('external-renamed.cpp'));
    await mkdir(join(root, 'excluded')); await sleep(100);
    const before = events.length;
    await writeFile(join(root, 'excluded', 'private.txt'), 'ignored'); await sleep(250);
    assert.equal(events.slice(before).some(event => event.resource.path.base === 'private.txt'), false);
    assert.equal(errors, 0);
    assert.ok(events.every(event => event.resource.path.toString() === root || event.resource.path.toString().startsWith(root + '/')));
    console.log('Verified native kqueue -> dispatcher -> Disk provider -> FileService -> retained FileTreeModel/FileTree:', root);
  } finally {
    watch.dispose(); listener.dispose(); errorListener.dispose(); disk.dispose();
    for (const watcher of service.watchers.values()) { clearTimeout(watcher.deferredDisposalTimer); await watcher._dispose(); }
    await pending;
  }
}

if (process.env.YNX_WATCHER_TEST_CHILD) {
  test('production sandbox: real mounted-volume create/save/move/delete/external/nested/excluded events refresh retained tree', () => exercise(process.env.YNX_LOCAL_WORKSPACE));
} else {
  test('local macOS watcher operates in unchanged production sandbox on mounted volume', { skip: process.platform !== 'darwin' }, async () => {
    const base = process.env.YNX_WATCHER_TEST_BASE || '/Volumes/Data/Users/huangjiahao/.ynx-ide-build-artifacts-v2-20261005';
    const scratch = await mkdtemp(join(base, 'watcher-native-regression-'));
    const workspace = join(scratch, '原生 C++ 长目录 project'), profile = join(scratch, 'profile'), temporary = join(scratch, 'temporary');
    for (const path of [workspace, profile, temporary]) await mkdir(path);
    const runtime = { root: resolve(fileURLToPath(new URL('../../../', import.meta.url))) };
    const node = process.env.YNX_WATCHER_TEST_NODE || process.execPath;
    const input = { node, lockHelper: node, runtime, context: { workspace, profile, temporary }, port: 49159 };
    const pathIdentities = await localWorkbenchPathIdentities({ ...input, helper: process.env.YNX_WATCHER_TEST_PATH_HELPER });
    const policy = localWorkbenchSandboxPolicy({ ...input, pathIdentities });
    const result = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, node, '--test', fileURLToPath(import.meta.url)], {
      cwd: runtime.root, encoding: 'utf8', timeout: 30000,
      env: { PATH: '/usr/bin:/bin', OPENSSL_CONF: '/dev/null', HOME: profile, TMPDIR: temporary, YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: workspace, YNX_WATCHER_TEST_CHILD: '1' },
    });
    console.log(result.stdout); if (result.stderr) console.error(result.stderr);
    assert.equal(result.status, 0, JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }));
    await rm(scratch, { recursive: true });
  });
}
