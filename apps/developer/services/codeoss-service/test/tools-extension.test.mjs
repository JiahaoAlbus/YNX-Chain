import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const localRequire = createRequire(import.meta.url), source = await readFile(new URL('../../../native/ynx-tools/src/extension.cjs', import.meta.url), 'utf8');
const { digest } = localRequire('../../../native/ynx-tools/src/guards.cjs');
function harness({ answer, exists = false, onModal } = {}) {
  const commands = new Map(), errors = [], calls = [], id = '12345678-1234-1234-1234-123456789012';
  class FileSystemError extends Error { constructor() { super('absent'); this.code = 'FileNotFound'; } }
  let text = 'saved draft', version = 1;
  const uri = { fsPath: '/project/a.ts', toString: () => 'file:///project/a.ts' }, doc = { uri, languageId: 'typescript', get version() { return version; }, getText: () => text, positionAt: offset => offset };
  const bundle = JSON.stringify({ protocol: 'ynx-reviewed-text/v1', sessionId: id, changes: [{ uri: uri.toString(), version, fullTextDigest: digest(text), text: 'suggested' }] });
  class WorkspaceEdit { constructor() { this.operations = []; } createFile(uri, options) { this.operations.push({ type: 'create', uri, options }); } insert(uri, position, text) { this.operations.push({ type: 'insert', uri, text }); } replace(uri, range, text) { this.operations.push({ type: 'replace', uri, text }); } }
  const vscode = { FileSystemError, WorkspaceEdit, Position: class {}, Range: class {}, Uri: { parse: value => value, joinPath: (_, name) => name },
    env: { clipboard: { writeText: async value => calls.push({ type: 'clipboard', value }) }, openExternal: async url => calls.push({ type: 'open', url }) },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return {}; }, executeCommand: async (...args) => calls.push({ type: 'preview', args }) },
    window: { activeTextEditor: { document: doc, selection: { isEmpty: false } }, registerTreeDataProvider: () => ({}), showErrorMessage: value => errors.push(value), showTextDocument: async () => {}, showInputBox: async () => bundle,
      showInformationMessage: async () => { onModal?.(() => version++); return answer; }, showWarningMessage: async () => { onModal?.(() => version++); return answer; } },
    workspace: { workspaceFolders: [{ uri: 'file:///project' }], textDocuments: [doc], fs: { stat: async () => { if (!exists) throw new FileSystemError(); return {}; } }, openTextDocument: async () => ({ uri: 'untitled:preview' }), applyEdit: async edit => { calls.push({ type: 'edit', operations: edit.operations }); return true; } }
  };
  const module = { exports: {} }; vm.runInNewContext(source, { module, require: name => name === 'vscode' ? vscode : name === './guards.cjs' ? { ...localRequire('../../../native/ynx-tools/src/guards.cjs'), assertWorkspacePath: async () => {} } : localRequire('../../../native/ynx-tools/src/' + name.slice(2)), process: { env: { YNX_CORE_SESSION_ID: id } }, Buffer });
  module.exports.activate({ subscriptions: [] }); return { commands, errors, calls };
}
test('actual extension command opens only fixed trusted host locator; canceled context stays local', async () => {
  const h = harness(); await h.commands.get('ynx.openTools')(); assert.deepEqual(h.calls.map(x => x.type), ['open']); assert.match(h.calls[0].url, /^https:\/\/developer\.ynxweb4\.com\/native-tools\?sessionId=/); assert.equal(h.calls[0].url.includes('saved'), false);
  await h.commands.get('ynx.copyContext')(); assert.equal(h.calls.length, 1);
});
test('actual template command never overwrites existing file; creation uses atomic no-overwrite edit', async () => {
  const existing = harness({ exists: true, answer: 'Create starter' }); await existing.commands.get('ynx.createTemplate')(); assert.equal(existing.calls.length, 0); assert.match(existing.errors[0], /already exists/);
  const fresh = harness({ answer: 'Create starter' }); await fresh.commands.get('ynx.createTemplate')(); const operations = fresh.calls[0].operations;
  assert.equal(operations[0].options.overwrite, false); assert.equal(operations[0].options.ignoreIfExists, false); assert.match(operations[1].text, /6423n/); assert.doesNotMatch(operations[1].text, /eth_sendTransaction|privateKey/);
});
test('actual diff command previews then rejects edit made during approval; no changes applied', async () => {
  const h = harness({ answer: 'Apply reviewed changes', onModal: change => change() }); await h.commands.get('ynx.applyReviewedDiff')(); assert.deepEqual(h.calls.map(x => x.type), ['preview']); assert.match(h.errors[0], /changed/);
});
