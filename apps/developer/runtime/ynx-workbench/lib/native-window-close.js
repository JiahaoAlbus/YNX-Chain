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
        try {
          if (this.initialized) this.layout?.storeLayout(application); await this.storage?.flush?.();
          const safe = await this.windows.isSafeToShutDown(StopReason.Close);
          if (!safe) return false;
          await this.persistDebugState?.();
          if (this.initialized) this.layout?.storeLayout(application);
          await this.storage?.flush?.();
          return true;
        } catch { return false; }
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
