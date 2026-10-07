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
    fileOpenMenu: ['file'], commands: { OPEN_FILE: { id: 'file' }, OPEN_FOLDER: { id: 'folder' } } });
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
