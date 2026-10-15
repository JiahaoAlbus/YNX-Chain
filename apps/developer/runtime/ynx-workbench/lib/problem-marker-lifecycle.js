'use strict';
const installed = new WeakSet();
function installOn(prototype) {
  if (installed.has(prototype)) return;
  const refresh = prototype.refreshMarkerInfo;
  if (typeof refresh !== 'function') throw Error('The retained Problems refresh contract is unavailable.');
  prototype.refreshMarkerInfo = async function (uri, ...args) {
    // The native refresh removes empty diagnostics from the visible tree, but
    // its subclass can still hold an older insert in the debounce queue.
    // Retire only this URI's queued snapshot before the native refresh reads
    // the actual current markers. New diagnostics keep the original path.
    this.queuedMarkers?.delete(uri.toString());
    return refresh.call(this, uri, ...args);
  };
  installed.add(prototype);
}
function install() {
  installOn(require('@theia/markers/lib/browser/problem/problem-tree-model').ProblemTree.prototype);
}
module.exports = { installOn, install };
