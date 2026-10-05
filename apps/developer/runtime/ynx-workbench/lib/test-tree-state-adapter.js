const { TestTree } = require('@theia/test/lib/browser/view/test-tree-widget');
const { installTestTreeState } = require('./test-tree-state');
exports.install = () => installTestTreeState(TestTree.prototype);
