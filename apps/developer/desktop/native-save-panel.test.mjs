import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installProjectSaveDefault } = require('../runtime/ynx-workbench/lib/native-file-picker');
function fixture(native = true) {
  const calls = []; let finish, version = 1;
  class URI {
    constructor(value) { this.value = value; this.scheme = value.split(':')[0]; }
    toString() { return this.value; }
    isEqualOrParent(other) { return other.value === this.value || other.value.startsWith(this.value + '/'); }
  }
  const root = { resource: new URI('file:///qa') };
  const document = { textEditorModel: { getVersionId: () => version } };
  const editor = { editor: { document, uri: new URI('untitled:Untitled-1') } };
  const editors = { currentEditor: editor }, workspace = { workspace: root, tryGetRoots: () => [root] };
  const target = native ? { ynxDesktopFiles: { save: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); } } } : {};
  const dialogs = { showSaveDialog: async (...args) => { calls.push(['html', ...args]); return 'browser-result'; } };
  installProjectSaveDefault({ dialogs, editors, workspace, fileService: {}, target, URI });
  return { dialogs, calls, editors, workspace, root, target, edit: () => version++, finish: value => finish(value) };
}
test('first save uses native panel and returns selected URI without opening HTML dialog', async () => {
  const f = fixture(), pending = f.dialogs.showSaveDialog({ inputValue: 'hello.cpp' });
  assert.deepEqual(f.calls, [{ name: 'hello.cpp' }]);
  f.finish({ uri: 'file:///qa/hello.cpp', rootUri: 'file:///qa/' });
  assert.equal((await pending).toString(), 'file:///qa/hello.cpp');
});
test('cancel leaves the unsaved document untouched and permits retry', async () => {
  const f = fixture();
  const first = f.dialogs.showSaveDialog({}); f.finish({ cancelled: true }); assert.equal(await first, undefined);
  const next = f.dialogs.showSaveDialog({}); f.finish({ uri: 'file:///qa/retry.cpp', rootUri: 'file:///qa' });
  assert.equal((await next).toString(), 'file:///qa/retry.cpp');
});
test('repeated Save while the native panel is open cannot invalidate its original selection', async () => {
  const f = fixture(); let finish, nativeCalls = 0;
  f.target.ynxDesktopFiles.save = () => {
    nativeCalls++;
    if (nativeCalls > 1) throw Error('A file selection is already pending or invalid.');
    return new Promise(resolve => { finish = resolve; });
  };
  const first = f.dialogs.showSaveDialog({ inputValue: 'original.cpp' });
  assert.equal(await f.dialogs.showSaveDialog({ inputValue: 'duplicate.cpp' }), undefined);
  assert.equal(nativeCalls, 1);
  finish({ uri: 'file:///qa/original.cpp', rootUri: 'file:///qa' });
  assert.equal((await first).toString(), 'file:///qa/original.cpp');
});
test('late save selection cannot save a changed document, switched editor, root or bridge', async () => {
  for (const mutate of [f => f.edit(), f => { f.editors.currentEditor = {}; }, f => { f.workspace.workspace = {}; }, f => { f.target.ynxDesktopFiles = {}; }]) {
    const f = fixture(), pending = f.dialogs.showSaveDialog({}); mutate(f);
    f.finish({ uri: 'file:///qa/stale.cpp', rootUri: 'file:///qa' }); assert.equal(await pending, undefined);
  }
});
test('foreign, malformed and missing native destinations cannot become backend save paths', async () => {
  for (const result of [{ uri: 'file:///qa-other/x', rootUri: 'file:///qa' }, { uri: 'file:///qa/x', rootUri: 'file:///other' }, { uri: 'https://example.com/x', rootUri: 'file:///qa' }, {}]) {
    const f = fixture(), pending = f.dialogs.showSaveDialog({}); f.finish(result);
    assert.equal(await pending, undefined);
  }
});
test('browser Save As retains its existing dialog', async () => {
  const f = fixture(false); assert.equal(await f.dialogs.showSaveDialog({}), 'browser-result');
  assert.equal(f.calls[0][0], 'html');
});
test('native injected save bridge settles cancel, rejects path injection and ignores old replies', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('./macos/main.m', import.meta.url), 'utf8');
  const injected = source.match(/NSString \*fileScript=\[NSString stringWithFormat:@"(.*)",YNXJSON/)[1].replace('%@', 'null');
  const calls = []; let sequence = 0;
  const window = { webkit: { messageHandlers: { ynxLocalWorkbench: { postMessage: value => calls.push(value) } } } };
  runInNewContext(injected, { window, location: { pathname: '/' }, crypto: { randomUUID: () => String(++sequence) }, TextEncoder, addEventListener() {} });
  await assert.rejects(window.ynxDesktopFiles.save({ name: '../outside' }), /invalid/);
  const first = window.ynxDesktopFiles.save({ name: '你好.cpp' });
  assert.equal(calls[0].action, 'save-file'); assert.equal(calls[0].name, '你好.cpp');
  await assert.rejects(window.ynxDesktopFiles.open({ kind: 'file' }), /pending/);
  window.__ynxNativeFileReply({ requestId: calls[0].requestId, cancelled: true }); assert.equal((await first).cancelled, true);
  const next = window.ynxDesktopFiles.save({ name: 'retry.cpp' });
  window.__ynxNativeFileReply({ requestId: calls[0].requestId, uri: 'file:///wrong' });
  window.__ynxNativeFileReply({ requestId: calls[1].requestId, uri: 'file:///qa/retry.cpp' });
  assert.equal((await next).uri, 'file:///qa/retry.cpp');
});
