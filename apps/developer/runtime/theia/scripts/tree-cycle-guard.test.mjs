import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import guard from '../../ynx-workbench/lib/tree-cycle-guard.js';
const require = createRequire(new URL('../package.json', import.meta.url));
require('reflect-metadata');
const tree = { ...require('@theia/core/lib/browser/tree/tree'), ...require('@theia/core/lib/browser/tree/tree-selection'), ...require('@theia/core/lib/browser/tree/tree-expansion') };
const { TopDownTreeIterator } = require('@theia/core/lib/browser/tree/tree-iterator');
const sourcePath = require.resolve('@theia/core/lib/browser/source-tree/source-tree');
const sourceExports = {}, sourceRequire = createRequire(sourcePath);
vm.runInNewContext(readFileSync(sourcePath, 'utf8'), { exports: sourceExports, require: name => name === '../tree' ? tree : sourceRequire(name) });

test('real SourceTree repeated existing IDs reproduced, then guard ends the object cycle', async () => {
  const source = new sourceExports.SourceTree();
  source.logger = { error: assert.fail };
  const root = { id: 'root', name: 'root', visible: false, children: [] };
  source._root = root; source.addNode(root);
  const replace = async ids => source.setChildren(root, ids.map((id, i) => source.toNode({ id }, i, root)));
  await replace(['frame0', 'frame1']);
  await replace(['frame0', 'frame0']);
  assert.equal(root.children[0], root.children[1]);
  const broken = new TopDownTreeIterator(root, { pruneSiblings: true });
  const first = broken.next().value, repeated = broken.next().value;
  assert.equal(first, root);
  for (let i = 0; i < 20; i++) assert.equal(broken.next().value, repeated);
  const reports = [];
  guard.protectTreeIterator(TopDownTreeIterator.prototype, (...args) => reports.push(args));
  assert.deepEqual([...new TopDownTreeIterator(root, { pruneSiblings: true })], [root, repeated]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0][1], 'repeat');
});

test('normal order, node identity and collapsed pruning remain unchanged without size truncation', () => {
  const root = { id: 'root', children: [] };
  for (let i = 0; i < 10020; i++) root.children.push({ id: String(i), selected: i === 7 });
  root.children.forEach((node, index) => tree.CompositeTreeNode.setParent(node, index, root));
  const actual = [...new TopDownTreeIterator(root, { pruneSiblings: true })];
  assert.equal(actual.length, 10021);
  assert.equal(actual[8], root.children[7]);
  assert.equal(actual[8].selected, true);
  root.expanded = false;
  assert.deepEqual([...new TopDownTreeIterator(root, { pruneCollapsed: true })], [root]);
});

test('parent and child cycles terminate, while sibling traversal from interior node is retained', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  a.parent = b; b.parent = a;
  assert.deepEqual([...new TopDownTreeIterator(a)], [a]);
  a.parent = undefined; a.children = [a];
  assert.deepEqual([...new TopDownTreeIterator(a)], [a]);
  a.children = []; a.nextSibling = b; b.parent = undefined;
  assert.deepEqual([...new TopDownTreeIterator(a)], [a, b]);
  assert.deepEqual([...new TopDownTreeIterator(a, { pruneSiblings: true })], [a]);
});
