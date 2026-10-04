// The native host asks the normal framework shutdown service to resolve dirty
// editors and extension vetoes before destroying its window or backend.
class NativeWindowClose {
  constructor(windows, target = window, layout, storage) { Object.assign(this, { windows, target, layout, storage }); }
  onStart(application) {
    if (!this.target.webkit?.messageHandlers?.ynxLocalWorkbench) return;
    const { StopReason } = require('@theia/core/lib/common/frontend-application-state');
    this.close = async requestId => {
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return;
      let accepted = false;
      try {
        this.layout?.storeLayout(application); await this.storage?.flush?.();
        accepted = await this.windows.isSafeToShutDown(StopReason.Close);
        if (accepted) { this.layout?.storeLayout(application); await this.storage?.flush?.(); }
      } catch { accepted = false; }
      this.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'close-result', requestId, accepted: accepted === true });
    };
    this.target.__ynxLocalWorkbenchClose = this.close;
  }
  onStop() { if (this.target.__ynxLocalWorkbenchClose === this.close) delete this.target.__ynxLocalWorkbenchClose; }
}
module.exports = { NativeWindowClose };
