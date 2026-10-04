import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { soliditySemanticIndex } from '../../../scripts/solidity-semantic-index.mjs';
const require = createRequire(import.meta.url);
const { completionSymbols } = require('../../../native/ynx-tools/src/solidity-completion.cjs');

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
});
