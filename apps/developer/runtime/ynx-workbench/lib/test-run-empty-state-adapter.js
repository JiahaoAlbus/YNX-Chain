const { TestRunTreeWidget } = require('@theia/test/lib/browser/view/test-run-widget');
const { jsx } = require('@theia/core/shared/react/jsx-runtime');
const { nls } = require('@theia/core/lib/common/nls');
const installed = Symbol.for('ynx.test-run-empty-state');
exports.install = () => {
  const prototype = TestRunTreeWidget.prototype;
  if (prototype[installed]) return;
  const renderTree = prototype.renderTree;
  prototype.renderTree = function (model) {
    if (this.model.root?.children?.length) return renderTree.call(this, model);
    return jsx('div', { className: 'theia-widget-noInfo noMarkers', children:
      nls.localize('ynx/workbench/noTestRuns', 'No test runs yet. Run a test from Test Explorer to see results here.') });
  };
  Object.defineProperty(prototype, installed, { value: true });
};
