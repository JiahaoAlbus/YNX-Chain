import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
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
  // Theia exposes stable FileStat entries through tryGetRoots() while the
  // project is unchanged. Native Open now snapshots those entries.
  const roots = [{ resource: new URI('file:///qa'), isDirectory: true }];
  instance.workspaceService = {
    tryGetRoots: () => roots,
    open: async uri => events.push(['workspace', uri.value]),
  };
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
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'ynx-native-picker-boundary-'));
  try {
    await mkdir(join(directory, 'project', 'src space'), { recursive: true }); await mkdir(join(directory, 'outside'));
    await writeFile(join(directory, 'project', 'hello.cpp'), 'int main(){}');
    await writeFile(join(directory, 'outside', 'other.cpp'), 'int main(){}');
    await symlink(join(directory, 'outside', 'other.cpp'), join(directory, 'project', 'escape.cpp'));
    await symlink(join(directory, 'outside'), join(directory, 'project', 'dir-escape'));
    await symlink(join(directory, 'project', 'src space'), join(directory, 'project', 'dir-alias'));
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
assert([YNXNativeSavePath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"new.js"]],root) isEqual:[root stringByAppendingPathComponent:@"new.js"]]);
assert(!YNXNativeSavePath([NSURL fileURLWithPath:[base stringByAppendingPathComponent:@"outside/new.js"]],root));
assert(!YNXNativeSavePath([NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"escape.cpp"]],root));
assert(!YNXNativeSavePath([NSURL fileURLWithPath:root],root));
NSString *src=[root stringByAppendingPathComponent:@"src space"];
struct stat rootIdentity;assert(lstat(root.fileSystemRepresentation,&rootIdentity)==0);
assert(YNXNativeCreateEntry(root,src,@"hello.py",NO,&rootIdentity)==0);
assert(YNXNativeCreateEntry(root,src,@"hello.go",NO,&rootIdentity)==0);
NSDictionary *binding=@{@"workspace":root};
YNXNativeCreateLease *lease=YNXNativePrepareCreate(binding,@"prepared.py",src,&rootIdentity,NO,7,@"document");
assert(lease&&![NSFileManager.defaultManager fileExistsAtPath:[src stringByAppendingPathComponent:@"prepared.py"]]);
assert(YNXNativeCreateLeaseCurrent(lease,7,@"document",lease.expires-1));
assert(!YNXNativeCreateLeaseCurrent(lease,8,@"document",lease.expires-1));
assert(!YNXNativeCreateLeaseCurrent(lease,7,@"changed",lease.expires-1));
assert(!YNXNativeCreateLeaseCurrent(lease,7,@"document",lease.expires));
NSDictionary *metadata=nil;
assert(YNXNativeCommitCreate(root,src,lease.name,NO,&lease->rootIdentity,&lease->parentIdentity,&metadata)==0);
assert([metadata[@"type"] intValue]==1&&[metadata[@"size"] longLongValue]==0);
assert(YNXNativeCommitCreate(root,src,lease.name,NO,&lease->rootIdentity,&lease->parentIdentity,NULL)==EEXIST);
NSString *replace=[root stringByAppendingPathComponent:@"replace"];
assert(mkdir(replace.fileSystemRepresentation,0700)==0);
YNXNativeCreateLease *stale=YNXNativePrepareCreate(binding,@"wrong.go",replace,&rootIdentity,NO,7,@"document");
assert(stale);
NSString *renamed=[root stringByAppendingPathComponent:@"renamed"];
assert(rename(replace.fileSystemRepresentation,renamed.fileSystemRepresentation)==0);
assert(mkdir(replace.fileSystemRepresentation,0700)==0);
assert(YNXNativeCommitCreate(root,replace,stale.name,NO,&stale->rootIdentity,&stale->parentIdentity,NULL)==EINVAL);
assert(![NSFileManager.defaultManager fileExistsAtPath:[replace stringByAppendingPathComponent:stale.name]]);
assert(![NSFileManager.defaultManager fileExistsAtPath:[renamed stringByAppendingPathComponent:stale.name]]);
assert(YNXNativeCreateTokenPayload(@{@"action":@"commit-create",@"requestId":NSUUID.UUID.UUIDString,@"token":lease.token}));
assert(!YNXNativeCreateTokenPayload(@{@"action":@"commit-create",@"requestId":NSUUID.UUID.UUIDString,@"token":lease.token,@"path":replace}));
NSString *python=[src stringByAppendingPathComponent:@"hello.py"];
assert([@"print('saved')" writeToFile:python atomically:YES encoding:NSUTF8StringEncoding error:nil]);
assert(YNXNativeCreateEntry(root,src,@"hello.py",NO,&rootIdentity)==EEXIST);
assert([[NSString stringWithContentsOfFile:python encoding:NSUTF8StringEncoding error:nil] isEqual:@"print('saved')"]);
assert(YNXNativeCreateEntry(root,src,@"folder",YES,&rootIdentity)==0);
assert(YNXNativeCreateEntry(root,src,@"folder",YES,&rootIdentity)==EEXIST);
assert(YNXNativeCreateEntry(root,src,@"folder",NO,&rootIdentity)==EEXIST);
assert(YNXNativeCreateEntry(root,src,@"../outside",NO,&rootIdentity)==EINVAL);
assert(YNXNativeCreateEntry(root,[base stringByAppendingPathComponent:@"outside"],@"escape.py",NO,&rootIdentity)==EINVAL);
assert(YNXNativeCreateEntry(root,[root stringByAppendingPathComponent:@"dir-alias"],@"alias.go",NO,&rootIdentity)!=0);
assert(YNXNativeCreateEntry(root,root,@"escape.cpp",NO,&rootIdentity)==EEXIST);
struct stat wrongRootIdentity=rootIdentity;wrongRootIdentity.st_ino++;
assert(YNXNativeCreateEntry(root,src,@"stale.py",NO,&wrongRootIdentity)==EINVAL);
assert(![NSFileManager.defaultManager fileExistsAtPath:[src stringByAppendingPathComponent:@"stale.py"]]);
assert([YNXNativeSaveDirectory(nil,root) isEqual:root]);
assert([YNXNativeSaveDirectory([NSURL fileURLWithPath:root isDirectory:YES].absoluteString,root) isEqual:root]);
assert([YNXNativeSaveDirectory([NSURL fileURLWithPath:src isDirectory:YES].absoluteString,root) isEqual:src]);
for(NSString *leaf in @[@"missing",@"hello.cpp",@"dir-escape",@"dir-alias"]){
 assert(!YNXNativeSaveDirectory([NSURL fileURLWithPath:[root stringByAppendingPathComponent:leaf]].absoluteString,root));
}
assert(!YNXNativeSaveDirectory([NSURL fileURLWithPath:[base stringByAppendingPathComponent:@"outside"]].absoluteString,root));
assert(!YNXNativeSaveDirectory(@"file://foreign/project",root));
assert(!YNXNativeSaveDirectory(@"https://example.com/project",root));
assert(!YNXNativeSaveDirectory(@"file:relative",root));
assert(!YNXNativeSaveDirectory([[NSURL fileURLWithPath:root].absoluteString stringByAppendingString:@"?changed"],root));
assert(!YNXNativeSaveDirectory([[NSURL fileURLWithPath:root].absoluteString stringByAppendingString:@"/%00bad"],root));
NSDictionary *body=@{@"action":@"pick-file",@"kind":@"file",@"requestId":NSUUID.UUID.UUIDString};
assert(YNXNativePickerPayload(body));
NSDictionary *save=@{@"action":@"pick-file",@"kind":@"save",@"requestId":NSUUID.UUID.UUIDString,@"name":@"hello.js"};
assert(YNXNativeSavePickerPayload(save));assert(!YNXNativePickerPayload(save));
NSMutableDictionary *withDirectory=[save mutableCopy];withDirectory[@"directoryUri"]=[NSURL fileURLWithPath:src].absoluteString;
assert(YNXNativeSavePickerPayload(withDirectory));assert(!YNXNativePickerPayload(withDirectory));
withDirectory[@"kind"]=@"create";assert(YNXNativeSavePickerPayload(withDirectory));
withDirectory[@"kind"]=@"create-folder";assert(YNXNativeSavePickerPayload(withDirectory));
withDirectory[@"action"]=@"prepare-create";assert(YNXNativeSavePickerPayload(withDirectory));
withDirectory[@"kind"]=@"save";assert(!YNXNativeSavePickerPayload(withDirectory));
withDirectory[@"action"]=@"pick-file";withDirectory[@"kind"]=@"create-folder";
withDirectory[@"extra"]=@"reject";assert(!YNXNativeSavePickerPayload(withDirectory));[withDirectory removeObjectForKey:@"extra"];
withDirectory[@"directoryUri"]=@"";assert(!YNXNativeSavePickerPayload(withDirectory));
withDirectory[@"directoryUri"]=@42;assert(!YNXNativeSavePickerPayload(withDirectory));
NSMutableDictionary *badSave=[save mutableCopy];badSave[@"name"]=@"../escape.js";assert(!YNXNativeSavePickerPayload(badSave));
badSave[@"name"]=@"hello.js";badSave[@"path"]=file;assert(!YNXNativeSavePickerPayload(badSave));
NSMutableDictionary *bad=[body mutableCopy];bad[@"path"]=file;assert(!YNXNativePickerPayload(bad));
[bad removeObjectForKey:@"path"];bad[@"kind"]=@"execute";assert(!YNXNativePickerPayload(bad));
}return 0;}`);
    const includeDirectory = fileURLToPath(new URL('./macos/', import.meta.url));
    const compiled = spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-fobjc-arc', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-I', includeDirectory, join(directory, 'test.m'), '-framework', 'Foundation', '-o', join(directory, 'test')], { encoding: 'utf8' });
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
test('injected native save rejects malformed names before dispatch and settles the selected destination once',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('./macos/main.m',import.meta.url),'utf8');
 const injected=source.match(/NSString \*fileScript=\[NSString stringWithFormat:@"(.*)",YNXJSON/)[1].replace('%@','null');
 const requests=[],window={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>requests.push(value)}}}};
 runInNewContext(injected,{window,location:{pathname:'/'},crypto:{randomUUID:()=> 'save-request'},TextEncoder,addEventListener(){}});
 for(const name of ['', '.', '..','../escape.js','bad\\name.js','line\nname.js','bad\u0000name.js','汉'.repeat(86)])await assert.rejects(window.ynxDesktopFiles.open({kind:'save',name}),/Invalid file name/);
 assert.equal(requests.length,0);
 const saving=window.ynxDesktopFiles.open({kind:'save',name:'hello.js'});
 assert.equal(requests.length,1);assert.equal(requests[0].name,'hello.js');assert.equal(requests[0].kind,'save');assert.equal(Object.hasOwn(requests[0],'directoryUri'),false);
 window.__ynxNativeFileReply({requestId:'save-request',uris:['file:///project/hello.js']});
 assert.equal((await saving).uris[0],'file:///project/hello.js');
 window.__ynxNativeFileReply({requestId:'save-request',error:'late'});
 for(const directoryUri of [null, '', 7, 'a'.repeat(16385)])await assert.rejects(window.ynxDesktopFiles.open({kind:'save',name:'hello.js',directoryUri}),/Invalid starting directory/);
 await assert.rejects(window.ynxDesktopFiles.open({kind:'file',directoryUri:'file:///project/src'}),/Invalid starting directory/);
 assert.equal(requests.length,1);
 const creating=window.ynxDesktopFiles.open({kind:'save',name:'hello.js',directoryUri:'file:///project/src%20space'});
 assert.equal(requests[1].directoryUri,'file:///project/src%20space');
 await assert.rejects(window.ynxDesktopFiles.open({kind:'save',name:'another.js',directoryUri:'file:///another/src'}),/already pending/);
 assert.equal(requests.length,2);
 window.__ynxNativeFileReply({requestId:'save-request',cancelled:true});
 assert.equal((await creating).cancelled,true);
 for(const [kind,name] of [['create','hello.py'],['create','hello.go'],['create-folder','scripts']]){
  await assert.rejects(window.ynxDesktopFiles.open({kind,name:'../invalid'}),/Invalid file name/);
  const pending=window.ynxDesktopFiles.open({kind,name,directoryUri:'file:///project/src'});
  assert.equal(requests.at(-1).kind,kind);
  assert.equal(requests.at(-1).name,name);
  const uri='file:///project/src/'+name;
  window.__ynxNativeFileReply({requestId:'save-request',created:true,uris:[uri],rootUri:'file:///project/'});
  assert.equal((await pending).uris[0],uri);
 }
});

test('native creation bridge sends only the token on commit and distinguishes a lost commit receipt', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('./macos/main.m', import.meta.url), 'utf8');
  const injected = source.match(/NSString \*fileScript=\[NSString stringWithFormat:@"(.*)",YNXJSON/)[1].replace('%@', 'null');
  const requests = [];
  const window = { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: request => requests.push(request) } } } };
  let sequence = 0;
  let expire;
  const token = '067bb486-f70c-4305-995b-a0698747eb9d';
  runInNewContext(injected, {
    window, location: { pathname: '/' }, crypto: { randomUUID: () => String(++sequence) }, TextEncoder,
    setTimeout: fn => { expire = fn; return 1; }, clearTimeout() {}, addEventListener() {},
  });
  assert.equal(window.ynxDesktopFiles.createProtocol, 1);
  const preparation = window.ynxDesktopFiles.prepareCreate({ kind: 'create', name: 'main.py', directoryUri: 'file:///example' });
  assert.equal(requests[0].action, 'prepare-create');
  window.__ynxNativeFileReply({ requestId: requests[0].requestId, prepared: true, token });
  assert.equal((await preparation).token, token);
  const commit = window.ynxDesktopFiles.commitCreate(token);
  assert.deepEqual(Object.keys(requests[1]).sort(), ['action', 'requestId', 'token']);
  assert.equal(requests[1].action, 'commit-create');
  expire();
  await assert.rejects(commit, { code: 'NATIVE_CREATE_UNKNOWN' });
  window.__ynxNativeFileReply({ requestId: requests[1].requestId, created: true });
  const cancel = window.ynxDesktopFiles.cancelCreate(token);
  assert.equal(requests[2].action, 'cancel-create');
  window.__ynxNativeFileReply({ requestId: requests[2].requestId, cancelled: true });
  assert.equal((await cancel).cancelled, true);
});
