const installed = Symbol.for('ynx.debug-variable-fetch');
function fixNamedVariableFetch(prototype) {
  if (prototype[installed]) return;
  const original = prototype.doResolve;
  prototype.doResolve = async function (...args) {
    // Apple LLDB supplies namedVariables but omits indexedVariables. Its DAP
    // adapter returns the same values for both filters. Upstream resolves named
    // first, then unconditionally indexed, creating duplicate source-tree IDs.
    // Fetch the complete non-paged container once; retain indexed pagination.
    if (this.namedVariables > 0 && (this.indexedVariables === undefined || this.indexedVariables === 0)) {
      const result = [];
      await this.fetch(result);
      return result;
    }
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, installed, { value: true });
}
function install() {
  const { ExpressionContainer } = require('@theia/debug/lib/browser/console/debug-console-items');
  fixNamedVariableFetch(ExpressionContainer.prototype);
}
module.exports = { fixNamedVariableFetch, install };
