import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSolidityLanguage } = require('../../../native/ynx-tools/src/solidity-language.cjs');

test('real bundled compiler serves navigation and rename providers, retires invalid unsaved sources, rejects changed identity and disposal', async t => {
  const input = process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT;
  if (!input) return t.skip('Supply an owned extension with its reviewed compiler bundle.');
  const extensionPath = await realpath(input);
  assert.ok(extensionPath.includes('/apps/developer/.ynx-developer-candidates/'));
  const root = await mkdtemp('/private/tmp/ynx-solidity-language-test-');
  await mkdir(join(root, 'lib'));
  const uri = path => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` });
  const texts = {
    'Use.sol': '// 中文😀\npragma solidity 0.8.24; import "./lib/Math.sol"; contract Use { function ping() public pure returns(uint256) { return Math.value(); } }',
    'lib/Math.sol': 'pragma solidity 0.8.24; library Math { function value() internal pure returns(uint256) { return 3; } function value(uint256 n) internal pure returns(uint256) { return n; } }'
  };
  const documents = [];
  for (const [name, text] of Object.entries(texts)) {
    await writeFile(join(root, name), text, { flag: 'wx' });
    documents.push({ uri: uri(join(root, name)), version: 1, isClosed: false, text,
      getText() { return this.text; }, offsetAt(position) { return position.offset; }, positionAt(offset) { return { offset }; } });
  }
  const providers = {}, events = {}, subscriptions = [];
  const event = name => listener => { events[name] = listener; return { dispose() {} }; };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(root) }], textDocuments: documents,
      findFiles: async () => documents.map(doc => doc.uri), openTextDocument: async uri => documents.find(doc => doc.uri.toString() === uri.toString()),
      onDidChangeTextDocument: event('change'), onDidCloseTextDocument: event('close'), onDidChangeWorkspaceFolders: event('folders') },
    languages: Object.fromEntries(['Definition', 'Hover', 'Reference', 'DocumentSymbol', 'Rename', 'CompletionItem'].map(name => [`register${name}Provider`, (selector, provider) => { assert.equal(selector.language, 'solidity'); providers[name] = provider; return { dispose() {} }; }])),
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Location: class { constructor(uri, range) { this.uri = uri; this.range = range; } },
    MarkdownString: class { appendCodeblock(value) { this.value = value; } },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    SymbolInformation: class { constructor(name, kind, containerName, location) { Object.assign(this, { name, kind, containerName, location }); } },
    SymbolKind: { Class: 4, Function: 11, Variable: 12 }
  };
  vscode.WorkspaceEdit = class {
    constructor() { this.edits = []; }
    replace(uri, range, text) { this.edits.push({ uri, range, text }); }
  };
  vscode.CompletionItem = class { constructor(label, kind) { Object.assign(this, { label, kind }); } };
  vscode.CompletionList = class { constructor(items, isIncomplete) { Object.assign(this, { items, isIncomplete }); } };
  vscode.CompletionItemKind = { Class: 6, Function: 2, Variable: 5 };
  const liveDiagnostics = { rows: [], clear() { this.rows = []; }, set(rows) { this.rows = rows; }, dispose() {} };
  vscode.languages.createDiagnosticCollection = () => liveDiagnostics;
  vscode.Diagnostic = class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } };
  vscode.DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2 };
  const environment = { YNX_CORE_SESSION_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', YNX_CORE_WORKSPACE: root };
  const language = createSolidityLanguage(vscode, { extensionPath, subscriptions }, environment);
  t.after(() => language.dispose());
  const position = { offset: texts['Use.sol'].indexOf('Math.value') + 5 };
  const [definition, hover, references, symbols] = await Promise.all([
    providers.Definition.provideDefinition(documents[0], position), providers.Hover.provideHover(documents[0], position),
    providers.Reference.provideReferences(documents[0], position, { includeDeclaration: true }), providers.DocumentSymbol.provideDocumentSymbols(documents[0])
  ]);
  assert.equal(definition.uri.fsPath, documents[1].uri.fsPath);
  assert.equal(definition.range.start.offset, texts['lib/Math.sol'].indexOf('value()'));
  assert.match(hover.contents.value, /function \(\) pure returns \(uint256\)/);
  assert.equal(references.length, 2); assert.ok(symbols.some(symbol => symbol.name === 'ping'));
  assert.equal(language.status().active, 0); assert.equal(language.status().cached, true);
  const prepared = await providers.Rename.prepareRename(documents[0], position);
  assert.equal(prepared.placeholder, 'value'); assert.equal(prepared.range.start.offset, position.offset);
  const renamed = await providers.Rename.provideRenameEdits(documents[0], position, 'fresh');
  assert.equal(renamed.edits.length, 2);
  assert.deepEqual(renamed.edits.map(edit => edit.uri.fsPath).sort(), documents.map(doc => doc.uri.fsPath).sort());
  assert.equal(documents[0].text, texts['Use.sol']); assert.equal(documents[1].text, texts['lib/Math.sol']);
  assert.equal(renamed.edits.find(edit => edit.uri.fsPath === documents[1].uri.fsPath).range.start.offset, texts['lib/Math.sol'].indexOf('value()'));
  await assert.rejects(providers.Rename.provideRenameEdits(documents[0], position, 'bad-name'), /valid Solidity identifier/);
  await assert.rejects(providers.Rename.provideRenameEdits(documents[0], position, 'return'), /break the Solidity project/);
  await assert.rejects(providers.Rename.provideRenameEdits(documents[1], { offset: texts['lib/Math.sol'].indexOf('value(uint256') }, 'Math'), /already exists|break the Solidity project/);
  documents[0].text = texts['Use.sol'].replace('Math.value()', 'Math.va()'); documents[0].version++;
  events.change({ document: documents[0] });
  const completions = await providers.CompletionItem.provideCompletionItems(documents[0], { offset: documents[0].text.indexOf('Math.va') + 7 });
  assert.equal(completions.items.filter(item => item.label === 'value').length, 2);
  assert.equal(completions.items[0].range.start.offset, position.offset);
  assert.equal(completions.items[0].range.end.offset, position.offset + 2);
  documents[0].text = texts['Use.sol'].replace('return Math.value();', 'Math.'); documents[0].version++;
  events.change({ document: documents[0] });
  const bare = await providers.CompletionItem.provideCompletionItems(documents[0], { offset: documents[0].text.lastIndexOf('Math.') + 5 });
  assert.ok(bare.items.some(item => item.label === 'value'));
  documents[0].text = texts['Use.sol']; documents[0].version++;
  events.change({ document: documents[0] });
  documents[1].text = documents[1].text.replace('value()', 'fresh()'); documents[1].version++;
  events.change({ document: documents[1] });
  assert.equal(await providers.Definition.provideDefinition(documents[0], position), undefined);
  assert.ok(liveDiagnostics.rows.some(([, items]) => items.some(item => item.severity === vscode.DiagnosticSeverity.Error)));
  assert.equal(language.status().cached, false); assert.equal(language.status().active, 0);
  documents[0].text = documents[0].text.replace('Math.value()', 'Math.fresh()'); documents[0].version++;
  events.change({ document: documents[0] });
  assert.equal((await providers.Definition.provideDefinition(documents[0], position)).uri.fsPath, documents[1].uri.fsPath);
  assert.equal(liveDiagnostics.rows.some(([, items]) => items.some(item => item.severity === vscode.DiagnosticSeverity.Error)), false);
  const openSource = vscode.workspace.openTextDocument, openedArtifacts = [];
  vscode.workspace.openTextDocument = async input => {
    if (typeof input.content === 'string') { openedArtifacts.push(input); return input; }
    return openSource(input);
  };
  vscode.window = { activeTextEditor: { document: documents[0] }, showTextDocument: async artifact => artifact };
  const artifact = await language.compileProject();
  assert.equal(artifact.ok, true); assert.equal(artifact.contractName, 'Use');
  assert.ok(artifact.abi.some(row => row.name === 'ping')); assert.ok(artifact.bytecode.length > 2);
  assert.equal(openedArtifacts.length, 1); assert.equal(openedArtifacts[0].language, 'json');
  assert.equal(JSON.parse(openedArtifacts[0].content).contractName, 'Use');
  vscode.workspace.openTextDocument = openSource;
  environment.YNX_CORE_SESSION_ID = undefined;
  assert.equal(await providers.Hover.provideHover(documents[0], position), undefined);
  language.dispose();
  assert.equal(await providers.DocumentSymbol.provideDocumentSymbols(documents[0]), undefined);
});
