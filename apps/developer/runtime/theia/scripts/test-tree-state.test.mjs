import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { installTestTreeState } = require('../../ynx-workbench/lib/test-tree-state');
// Exercise the installed framework's actual node/path methods, isolating DOM/DI.
const source = readFileSync(require.resolve('@theia/test/lib/browser/view/test-tree-widget'), 'utf8');
const start = source.indexOf('let TestTree = class TestTree extends');
const end = source.indexOf('exports.TestTree = TestTree;', start) + 'exports.TestTree = TestTree;'.length;
const context = { exports: {}, tree_1: {
  TreeImpl: class { constructor() { this.nodes = new Map(); } getNode(id) { return this.nodes.get(id); } },
  ExpandableTreeNode: { is: n => !!n && typeof n.expanded === 'boolean' },
} };
vm.runInNewContext(source.slice(start, end), context);
const TestTree = context.exports.TestTree;
installTestTreeState(TestTree.prototype);

test('discovery refresh preserves full-path expansion and selection across controllers', () => {
  const tree = new TestTree();
  const controller = { id: 'python-tests', label: 'Python Tests' };
  const parent = { id: controller.id };
  const suite = { id: '/project/test_wallet.py', label: 'WalletTests', tests: [], canResolveChildren: true };
  const leaf = { id: 'test_balance', label: 'test_balance', tests: [], canResolveChildren: false, parent: suite };
  suite.tests.push(leaf);
  const before = tree.createTestNode(controller, parent, suite);
  before.expanded = true; before.selected = true;
  before.children[0].selected = true;
  for (const node of [before, ...before.children]) tree.nodes.set(node.id, node);
  const after = tree.createTestNode(controller, parent, suite);
  assert.equal(after.expanded, true);
  assert.equal(after.selected, true);
  assert.equal(after.children[0].selected, true);
  assert.equal('expanded' in after.children[0], false);
  const other = tree.createTestNode({ ...controller, id: 'other-tests' }, parent, suite);
  assert.equal(other.selected, false);
  assert.equal(other.expanded, undefined);
  before.expanded = false;
  assert.equal(tree.createTestNode(controller, parent, suite).expanded, false);
});

test('controller refresh preserves state and adapter installs once', () => {
  const tree = new TestTree(), controller = { id: 'python-tests', label: 'Python Tests' };
  const before = tree.createControllerNode({}, controller);
  before.expanded = true; before.selected = true; tree.nodes.set(before.id, before);
  const after = tree.createControllerNode({}, controller);
  assert.equal(after.expanded, true); assert.equal(after.selected, true);
  const method = TestTree.prototype.createTestNode;
  installTestTreeState(TestTree.prototype);
  assert.equal(TestTree.prototype.createTestNode, method);
});
