import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
const require = createRequire(new URL('../../../native/ynx-tools/src/extension.cjs', import.meta.url));
const source = await readFile(new URL('../../../native/ynx-tools/src/extension.cjs', import.meta.url), 'utf8');
async function fixture(locale) {
  const root = await mkdtemp('/private/tmp/ynx-chain-tools-'), commands = new Map(), errors = [], calls = [], documents = [];
  const uri = fsPath => ({ scheme: 'file', fsPath, toString: () => 'file://' + fsPath });
  const environment = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: root, YNX_LOCAL_PROJECT_ID: '12345678-1234-1234-1234-123456789012' };
  let tree, beforeApply;
  class WorkspaceEdit { operations = []; createFile(uri, options) { this.operations.push({ type: 'create', uri, options }); } insert(uri, position, text) { this.operations.push({ type: 'insert', uri, text }); } }
  const api = {
    ...(locale ? { l10n: { t: (message, ...args) => (locale[message] || message).replace(/\{(\d+)\}/g, (match, index) => args[index] === undefined ? match : String(args[index])) } } : {}),
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async (...args) => { if (args[0] !== 'setContext') calls.push(args); } },
    window: { registerTreeDataProvider: (id, provider) => { tree = provider; return {}; }, onDidChangeActiveTextEditor: () => ({}), onDidChangeTextEditorSelection: () => ({}), showErrorMessage: error => errors.push(error), showInformationMessage: async text => calls.push(['info', text]), showTextDocument: async target => calls.push(['editor', target.fsPath]) },
    env: { openExternal: () => assert.fail('network/external navigation') },
    Uri: { joinPath: (root, name) => uri(join(root.fsPath, name)) }, WorkspaceEdit, Position: class {},
    workspace: { workspaceFolders: [{ uri: uri(root) }], textDocuments: documents, applyEdit: async edit => {
      await beforeApply?.(); const create = edit.operations[0], insert = edit.operations[1];
      assert.equal(create.options.overwrite, false); assert.equal(create.options.ignoreIfExists, false);
      try { await writeFile(create.uri.fsPath, '', { flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      const doc = { uri: create.uri, isClosed: false, isDirty: true, getText: () => insert.text, save: async () => { await writeFile(create.uri.fsPath, insert.text); doc.isDirty = false; return true; } };
      documents.push(doc); calls.push(['edit', create.uri.fsPath]); return true;
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, process: { env: environment }, Buffer, require: name => {
    if (name === 'vscode') return api;
    if (name === './solidity-language.cjs') return { createSolidityLanguage: () => ({ compileProject: () => calls.push(['compile']), status: () => ({ ready: true }) }) };
    if (name === './solidity-format.cjs') return { createSolidityFormatting() {} };
    if (name === './solidity-diagnostics.cjs') return { createSolidityDiagnostics: () => ({ importCopied: () => { calls.push(['diagnostics']); return 1; } }) };
    if (name === './review-preview.cjs') return { createReviewPreview: () => () => {} };
    return require(name);
  } });
  module.exports.activate({ subscriptions: [] });
  return { root, commands, errors, calls, documents, environment, api, tree, beforeApply: fn => { beforeApply = fn; } };
}
test('actual extension grouped tree exposes local Chain tools and honest connection/configuration status', async () => {
  const f = await fixture(), groups = f.tree.getChildren();
  assert.deepEqual(Array.from(groups, x => x.label), ['Project', 'Network', 'Wallet and AI']);
  assert.ok(groups.every(x => f.tree.getTreeItem(x).collapsibleState === 2));
  assert.equal(f.tree.getChildren(groups[0])[0].command, 'ynx.createSolidityTemplate');
  assert.match(f.tree.getChildren(groups[2])[0].label, /not connected/);
  await f.commands.get('ynx.openTools')(); assert.deepEqual(f.calls, [['ynx.tools.focus']]);
  await f.commands.get('ynx.testnetConfiguration')(); assert.match(f.calls[1][1], /6423.*current network availability has not been checked/);
  await f.commands.get('ynx.compileSolidity')(); await f.commands.get('ynx.importSolidityDiagnostics')();
  assert.ok(f.calls.some(x => x[0] === 'compile')); assert.ok(f.calls.some(x => x[0] === 'diagnostics'));
  assert.deepEqual(f.errors, []);
});
test('Counter creation uses no-overwrite WorkspaceEdit, opens dirty editor and normal save writes physical Solidity', async () => {
  const f = await fixture(); await f.commands.get('ynx.createSolidityTemplate')();
  assert.deepEqual(f.errors, []); const target = join(f.root, 'Counter.sol');
  assert.equal(await readFile(target, 'utf8'), ''); assert.equal(f.documents[0].isDirty, true);
  assert.match(f.documents[0].getText(), /contract Counter/); await f.documents[0].save();
  assert.match(await readFile(target, 'utf8'), /function increment/);
  await f.commands.get('ynx.createSolidityTemplate')(); assert.match(f.errors[0], /already open/);
});
test('existing target and concurrent create preserve third-party bytes', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'Counter.sol'), 'user bytes');
  await f.commands.get('ynx.createSolidityTemplate')(); assert.match(f.errors[0], /already exists/);
  assert.equal(await readFile(join(f.root, 'Counter.sol'), 'utf8'), 'user bytes');
  const raced = await fixture(); raced.beforeApply(() => writeFile(join(raced.root, 'Counter.sol'), 'third party', { flag: 'wx' }));
  await raced.commands.get('ynx.createSolidityTemplate')(); assert.match(raced.errors[0], /could not be created/);
  assert.equal(await readFile(join(raced.root, 'Counter.sol'), 'utf8'), 'third party');
});
test('missing binding, non-root workspace and symlink destination refuse before mutation', async () => {
  const f = await fixture(); delete f.environment.YNX_LOCAL_PROJECT_ID; await f.commands.get('ynx.createSolidityTemplate')();
  assert.match(f.errors[0], /canonical local project root/); assert.ok(!f.calls.some(x => x[0] === 'edit'));
  const linked = await fixture(), outside = await mkdtemp('/private/tmp/ynx-chain-outside-');
  await writeFile(join(outside, 'user.sol'), 'private'); await symlink(join(outside, 'user.sol'), join(linked.root, 'Counter.sol'));
  await linked.commands.get('ynx.createSolidityTemplate')(); assert.match(linked.errors[0], /already exists/);
  assert.equal(await readFile(join(outside, 'user.sol'), 'utf8'), 'private'); assert.ok((await lstat(join(linked.root, 'Counter.sol'))).isSymbolicLink());
  const sub = await fixture(); sub.api.workspace.workspaceFolders[0].uri.fsPath = join(sub.root, 'missing');
  await sub.commands.get('ynx.createSolidityTemplate')(); assert.equal(sub.errors.length, 1);
});
test('created contract compiles with the actual retained pinned compiler worker', async t => {
  const input = process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT;
  if (!input) return t.skip('Supply retained sealed compiler extension.');
  const f = await fixture(); await f.commands.get('ynx.createSolidityTemplate')(); await f.documents[0].save();
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(join(input, 'compiler/compiler-worker.mjs'), { workerData: { name: 'Counter', source: f.documents[0].getText() } });
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.equal(result.ok, true); assert.equal(result.contractName, 'Counter');
  assert.ok(result.abi.some(entry => entry.name === 'increment'));
  assert.match(result.bytecode, /^0x[0-9a-f]+$/); assert.ok(result.bytecode.length > 2);
  assert.ok(result.diagnostics.every(entry => entry.severity !== 'error'));
});
test('actual Chinese bundle localizes tree, configuration and refusal while manifest keys resolve without network', async () => {
  const root = new URL('../../../native/ynx-tools/', import.meta.url);
  const [bundle, manifest, english, chinese] = await Promise.all(['l10n/bundle.l10n.zh-cn.json', 'package.json', 'package.nls.json', 'package.nls.zh-cn.json'].map(async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))));
  const f = await fixture(bundle), groups = f.tree.getChildren();
  assert.deepEqual(Array.from(groups, group => group.label), ['项目', '网络', '钱包与 AI']);
  assert.equal(f.tree.getChildren(groups[2])[0].label, '钱包尚未连接');
  await f.commands.get('ynx.testnetConfiguration')(); assert.match(f.calls[0][1], /尚未检查当前网络/);
  await writeFile(join(f.root, 'Counter.sol'), 'user bytes'); await f.commands.get('ynx.createSolidityTemplate')();
  assert.equal(f.errors[0], 'Counter.sol 已存在，未修改任何文件。');
  assert.equal(await readFile(join(f.root, 'Counter.sol'), 'utf8'), 'user bytes');
  assert.equal(manifest.version, '0.2.22'); assert.equal(manifest.l10n, './l10n');
  const texts = [manifest.displayName, manifest.description, ...manifest.contributes.commands.map(command => command.title), ...manifest.contributes.views.ynx.map(view => view.name)];
  for (const text of texts) { assert.match(text, /^%.*%$/); const key = text.slice(1, -1); assert.ok(english[key]); assert.ok(chinese[key]); }
});
