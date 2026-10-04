'use strict';
let installed = false;
function install() {
  if (installed) return;
  const { KeybindingLabel } = require('@theia/monaco-editor-core/esm/vs/base/browser/ui/keybindingLabel/keybindingLabel');
  const original = KeybindingLabel.prototype.set;
  KeybindingLabel.prototype.set = function (binding, matches) {
    // Recycled quick-input rows clear the visual keys via native render(), but
    // native empty-binding render leaves the preceding row's accessible label
    // and managed hover. Reset only those stale metadata fields before set(),
    // including its same-undefined fast path. Bound rendering stays upstream.
    if (!binding) {
      this.domNode.removeAttribute('aria-label');
      this.domNode.removeAttribute('title');
      this.hover.update(undefined);
    }
    return original.call(this, binding, matches);
  };
  installed = true;
}
module.exports = { install };
