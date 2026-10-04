import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), textmate = require('../node_modules/vscode-textmate'), onig = require('../node_modules/vscode-oniguruma');
await onig.loadWASM(await readFile(new URL('../node_modules/vscode-oniguruma/release/onig.wasm', import.meta.url)));
const raw = await readFile(new URL('../../../native/ynx-tools/languages/solidity.tmLanguage.json', import.meta.url), 'utf8');
const registry = new textmate.Registry({ onigLib: Promise.resolve({ createOnigScanner: patterns => new onig.OnigScanner(patterns), createOnigString: text => new onig.OnigString(text) }), loadGrammar: async () => textmate.parseRawGrammar(raw, 'solidity.json') });
const grammar = await registry.loadGrammar('source.solidity');
function tokens(line, previous) { return grammar.tokenizeLine(line, previous); }
function scope(line, needle, previous) {
  const index = line.indexOf(needle); assert.ok(index >= 0);
  return tokens(line, previous).tokens.find(t => t.startIndex <= index && t.endIndex > index).scopes.at(-1);
}
test('contract and function declarations have distinct type/name scopes', () => {
  assert.equal(scope('contract Wallet {', 'Wallet'), 'entity.name.type.solidity');
  assert.equal(scope('function transfer(address to) public returns (bool) {', 'transfer'), 'entity.name.function.solidity');
  assert.equal(scope('function transfer(address to) public returns (bool) {', 'address'), 'storage.type.solidity');
});
test('comments and NatSpec suppress executable-looking strings and keywords', () => {
  assert.equal(scope('// function fake() { "hello"', 'function'), 'comment.line.double-slash.solidity');
  assert.equal(scope('/// @param account owner', '@param'), 'storage.type.annotation.solidity');
  const state = tokens('/* contract Fake {').ruleStack;
  assert.equal(scope('function falsePositive() {}', 'function', state), 'comment.block.solidity');
  assert.equal(scope('*/ contract Real {}', 'Real', state), 'entity.name.type.solidity');
});
test('Unicode and hex strings include prefixes and shield comments/operators', () => {
  const line = 'string s = unicode"中文😀 // contract"; bytes b = hex"aabb";';
  assert.equal(scope(line, '中文😀'), 'string.quoted.double.solidity');
  assert.equal(scope(line, '// contract'), 'string.quoted.double.solidity');
  assert.equal(scope(line, 'aabb'), 'string.quoted.double.solidity');
  assert.equal(scope(line, 'bytes'), 'storage.type.solidity');
});
test('escaped quotes stay within strings and an unterminated line can recover', () => {
  const line = String.raw`string s = "a\" // b"; uint256 n = 2;`;
  assert.equal(scope(line, '\\"'), 'constant.character.escape.solidity');
  assert.equal(scope(line, '// b'), 'string.quoted.double.solidity');
  assert.equal(scope(line, 'uint256'), 'storage.type.solidity');
  const state = tokens('string broken = "unfinished').ruleStack;
  assert.equal(scope('contract After {}', 'After', state), 'entity.name.type.solidity');
});
test('numeric exponent, hex, underscore and units tokenize independently', () => {
  const line = 'uint256 n = 1_000 ether + 0xAB_CD + 1.2e-3;';
  for (const text of ['1_000', '0xAB_CD', '1.2e-3']) assert.equal(scope(line, text), 'constant.numeric.solidity');
  assert.equal(scope(line, 'ether'), 'constant.language.unit.solidity');
});
