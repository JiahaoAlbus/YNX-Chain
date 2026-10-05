// The native host asks the normal framework shutdown service to resolve dirty
// editors and extension vetoes before destroying its window or backend.
class NativeWindowClose {
  constructor(windows, target = window, layout, storage, persistDebugState) { Object.assign(this, { windows, target, layout, storage, persistDebugState }); }
  onStart(application) {
    if (!this.target.webkit?.messageHandlers?.ynxLocalWorkbench) return;
    this.initialized = false;
    this.canStoreLayout = this.layout?.shouldStoreLayout !== false;
    // Closing an editor during startup must not replace its saved layout with
    // the still-empty shell. The framework also stores layout on shutdown.
    if (this.layout) this.layout.shouldStoreLayout = false;
    const { StopReason } = require('@theia/core/lib/common/frontend-application-state');
    this.close = async requestId => {
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return;
      if (!this.pendingClose) this.pendingClose = (async () => {
        const previousAllowVetoes = this.windows.allowVetoes;
        let committed = false;
        try {
          if (this.initialized) this.layout?.storeLayout(application); await this.storage?.flush?.();
          const safe = await this.windows.isSafeToShutDown(StopReason.Close);
          if (!safe) return false;
          await this.persistDebugState?.();
          if (this.initialized) this.layout?.storeLayout(application);
          await this.storage?.flush?.();
          committed = true;
          return true;
        } catch { return false; }
        finally {
          // DefaultWindowService consumes its veto permission on approval.
          // Persistence is part of this same close transaction: if it fails,
          // continued editing must receive the ordinary dirty-file veto again.
          if (!committed && typeof previousAllowVetoes === 'boolean') this.windows.allowVetoes = previousAllowVetoes;
        }
      })();
      const pending = this.pendingClose;
      const accepted = await pending;
      if (this.pendingClose === pending) this.pendingClose = undefined;
      this.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'close-result', requestId, accepted: accepted === true });
    };
    this.target.__ynxLocalWorkbenchClose = this.close;
  }
  onDidInitializeLayout() {
    if (this.initialized === false) {
      this.initialized = true;
      if (this.layout) this.layout.shouldStoreLayout = this.canStoreLayout;
    }
  }
  onStop() { if (this.target.__ynxLocalWorkbenchClose === this.close) delete this.target.__ynxLocalWorkbenchClose; }
}
module.exports = { NativeWindowClose };
