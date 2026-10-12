const { TestItemImpl } = require('@theia/plugin-ext/lib/main/browser/test-main');
const { testRangeFromRpc } = require('./test-range');
const installed = Symbol.for('ynx.test-item-range-adapter');
exports.install = () => {
  const prototype = TestItemImpl.prototype;
  if (prototype[installed]) return;
  const update = prototype.update;
  prototype.update = function (value) {
    if (!('range' in value)) return update.call(this, value);
    const { range, ...rest } = value;
    update.call(this, rest);
    this.range = testRangeFromRpc(range);
  };
  Object.defineProperty(prototype, installed, { value: true });
};
