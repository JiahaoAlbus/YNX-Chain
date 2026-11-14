import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { nativePasteMerge } = require('../../ynx-workbench/lib/native-paste-adapter');
const source = readFileSync(new URL('../node_modules/@theia/monaco-editor-core/esm/vs/editor/contrib/dropOrPasteInto/browser/copyPasteController.js', import.meta.url), 'utf8');
const start = source.indexOf('    async mergeInDataFromCopy(');
const end = source.indexOf('    async getPasteEdits(', start);
assert.ok(start >= 0 && end > start, 'installed Monaco merge method must exist');
function fixture(native = true, operations = []) {
  const owner = { _currentCopyOperation: { handle: 'own-copy', operations } };
  const merge = vm.runInNewContext('({' + source.slice(start, end) + '}).mergeInDataFromCopy', {
    CopyPasteController_1: owner, Mimes: { uriList: 'text/uri-list' },
    matchesMimeType: (pattern, types) => Array.isArray(types) ? types.includes(pattern) : pattern === types,
    createStringDataTransferItem: value => value,
    UriList: { create: resources => resources.join('\r\n') },
  });
  let reads = 0;
  const clipboard = { readResources: async () => { reads++; return ['file:///browser-clipboard']; } };
  const controller = { _clipboardService: clipboard, _logService: { trace() {} } };
  const transfer = new Map([['text/plain', 'synthetic own text']]);
  transfer.replace = transfer.set; transfer.append = transfer.set;
  return { owner, clipboard, controller, transfer, original: merge, merge: nativePasteMerge(merge, () => native), reads: () => reads };
}
test('installed upstream reproduces the denied enrichment failure; native event route does not read again', async () => {
  const f = fixture(); let deniedReads = 0;
  f.clipboard.readResources = async () => { deniedReads++; throw new DOMException('Synthetic denied second read', 'NotAllowedError'); };
  await assert.rejects(f.original.call(f.controller, [], f.transfer, undefined, {}), { name: 'NotAllowedError' });
  assert.equal(deniedReads, 1);
  await f.merge.call(f.controller, [], f.transfer, undefined, {});
  assert.equal(deniedReads, 1); assert.equal(f.transfer.get('text/plain'), 'synthetic own text');
});
test('native plain-text event completes without a second clipboard access or invented URI', async () => {
  const f = fixture();
  await f.merge.call(f.controller, [], f.transfer, undefined, { isCancellationRequested: false });
  assert.equal(f.reads(), 0); assert.equal(f.transfer.get('text/plain'), 'synthetic own text');
  assert.equal(f.transfer.has('text/uri-list'), false); assert.equal(f.controller._clipboardService, f.clipboard);
});
test('genuine event URI and provider metadata merge retain original precedence', async () => {
  const f = fixture(true, [{ providerMimeTypes: ['text/plain'], operation: Promise.resolve(new Map([['text/plain', 'provider text'], ['text/uri-list', 'file:///own-event']])) }]);
  await f.merge.call(f.controller, [{ pasteMimeTypes: ['text/plain'] }], f.transfer, { id: 'own-copy' }, { isCancellationRequested: false });
  assert.equal(f.transfer.get('text/plain'), 'provider text'); assert.equal(f.transfer.get('text/uri-list'), 'file:///own-event'); assert.equal(f.reads(), 0);
  const event = fixture(); event.transfer.set('text/uri-list', 'https://example.test/own');
  await event.merge.call(event.controller, [], event.transfer, undefined, { isCancellationRequested: false });
  assert.equal(event.transfer.get('text/uri-list'), 'https://example.test/own'); assert.equal(event.reads(), 0);
});
test('browser clipboard behavior and upstream cancellation remain unchanged', async () => {
  const browser = fixture(false);
  await browser.merge.call(browser.controller, [], browser.transfer, undefined, { isCancellationRequested: false });
  assert.equal(browser.reads(), 1); assert.equal(browser.transfer.get('text/uri-list'), 'file:///browser-clipboard');
  const cancelled = fixture(true, [{ providerMimeTypes: ['text/plain'], operation: Promise.resolve(new Map([['text/plain', 'late edit']])) }]);
  await cancelled.merge.call(cancelled.controller, [{ pasteMimeTypes: ['text/plain'] }], cancelled.transfer, { id: 'own-copy' }, { isCancellationRequested: true });
  assert.equal(cancelled.transfer.get('text/plain'), 'synthetic own text'); assert.equal(cancelled.reads(), 0);
});
test('concurrent native and browser merges never swap shared clipboard service', async () => {
  const f = fixture(), browser = fixture(false);
  browser.controller._clipboardService = f.clipboard;
  await Promise.all([f.merge.call(f.controller, [], f.transfer, undefined, {}), browser.merge.call(browser.controller, [], browser.transfer, undefined, {})]);
  assert.equal(f.controller._clipboardService, f.clipboard); assert.equal(browser.controller._clipboardService, f.clipboard);
  assert.equal(f.reads(), 1); assert.equal(f.transfer.has('text/uri-list'), false); assert.equal(browser.transfer.has('text/uri-list'), true);
});
test('provider failures stay failures and missing pinned implementation fails closed', async () => {
  assert.throws(() => nativePasteMerge(undefined, () => true), /pinned Monaco/);
  const f = fixture(true, [{ providerMimeTypes: ['text/plain'], operation: Promise.reject(Error('provider failed')) }]);
  await assert.rejects(f.merge.call(f.controller, [{ pasteMimeTypes: ['text/plain'] }], f.transfer, { id: 'own-copy' }, {}), /provider failed/);
  assert.equal(f.reads(), 0); assert.equal(f.transfer.get('text/plain'), 'synthetic own text');
});
