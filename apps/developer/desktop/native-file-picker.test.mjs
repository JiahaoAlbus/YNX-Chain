import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { install, workspaceMatchesRoot, NativeInitialFile } = require('../runtime/ynx-workbench/lib/native-file-picker');
function fixture(result, native = true) {
  const events = [];
  class URI { constructor(value) { this.value = value; } }
  class Contribution {
    registerMenus() { events.push('existing-menus'); }
    async doOpenFile() { events.push('browser'); }
    async doOpenFolder() { events.push('browser-folder'); }
    async doOpenWorkspace() { events.push('browser-workspace'); }
    async doOpen() { events.push('browser-any'); }
  }
  const target = native ? { ynxDesktopFiles: { open: async options => { events.push(options.kind); return result; } } } : {};
  install({ Contribution, URI, open: async (_, uri) => events.push(['editor', uri.value]), parse: JSON.parse, target, localize: (_, t) => t,
    fileOpenMenu: ['file'], commands: { OPEN_FILE: { id: 'file' }, OPEN_FOLDER: { id: 'folder' } }, getCurrentEditor: () => instance.editorManager?.currentEditor });
  const instance = new Contribution();
  instance.fileService = { resolve: async () => ({ isFile: true }), readFile: async () => ({ value: Buffer.from('{"folders":[{"path":"."}]}') }) };
  instance.workspaceService = { open: async uri => events.push(['workspace', uri.value]) };
  instance.messageService = { error: async text => events.push(['error', text]) };
  return { events, instance, target, URI };
}
test('native cancel and foreign-window launch never access the old filesystem or navigate', async () => {
  for (const result of [{ cancelled: true }, { openedInNewWindow: true }]) {
    const { events, instance } = fixture(result);
    instance.fileService = new Proxy({}, { get() { throw Error('old backend must not be accessed'); } });
    for (const method of ['doOpen', 'doOpenFile', 'doOpenFolder', 'doOpenWorkspace']) assert.equal(await instance[method](), undefined);
    assert.deepEqual(events, ['any', 'file', 'folder', 'workspace']);
  }
});
test('native current-root file opens editor; normal browser mode is untouched', async () => {
  const { events, instance } = fixture({ uris: ['file:///qa/hello.cpp'], rootUri: 'file:///qa' });
  await instance.doOpenFile(); assert.deepEqual(events, ['file', ['editor', 'file:///qa/hello.cpp']]);
  const browser = fixture(null, false); await browser.instance.doOpenFile(); assert.deepEqual(browser.events, ['browser']);
});
test('native menu adds explicit file/folder actions without removing existing entries', () => {
  const { events, instance } = fixture({ cancelled: true });
  instance.registerMenus({ registerMenuAction: (_, action) => events.push(action.commandId) });
  assert.deepEqual(events, ['existing-menus', 'file', 'folder']);
});
test('single-root workspace opens; foreign root, multi-root, URI and traversal reject', async () => {
  assert.equal(workspaceMatchesRoot({ folders: [{ path: '.' }] }, 'file:///qa/a.code-workspace', 'file:///qa'), true);
  for (const data of [{ folders: [{ path: '../qa' }] }, { folders: [{ path: '/other' }] }, { folders: [{ uri: 'file:///qa' }] }, { folders: [{ path: '.' }, { path: '.' }] }]) {
    assert.equal(workspaceMatchesRoot(data, 'file:///qa/a.code-workspace', 'file:///qa'), false);
  }
  const f = fixture({ uris: ['file:///qa/a.code-workspace'], rootUri: 'file:///qa' });
  await f.instance.doOpenWorkspace(); assert.deepEqual(f.events, ['workspace', ['workspace', 'file:///qa/a.code-workspace']]);
  const rejected = fixture({ uris: ['file:///qa/sub/a.code-workspace'], rootUri: 'file:///qa' });
  await rejected.instance.doOpenWorkspace(); assert.equal(rejected.events[1][0], 'error');
});
test('native initial file waits for root readiness then activates editor, once from bridge', async () => {
  const events = []; let release; let initial = 'file:///other/hello.cpp';
  const target = { ynxDesktopFiles: { takeInitialFile() { const value = initial; initial = null; return value; } } };
  const ready = new Promise(resolve => { release = resolve; });
  class URI { constructor(value) { this.value = value; } }
  const contribution = new NativeInitialFile({ open: async (uri, options) => events.push([uri.value, options.mode]) }, { ready }, { error: assert.fail }, target, URI);
  const pending = contribution.onDidInitializeLayout(); assert.deepEqual(events, []); release(); await pending; await contribution.onDidInitializeLayout();
  assert.deepEqual(events, [['file:///other/hello.cpp', 'activate']]);
});

test('native canonical boundary rejects sibling-prefix/symlink escape and invalid initial files', async t => {
  if (process.platform !== 'darwin') return t.skip('Cocoa boundary runs on macOS');
  const { mkdtemp, writeFile, mkdir, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'ynx-native-picker-boundary-'));
  try {
    await mkdir(join(directory, 'project')); await mkdir(join(directory, 'outside'));
    await writeFile(join(directory, 'project', 'hello.cpp'), 'int main(){}');
    await writeFile(join(directory, 'outside', 'other.cpp'), 'int main(){}');
    await symlink(join(directory, 'outside', 'other.cpp'), join(directory, 'project', 'escape.cpp'));
    await writeFile(join(directory, 'test.m'), `#import "ynx-native-file-picker.h"
#include <assert.h>
int main(int argc,const char **argv){@autoreleasepool{
NSString *base=YNXNativePickedPath([NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]]);
NSString *root=[base stringByAppendingPathComponent:@"project"];
NSString *file=[root stringByAppendingPathComponent:@"hello.cpp"];
assert(YNXNativePathInside(file,root));
assert(!YNXNativePathInside([root stringByAppendingString:@"-other/hello.cpp"],root));
NSString *escape=YNXNativePickedPath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"escape.cpp"]]);
assert(!YNXNativePathInside(escape,root));
assert([YNXNativeInitialFile(file,root,@"native-panel") isEqual:file]);
assert(!YNXNativeInitialFile(file,root,@"url"));
assert(!YNXNativeInitialFile(escape,root,@"native-panel"));
assert(!YNXNativeInitialFile(root,root,@"native-panel"));
assert(!YNXNativePickedPath([NSURL URLWithString:@"https://example.com/file"]));
assert([YNXNativeSavePath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"new.cpp"]],root) isEqual:[root stringByAppendingPathComponent:@"new.cpp"]]);
assert([YNXNativeSavePath([NSURL fileURLWithPath:file],root) isEqual:file]);
assert(!YNXNativeSavePath([NSURL fileURLWithPath:root],root));
assert(!YNXNativeSavePath([NSURL fileURLWithPath:[base stringByAppendingPathComponent:@"outside/new.cpp"]],root));
assert(!YNXNativeSavePath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"escape.cpp"]],root));
assert(!YNXNativeSavePath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"missing/new.cpp"]],root));
NSDictionary *save=@{@"action":@"save-file",@"name":@"你好.cpp",@"requestId":NSUUID.UUID.UUIDString};
assert(YNXNativeSavePayload(save));
NSMutableDictionary *badSave=[save mutableCopy];badSave[@"name"]=@"../other.cpp";assert(!YNXNativeSavePayload(badSave));
badSave[@"name"]=@"..";assert(!YNXNativeSavePayload(badSave));
badSave[@"name"]=@"ok.cpp";badSave[@"root"]=root;assert(!YNXNativeSavePayload(badSave));
NSDictionary *body=@{@"action":@"pick-file",@"kind":@"file",@"requestId":NSUUID.UUID.UUIDString};
assert(YNXNativePickerPayload(body));
NSMutableDictionary *bad=[body mutableCopy];bad[@"path"]=file;assert(!YNXNativePickerPayload(bad));
[bad removeObjectForKey:@"path"];bad[@"kind"]=@"execute";assert(!YNXNativePickerPayload(bad));
}return 0;}`);
    const compiled = spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-fobjc-arc', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-I', resolve('apps/developer/desktop/macos'), join(directory, 'test.m'), '-framework', 'Foundation', '-o', join(directory, 'test')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(join(directory, 'test'), [directory], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('injected picker bridge settles cancellation and ignores late replies before retry', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('./macos/main.m', import.meta.url), 'utf8');
  const injected = source.match(/NSString \*fileScript=\[NSString stringWithFormat:@"(.*)",YNXJSON/)[1].replace('%@', 'null');
  const requests = [], listeners = {};
  let sequence = 0;
  const window = { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => requests.push(value) } } } };
  runInNewContext(injected, { window, location: { pathname: '/' }, crypto: { randomUUID: () => String(++sequence) }, addEventListener: (name, fn) => { listeners[name] = fn; } });
  const first = window.ynxDesktopFiles.open({ kind: 'file' });
  window.__ynxNativeFileReply({ requestId: requests[0].requestId, cancelled: true });
  assert.equal((await first).cancelled, true);
  const second = window.ynxDesktopFiles.open({ kind: 'folder' });
  window.__ynxNativeFileReply({ requestId: requests[0].requestId, uris: ['file:///wrong'] });
  window.__ynxNativeFileReply({ requestId: requests[1].requestId, cancelled: true });
  assert.equal((await second).cancelled, true);
  const third = window.ynxDesktopFiles.open({ kind: 'workspace' });
  listeners.pagehide();
  await assert.rejects(third, /document closed/);
  assert.equal(requests.length, 3);
});

const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function currentOpenFixture() {
  const f = fixture({ uris: ['file:///qa/selected.cpp'], rootUri: 'file:///qa' });
  f.instance.workspaceService.workspace = { resource: 'file:///qa' };
  f.instance.workspaceService.tryGetRoots = () => [f.root]; f.root = { resource: 'file:///qa' };
  let version = 1;
  f.document = { textEditorModel: { getVersionId: () => version }, isDisposed: () => false };
  f.widget = { isDisposed: false, editor: { document: f.document, uri: { toString: () => 'file:///qa/unsaved.cpp' } } };
  f.instance.editorManager = { currentEditor: f.widget };
  f.edit = () => { version += 1; };
  return f;
}
test('R34 root change while native panel is pending never reads old backend', async () => {
  const f = currentOpenFixture(), panel = held(); f.target.ynxDesktopFiles.open = () => panel.promise;
  const pending = f.instance.doOpenFile(); f.instance.workspaceService.workspace = { resource: 'file:///new' }; f.root = { resource: 'file:///new' };
  f.instance.fileService.resolve = async () => { f.events.push('STALE-read'); return { isFile: true }; };
  panel.resolve({ uris: ['file:///qa/old.cpp'], rootUri: 'file:///qa' }); await pending; assert.deepEqual(f.events, []);
});
test('R34 switched editor while file stat is pending cannot be replaced by stale open', async () => {
  const f = currentOpenFixture(), stat = held(); f.instance.fileService.resolve = () => stat.promise;
  const pending = f.instance.doOpenFile(); await Promise.resolve(); f.instance.editorManager.currentEditor = { editor: { document: {} } };
  stat.resolve({ isFile: true }); await pending; assert.deepEqual(f.events, ['file']);
});
test('R34 newer open request wins over older file resolve in same editor', async () => {
  const f = currentOpenFixture(), stat = held(); let call = 0;
  f.target.ynxDesktopFiles.open = async () => ({ uris: [`file:///qa/${++call}.cpp`], rootUri: 'file:///qa' });
  f.instance.fileService.resolve = async uri => uri.value.endsWith('/1.cpp') ? stat.promise : { isFile: true };
  const first = f.instance.doOpenFile(); await Promise.resolve(); await f.instance.doOpenFile(); stat.resolve({ isFile: true }); await first;
  assert.deepEqual(f.events, [['editor', 'file:///qa/2.cpp']]);
});
test('R34 editing current document during workspace read cancels stale navigation without altering draft', async () => {
  const f = currentOpenFixture(), content = held(); f.instance.fileService.resolve = async () => ({ isFile: true, size: 20 }); f.instance.fileService.readFile = () => content.promise;
  f.target.ynxDesktopFiles.open = async () => ({ uris: ['file:///qa/current.code-workspace'], rootUri: 'file:///qa' });
  const pending = f.instance.doOpenWorkspace(); await Promise.resolve(); await Promise.resolve(); f.edit();
  content.resolve({ value: Buffer.from('{"folders":[{"path":"."}]}') }); await pending; assert.deepEqual(f.events, []); assert.equal(f.document.textEditorModel.getVersionId(), 2);
});
test('R34 disposed originating editor cannot receive late file error', async () => {
  const f = currentOpenFixture(), stat = held(); f.instance.fileService.resolve = () => stat.promise;
  const pending = f.instance.doOpenFile(); await Promise.resolve(); f.widget.isDisposed = true;
  stat.reject(Error('TEST_ONLY_old_file_error')); await pending; assert.deepEqual(f.events, ['file']);
});
test('R34 current original open and current first error remain functional', async () => {
  const good = currentOpenFixture(); await good.instance.doOpenFile(); assert.deepEqual(good.events, ['file', ['editor', 'file:///qa/selected.cpp']]);
  const failed = currentOpenFixture(); failed.instance.fileService.resolve = async () => { throw Error('TEST_ONLY_exact_original_error'); };
  await failed.instance.doOpenFile(); assert.deepEqual(failed.events, ['file', ['error', 'TEST_ONLY_exact_original_error']]);
});
