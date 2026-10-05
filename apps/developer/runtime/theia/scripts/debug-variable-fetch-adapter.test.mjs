import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import adapter from '../../ynx-workbench/lib/debug-variable-fetch-adapter.js';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const tree = { ...require('@theia/core/lib/browser/tree/tree'), ...require('@theia/core/lib/browser/tree/tree-selection'), ...require('@theia/core/lib/browser/tree/tree-expansion') };
const { TopDownTreeIterator } = require('@theia/core/lib/browser/tree/tree-iterator');
function loadSourceTree() {
  const path = require.resolve('@theia/core/lib/browser/source-tree/source-tree'), localRequire = createRequire(path), exports = {};
  vm.runInNewContext(readFileSync(path, 'utf8'), { exports, require: id => id === '../tree' ? tree : localRequire(id) });
  return exports.SourceTree;
}
function loadExpressions() {
  const path = require.resolve('@theia/debug/lib/browser/console/debug-console-items'), localRequire = createRequire(path), exports = {};
  // Only browser rendering imports are stubbed; execute the installed upstream
  // DAP resolution and actual ExpressionContainer/DebugVariable/Scope classes.
  vm.runInNewContext(readFileSync(path, 'utf8'), { exports, require: id => {
    if (id === '@theia/core') return { nls: { localizeByDefault: value => value } };
    if (['@theia/core/lib/browser', '@theia/console/lib/browser/console-session', '../debug-session', '@theia/monaco-editor-core'].includes(id)) return {};
    return localRequire(id);
  } });
  return exports;
}
// Recorded LLDB scope metadata and Locals response: both named and indexed
// filters return [{name:'value',value:'41',variablesReference:0}].
const metadata = [
  { name: 'Locals', namedVariables: 1, variablesReference: 1, presentationHint: 'locals' },
  { name: 'Globals', namedVariables: 58, variablesReference: 2 },
  { name: 'Registers', namedVariables: 5, variablesReference: 3, presentationHint: 'registers' },
];
async function refreshScenario(fixed) {
  const { ExpressionContainer, DebugScope } = loadExpressions();
  if (fixed) adapter.fixNamedVariableFetch(ExpressionContainer.prototype);
  let value = '41'; const requests = [];
  const session = { async sendRequest(command, args) {
    requests.push({ command, ...args });
    return { body: { variables: [{ name: 'value', value, variablesReference: 0 }] } };
  } };
  const SourceTree = loadSourceTree(), source = new SourceTree();
  source.logger = { error: assert.fail };
  const root = { id: 'root', name: 'root', visible: false, children: [] };
  source._root = root; source.addNode(root);
  for (let iteration = 0; iteration < 2; iteration++) {
    value = String(41 + iteration);
    const scopes = metadata.map((raw, index) => new DebugScope(raw, () => session, index));
    await source.setChildren(root, scopes.map((scope, index) => source.toNode(scope, index, root)));
    for (const scope of root.children) await source.setChildren(scope, await source.resolveChildren(scope));
  }
  const iter = new TopDownTreeIterator(root, { pruneSiblings: true });
  const nodes = [], seen = new Set(); let cycle = false;
  for (let limit = 0; limit < 20; limit++) {
    const item = iter.next(); if (item.done) break;
    if (seen.has(item.value)) { cycle = true; break; }
    seen.add(item.value); nodes.push(item.value);
  }
  return { cycle, root, nodes, requests };
}

test('actual upstream duplicate filter fetch causes second-refresh object cycle; fix keeps all three scopes', async () => {
  const before = await refreshScenario(false);
  assert.equal(before.cycle, true);
  assert.equal(before.root.children[0].children.length, 2);
  const after = await refreshScenario(true);
  assert.equal(after.cycle, false);
  assert.equal(after.nodes.length, 7);
  assert.deepEqual(after.root.children.map(node => node.element.name), ['Locals', 'Globals', 'Registers']);
  assert.equal(after.root.children[0].children[0].element.value, '42');
  assert.equal(after.requests.length, 6);
  assert.ok(after.requests.every(request => request.filter === undefined));
});

test('named-only explicit zero uses one request; indexed JS/Python pagination and unknown-count resolution stay upstream', async () => {
  const { ExpressionContainer } = loadExpressions();
  adapter.fixNamedVariableFetch(ExpressionContainer.prototype);
  for (const indexedVariables of [undefined, 0, 3, 1001]) {
    const calls = [];
    const session = { async sendRequest(command, args) { calls.push(args); return { body: { variables: [] } }; } };
    const container = new ExpressionContainer({ id: 'test', session: () => session, variablesReference: 1, namedVariables: 2, indexedVariables });
    const result = await container.doResolve();
    if (!indexedVariables) { assert.equal(calls.length, 1); assert.equal(calls[0].filter, undefined); }
    else if (indexedVariables === 3) { assert.deepEqual(calls.map(call => call.filter), ['named', 'indexed']); assert.equal(calls[1].count, 3); }
    else { assert.equal(calls.length, 1); assert.equal(calls[0].filter, 'named'); assert.equal(result.length, 11); }
  }
  const calls = [], session = { async sendRequest(command, args) { calls.push(args); return { body: { variables: [] } }; } };
  await new ExpressionContainer({ id: 'unknown', session: () => session, variablesReference: 1 }).doResolve();
  assert.equal(calls.length, 1); assert.equal(calls[0].filter, 'indexed');
});
