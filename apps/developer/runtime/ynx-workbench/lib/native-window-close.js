function watchCloseEditors(shell) {
  if (!shell) return { unchanged: () => true, dispose() {} };
  const { Saveable } = require('@theia/core/lib/browser/saveable');
  const disposables = [];
  let changed = false;
  const state = widget => {
    const saveable = Saveable.get(widget);
    const document = widget.editor?.document || saveable?.editor?.document || saveable;
    return { widget, saveable, document, version: document?.version,
      dirty: saveable?.dirty, uri: String(document?.uri || widget.getResourceUri?.() || widget.uri || '') };
  };
  const before = (shell.widgets || []).map(state).filter(item => item.saveable);
  for (const item of before) {
    for (const event of [item.saveable?.onContentChanged, item.saveable?.onDirtyChanged]) {
      if (typeof event === 'function') disposables.push(event.call(item.saveable, () => { changed = true; }));
    }
  }
  return {
    unchanged() {
      if (changed) return false;
      const after = (shell.widgets || []).map(state).filter(item => item.saveable);
      return before.length === after.length && before.every((item, index) =>
        Object.keys(item).every(key => item[key] === after[index][key]));
    },
    dispose() {
      let firstError, failed = false;
      for (const disposable of disposables.splice(0)) {
        try { disposable?.dispose(); } catch (error) { if (!failed) firstError = error; failed = true; }
      }
      if (failed) throw firstError;
    }
  };
}

const guardedClosePrototypes = new WeakSet();
const saveCloseActions = new WeakSet();
const closeVetoPermissions = new WeakMap();
function installCloseSaveGuardOn(prototype) {
  if (!prototype || guardedClosePrototypes.has(prototype) || typeof prototype.onWillStop !== 'function') return;
  const original = prototype.onWillStop;
  prototype.onWillStop = function (...args) {
    const owner = this;
    const shell = owner.shell;
    const confirm = owner.confirmExitWithOrWithoutSaving;
    const facade = new Proxy(owner, {
      get(target, key) {
        if (key === 'confirmExitWithOrWithoutSaving') return async (...parameters) => {
          const choice = await confirm.apply(owner, parameters);
          // Save is an acknowledgement of the current dirty state, not merely
          // completion of a promise: native model.run logs write failures.
          // Keep the native explicit Don't Save and Cancel choices unchanged.
          if (owner.shell !== shell || (choice === true && shell.canSaveAll())) return undefined;
          return choice;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { return Reflect.set(target, key, value, target); }
    });
    const veto = original.apply(facade, args);
    if (veto && typeof veto.action === 'function') saveCloseActions.add(veto);
    return veto;
  };
  guardedClosePrototypes.add(prototype);
}
function installCloseSaveGuard() {
  const { CommonFrontendContribution } = require('@theia/core/lib/browser/common-frontend-contribution');
  installCloseSaveGuardOn(CommonFrontendContribution.prototype);
}
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
    const close = async requestId => {
      const current = () => this.target.__ynxLocalWorkbenchClose === close;
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) return;
      if (!this.pendingClose) {
        const previousAllowVetoes = this.windows.allowVetoes;
        this.pendingClose = (async () => {
        let committed = false;
        let editors;
        let stage = 'initial-persistence';
        try {
          if (this.initialized) this.layout?.storeLayout(application); await this.storage?.flush?.();
          if (!current()) return false;
          // The framework logs contribution action failures and otherwise
          // continues approval. Preserve its original error, but veto this close.
          let actionFailed = false;
          const windows = this.windows;
          editors = watchCloseEditors(application?.shell);
          const logger = new Proxy(windows.logger || {}, {
            get(target, key) {
              if (key === 'error') return (...values) => {
                actionFailed = true;
                return target.error?.(...values);
              };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });
          const guardedWindows = new Proxy(windows, {
            get(target, key, receiver) {
              if (key === 'logger') return logger;
              if (key === 'collectContributionUnloadVetoes') return (...parameters) =>
                target.collectContributionUnloadVetoes.apply(receiver, parameters).map(veto => {
                  if (!saveCloseActions.has(veto)) return veto;
                  return { ...veto, action: async (...values) => {
                    const approved = await veto.action(...values);
                    if (approved) {
                      editors.dispose();
                      editors = watchCloseEditors(application?.shell);
                    }
                    return approved;
                  } };
                });
              return Reflect.get(target, key, receiver);
            }
          });
          stage = 'shutdown-vetoes';
          const safe = await guardedWindows.isSafeToShutDown(StopReason.Close);
          if (!safe || actionFailed || !current()) return false;
          if (!editors.unchanged()) return false;
          stage = 'debug-state-persistence';
          await this.persistDebugState?.();
          if (!current() || !editors.unchanged()) return false;
          stage = 'final-persistence';
          if (this.initialized) this.layout?.storeLayout(application);
          await this.storage?.flush?.();
          if (!current() || !editors.unchanged()) return false;
          stage = 'debug-session-shutdown';
          await this.stopDebugSessions();
          if (!current() || !editors.unchanged()) return false;
          committed = true;
          return true;
        } catch (error) {
          // Keep the original failure observable without allowing a logger
          // failure to bypass the existing shutdown veto or strand a retry.
          try { this.windows.logger?.error?.('Native window close failed', { stage }, error); } catch { /* preserve close veto */ }
          return false;
        }
        finally {
          let cleanupFailed = false;
          try { editors?.dispose(); } catch (error) {
            cleanupFailed = true;
            committed = false;
            try { this.windows.logger?.error?.(error); } catch { /* preserve close veto */ }
          }
          if (!current()) committed = false;
          // DefaultWindowService consumes its veto permission on approval.
          // Persistence is part of this same close transaction: if it fails,
          // continued editing must receive the ordinary dirty-file veto again.
          if (!committed && typeof previousAllowVetoes === 'boolean') this.windows.allowVetoes = previousAllowVetoes;
          if (cleanupFailed) return false;
        }
        })();
        // Duplicate requests inherit the permission of this exact operation.
        closeVetoPermissions.set(this.pendingClose, previousAllowVetoes);
      }
      const pending = this.pendingClose;
      const accepted = await pending;
      // A microtask may replace the callback after the inner finally completed.
      if (accepted === true && !current()) {
        const previousAllowVetoes = closeVetoPermissions.get(pending);
        if (typeof previousAllowVetoes === 'boolean') this.windows.allowVetoes = previousAllowVetoes;
      }
      if (this.pendingClose === pending) this.pendingClose = undefined;
      this.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'close-result', requestId, accepted: accepted === true && current() });
    };
    this.close = close;
    this.target.__ynxLocalWorkbenchClose = close;
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
module.exports = { NativeWindowClose, installCloseSaveGuard, installCloseSaveGuardOn };
