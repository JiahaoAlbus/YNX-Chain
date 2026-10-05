// The native host asks the normal framework shutdown service to resolve dirty
// editors and extension vetoes before destroying its window or backend.
class NativeWindowClose {
  constructor(windows, target = window, layout, storage, persistDebugState, getDebugManager, debugStopTimeout = 5000) { Object.assign(this, { windows, target, layout, storage, persistDebugState, getDebugManager, debugStopTimeout }); }
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
          await this.stopDebugSessions();
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
  async stopDebugSessions() {
    const manager = this.getDebugManager?.();
    if (!manager) return;
    const deadline = async operation => {
      let timer;
      try { return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Debug session did not confirm shutdown')), this.debugStopTimeout);
      })]); } finally { clearTimeout(timer); }
    };
    for (const session of [...manager.sessions]) {
      if (!manager.sessions.includes(session)) continue;
      let disposed;
      const removed = new Promise(resolve => { disposed = manager.onDidDestroyDebugSession(value => { if (value === session) resolve(); }); });
      const alreadyStopping = session.isStopping;
      try {
        if (!alreadyStopping) {
          // Keep the adapter alive until it acknowledges disconnect and has
          // reaped its launched target. Attach only detaches from the target.
          session.isStopping = true;
          await deadline(session.sendRequest('disconnect', { restart: false, terminateDebuggee: session.configuration.request === 'launch' }, this.debugStopTimeout));
          await deadline(manager.debug.terminateDebugSession(session.id));
        }
        if (manager.sessions.includes(session)) await deadline(removed);
      } catch (error) {
        if (!alreadyStopping && manager.sessions.includes(session)) session.isStopping = false;
        throw error;
      } finally { disposed?.dispose(); }
    }
    if (manager.sessions.length) throw Error('A debug session started during shutdown');
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
