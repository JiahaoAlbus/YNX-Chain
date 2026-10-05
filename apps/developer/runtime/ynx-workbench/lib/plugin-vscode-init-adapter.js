// Keep VS Code extension disposal semantics separate from the framework's
// internal cancellation policy. Disposing a source releases listeners; only
// explicit cancellation requests should cancel pending extension results.
const constructors = new WeakMap();
const emptyToken = Object.freeze({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
});
exports.adaptApi = api => {
  const NativeSource = api.CancellationTokenSource;
  let CompatibleSource = constructors.get(NativeSource);
  if (!CompatibleSource) {
    CompatibleSource = class extends NativeSource {
      cancel() {
        if (this._token === emptyToken) return;
        super.cancel();
      }
      dispose(cancel = false) {
        if (cancel) this.cancel();
        this._parentListener?.dispose();
        if (!this._token) this._token = emptyToken;
        else this._token.dispose?.();
      }
    };
    constructors.set(NativeSource, CompatibleSource);
  }
  api.CancellationTokenSource = CompatibleSource;
  return api;
};

exports.doInitialization = (apiFactory, plugin) => {
  // This owned file is copied beside the framework's sealed initializer.
  // Delegate plugin attribution, CJS/ESM loading and version metadata intact.
  require('./plugin-vscode-init').doInitialization(
    owner => exports.adaptApi(apiFactory(owner)), plugin);
};
