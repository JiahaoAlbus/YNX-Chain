import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function fixture() {
  const operations = [], displayed = [], prompts = [], errors = [];
  let approved = false;
  const project = {
    dispose() {},
    async query(operation, approve) {
      prompts.push(operation.kind);
      if (!await approve({ operation, service: 'controlled-test-reader' })) return undefined;
      operations.push(operation);
      return { id: randomUUID(), operation, evidence: { fixture: true } };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./chain-project-ui.cjs', import.meta.url), 'utf8'), {
    module, AbortController,
    require: id => id === 'node:crypto' ? { randomUUID } : { createChainProject: () => project },
  });
  const vscode = {
    Uri: { parse: value => ({ toString: () => value }) },
    ProgressLocation: { Notification: 1 },
    workspace: { registerTextDocumentContentProvider: () => ({ dispose() {} }), openTextDocument: async uri => uri },
    window: {
      showQuickPick() { throw Error('Direct Chain action must not open the navigation picker'); },
      showWarningMessage: async (_message, _options, approve) => approved ? approve : undefined,
      showErrorMessage: error => errors.push(error),
      showTextDocument: async uri => displayed.push(uri),
      showInputBox: async () => '0x' + 'a'.repeat(40),
      withProgress: async (_options, action) => action({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    },
  };
  return { ui: module.exports.createChainProjectUI(vscode, { subscriptions: [] }, {}, text => text), operations, displayed, prompts, errors, approve() { approved = true; } };
}
test('fixed Chain actions select the exact operation while retaining query approval', async () => {
  const f = fixture();
  await f.ui.status();
  assert.deepEqual(f.prompts, ['status']); assert.equal(f.operations.length, 0); assert.equal(f.displayed.length, 0);
  f.approve(); await f.ui.status(); await f.ui.capabilities(); await f.ui.balance();
  assert.deepEqual(f.operations.map(operation => operation.kind), ['status', 'compiler', 'balance']);
  assert.equal(f.displayed.length, 3); assert.deepEqual(f.errors, []);
});
