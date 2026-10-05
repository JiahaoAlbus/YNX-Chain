// Tree providers may transiently leave cyclic sibling/parent links. A corrupt
// branch must not allocate rows forever and freeze the entire workbench.
const installed = Symbol.for('ynx.tree-cycle-guard');
function protectTreeIterator(prototype, report = () => {}) {
  if (prototype[installed]) return;
  prototype.iterator = function* (root) {
    const seen = new Set();
    let node = root;
    while (node) {
      if (seen.has(node)) {
        report(node, 'repeat', seen.size);
        return;
      }
      seen.add(node);
      yield node;
      node = this.doNext(node);
    }
  };
  prototype.findNextSibling = function (node) {
    const ancestors = new Set();
    while (node) {
      if (ancestors.has(node)) { report(node, 'parent', ancestors.size); return undefined; }
      ancestors.add(node);
      if (this.options.pruneSiblings && node === this.root) return undefined;
      if (node.nextSibling) return node.nextSibling;
      node = node.parent;
    }
    return undefined;
  };
  Object.defineProperty(prototype, installed, { value: true });
}
function install(target = globalThis) {
  const { TopDownTreeIterator } = require('@theia/core/lib/browser/tree/tree-iterator');
  const { TreeWidget } = require('@theia/core/lib/browser/tree/tree-widget');
  let widget;
  const original = TreeWidget.prototype.doUpdateRows;
  if (!TreeWidget.prototype[installed]) {
    TreeWidget.prototype.doUpdateRows = function (...args) {
      const previous = widget;
      widget = this;
      try { return original.apply(this, args); } finally { widget = previous; }
    };
    Object.defineProperty(TreeWidget.prototype, installed, { value: true });
  }
  let reports = 0;
  protectTreeIterator(TopDownTreeIterator.prototype, (node, reason, count) => {
    if (target.__ynxDebugUiTraceEnabled !== true || reports >= 5) return;
    const kind = /^debug:(variables|frames|threads|watch|breakpoints)(:|$)/.exec(widget?.id || '')?.[1] || 'other';
    const children = node.parent?.children || [];
    const duplicateObject = children.indexOf(node) !== children.lastIndexOf(node);
    const selfSibling = node.nextSibling === node;
    const selfChild = Array.isArray(node.children) && node.children.includes(node);
    try {
      target.webkit?.messageHandlers?.ynxLocalWorkbench?.postMessage({
        action: 'debug-ui-trace', seq: ++reports, phase: 'begin', count: Math.min(count, 2147483647),
        event: `tree.cycle.${kind}.${reason}.dup${Number(duplicateObject)}.sib${Number(selfSibling)}.child${Number(selfChild)}`,
      });
    } catch (_) { /* Diagnostics cannot affect iteration. */ }
  });
}
module.exports = { protectTreeIterator, install };
