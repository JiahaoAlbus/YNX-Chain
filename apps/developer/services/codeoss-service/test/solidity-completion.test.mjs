import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { soliditySemanticIndex } from '../../../scripts/solidity-semantic-index.mjs';
const require = createRequire(import.meta.url);
const { completionSymbols } = require('../../../native/ynx-tools/src/solidity-completion.cjs');
const { createSolidityLanguage } = require('../../../native/ynx-tools/src/solidity-language.cjs');

test('real parse-only compiler AST supplies namespace exports and inherited members with visibility and ambiguity checks', async t => {
  if (!process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT) return t.skip('Supply the reviewed compiler extension.');
  const extensionPath = await realpath(process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT);
  assert.ok(extensionPath.includes('/apps/developer/.ynx-developer-candidates/'));
  const solc = require(extensionPath + '/compiler/node_modules/solc');
  const sources = {
    'Base.sol': { content: 'pragma solidity 0.8.24; contract Base { uint256 public total; function inherited(uint256 x) public pure virtual returns(uint256) { return x; } function internalOnly() internal pure returns(uint256) { return 1; } function externalOnly() external pure returns(uint256) { return 2; } function hidden() private pure returns(uint256) { return 3; } } library Util { function help() internal pure returns(uint256) { return 2; } }' },
    'Child.sol': { content: 'pragma solidity 0.8.24; import * as Pack from "./Base.sol"; contract Child is Pack.Base { function own() public view returns(uint256) { return this.inherited(1) + total + Pack.Util.help(); } }' },
  };
  const parse = sources => {
    const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { stopAfter: 'parsing', outputSelection: { '*': { '': ['ast'] } } } })));
    assert.equal((output.errors || []).filter(row => row.severity === 'error').length, 0);
    return soliditySemanticIndex(output, sources);
  };
  const index = parse(sources), cursor = sources['Child.sol'].content.indexOf('this.inherited');
  const child = index.declarations.find(row => row.name === 'Child');
  assert.deepEqual(child.baseContracts, [{ name: 'Pack.Base' }]);
  assert.equal(child.linearizedBaseContracts, undefined);
  const names = receiver => completionSymbols(index, 'Child.sol', cursor, receiver).map(row => row.name);
  assert.deepEqual(names('Pack').sort(), ['Base', 'Util']);
  for (const name of ['own', 'inherited', 'total', 'externalOnly']) assert.ok(names('this').includes(name));
  for (const name of ['hidden', 'internalOnly']) assert.ok(!names('this').includes(name));
  for (const name of ['inherited', 'total', 'internalOnly']) assert.ok(names().includes(name));
  for (const name of ['hidden', 'externalOnly']) assert.ok(!names().includes(name));

  const named = { ...sources, 'Child.sol': { content: sources['Child.sol'].content.replace('import * as Pack', 'import { Base as Parent, Util }').replace('Pack.Base', 'Parent').replace('Pack.Util', 'Util') } };
  const namedIndex = parse(named);
  assert.ok(completionSymbols(namedIndex, 'Child.sol', named['Child.sol'].content.indexOf('this.inherited'), 'this').some(row => row.name === 'inherited'));

  const ambiguous = { ...sources, 'Other.sol': { content: 'pragma solidity 0.8.24; contract Base { function incorrect() public pure returns(uint256) { return 9; } }' }, 'Child.sol': { content: 'pragma solidity 0.8.24; import "./Base.sol"; import "./Other.sol"; contract Child is Base { function own() public {} }' } };
  assert.deepEqual(completionSymbols(parse(ambiguous), 'Child.sol', ambiguous['Child.sol'].content.indexOf('public {}'), 'this').map(row => row.name), ['own']);

  const diamond = { 'Diamond.sol': { content: 'pragma solidity 0.8.24; contract A { function root() public {} } contract B is A { function left() public {} } contract C is A { function right() public {} } contract D is B, C { function own() public {} }' } };
  const diamondNames = completionSymbols(parse(diamond), 'Diamond.sol', diamond['Diamond.sol'].content.lastIndexOf('public {}'), 'this').map(row => row.name);
  assert.deepEqual(diamondNames.sort(), ['left', 'own', 'right', 'root']);
  assert.deepEqual(names('Pack.Util'), ['help']);
  const instanceSources = { ...sources, 'Child.sol': { content: 'pragma solidity 0.8.24; import * as Pack from "./Base.sol"; contract Child { function own(Pack.Base peer) public view returns(uint256) { return peer.total(); } }' } };
  const instanceNames = completionSymbols(parse(instanceSources), 'Child.sol', instanceSources['Child.sol'].content.indexOf('peer.total'), 'peer').map(row => row.name);
  for (const name of ['total', 'inherited', 'externalOnly']) assert.ok(instanceNames.includes(name));
  for (const name of ['hidden', 'internalOnly']) assert.ok(!instanceNames.includes(name));
  const shadowed = { ...sources, 'Child.sol': { content: 'pragma solidity 0.8.24; import * as Pack from "./Base.sol"; contract Child { function own(uint256 Pack) public pure returns(uint256) { return Pack; } }' } };
  assert.deepEqual(completionSymbols(parse(shadowed), 'Child.sol', shadowed['Child.sol'].content.indexOf('return Pack'), 'Pack.Util'), []);
});

test('actual bundled worker completes a namespace library and qualified contract instance from current buffers', async t => {
  if (!process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT) return t.skip('Supply the reviewed compiler extension.');
  const extensionPath = await realpath(process.env.YNX_SOLIDITY_LANGUAGE_EXTENSION_INPUT), root = await mkdtemp('/private/tmp/ynx-qualified-completion-');
  const uri = path => ({ scheme: 'file', fsPath: path, toString: () => `file://${path}` });
  const contents = {
    'Base.sol': 'pragma solidity 0.8.24; library Util { function help() internal pure returns(uint256) { return 1; } } contract Base { function value() public pure returns(uint256) { return 2; } function hidden() private pure returns(uint256) { return 3; } }',
    'Use.sol': 'pragma solidity 0.8.24; import * as Pack from "./Base.sol"; contract Use { function own(Pack.Base peer) public view returns(uint256) { return Pack.Util.he(); } }',
  };
  const documents = [];
  for (const [name, text] of Object.entries(contents)) {
    await writeFile(join(root, name), text, { flag: 'wx' });
    documents.push({ uri: uri(join(root, name)), version: 1, isClosed: false, text, getText() { return this.text; }, offsetAt(position) { return position.offset; }, positionAt(offset) { return { offset }; } });
  }
  const providers = {}, events = {}, subscriptions = [], event = name => listener => { events[name] = listener; return { dispose() {} }; };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(root) }], textDocuments: documents, findFiles: async () => documents.map(doc => doc.uri), openTextDocument: async uri => documents.find(doc => doc.uri.toString() === uri.toString()), onDidChangeTextDocument: event('change'), onDidCloseTextDocument: event('close'), onDidChangeWorkspaceFolders: event('folders') },
    languages: Object.fromEntries(['Definition', 'Hover', 'Reference', 'DocumentSymbol', 'Rename', 'CompletionItem'].map(name => [`register${name}Provider`, (selector, provider) => { providers[name] = provider; return { dispose() {} }; }])),
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
    CompletionList: class { constructor(items, isIncomplete) { Object.assign(this, { items, isIncomplete }); } },
    CompletionItemKind: { Class: 6, Function: 2, Variable: 5 },
  };
  const language = createSolidityLanguage(vscode, { extensionPath, subscriptions }, { YNX_CORE_SESSION_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', YNX_CORE_WORKSPACE: root });
  t.after(() => language.dispose());
  const document = documents[1];
  let result = await providers.CompletionItem.provideCompletionItems(document, { offset: document.text.indexOf('Pack.Util.he') + 'Pack.Util.he'.length });
  assert.ok(result.items.some(row => row.label === 'help'));
  assert.equal(result.items.find(row => row.label === 'help').range.start.offset, document.text.indexOf('Pack.Util.he') + 'Pack.Util.'.length);
  document.text = contents['Use.sol'].replace('Pack.Util.he()', 'peer.va()'); document.version++; events.change({ document });
  result = await providers.CompletionItem.provideCompletionItems(document, { offset: document.text.indexOf('peer.va') + 'peer.va'.length });
  assert.ok(result.items.some(row => row.label === 'value'));
  assert.ok(!result.items.some(row => row.label === 'hidden'));
  document.text = contents['Use.sol'].replace('Pack.Util.he()', 'get().Pack.Util.he()'); document.version++; events.change({ document });
  assert.equal(await providers.CompletionItem.provideCompletionItems(document, { offset: document.text.indexOf('Pack.Util.he') + 'Pack.Util.he'.length }), undefined);
});
