// Test item IDs are local to their controller; use the tree's full computed ID
// when carrying UI state across discovery updates.
exports.installTestTreeState = prototype => {
  const installed = Symbol.for('ynx.test-tree-state');
  if (prototype[installed]) return;
  const createTestNode = prototype.createTestNode;
  prototype.createTestNode = function (controller, parent, test) {
    const previous = this.getNode(this.computeId(this.computePath(controller, test)));
    const result = createTestNode.call(this, controller, parent, test);
    if (previous) {
      if ('expanded' in result && typeof previous.expanded === 'boolean') result.expanded = previous.expanded;
      result.selected = previous.selected === true;
    }
    return result;
  };
  const createControllerNode = prototype.createControllerNode;
  prototype.createControllerNode = function (parent, controller) {
    const previous = this.getNode(controller.id);
    const result = createControllerNode.call(this, parent, controller);
    if (previous) {
      result.expanded = previous.expanded;
      result.selected = previous.selected === true;
    }
    return result;
  };
  Object.defineProperty(prototype, installed, { value: true });
};
