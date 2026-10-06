'use strict';
const { execFile } = require('node:child_process');
const { join } = require('node:path');
const installed = new WeakSet();

// Keep Theia's actual ProcessTask exit events/state. Only its local macOS kill
// operation needs the existing sandbox-compatible, identity-checked tree helper.
function install(prototype, options = {}) {
  const platform = options.platform ?? process.platform;
  const mode = options.mode ?? process.env.YNX_WORKSPACE_MODE;
  if (platform !== 'darwin' || mode !== 'local' || installed.has(prototype)) return;
  installed.add(prototype);
  const pending = new WeakMap();
  prototype.kill = function () {
    if (pending.has(this)) return pending.get(this);
    const taskProcess = this.process;
    if (taskProcess.killed) return Promise.resolve();
    const pid = taskProcess.pid;
    const app = options.applicationPath ?? process.env.THEIA_APP_PROJECT_PATH;
    if (!Number.isSafeInteger(pid) || pid <= 1 || !app)
      return Promise.reject(Error('Task cancellation has no live owned process or runtime path.'));
    const operation = new Promise((resolve, reject) => {
      let closed = false, helperDone = false, settled = false, timer;
      const subscription = taskProcess.onClose(() => { closed = true; finish(); });
      function finish(error) {
        if (settled || (!error && (!closed || !helperDone))) return;
        settled = true; clearTimeout(timer); subscription.dispose();
        if (error) reject(error); else resolve();
      }
      // No await between checking the live task and starting the helper. Never
      // reuse a persisted PID; the helper captures/checks UID and birth identity.
      if (taskProcess.killed) { closed = true; helperDone = true; finish(); return; }
      timer = setTimeout(() => finish(Error('Task process exit was not confirmed after cancellation.')), options.timeoutMs ?? 6000);
      try {
        execFile(join(app, 'lib/backend/ynx-process-tree'), [String(pid), '--force'],
          { timeout: options.helperTimeoutMs ?? 4000, maxBuffer: 65536 }, (error, stdout, stderr) => {
            if (error) { finish(Error(`Task process cleanup failed: ${stderr.trim() || error.message}`)); return; }
            helperDone = true; finish();
          });
      } catch (error) { finish(error); }
    });
    pending.set(this, operation);
    operation.then(() => pending.delete(this), error => {
      pending.delete(this);
      this.logger?.error?.('Task cancellation failed; process exit is not confirmed.', error);
    });
    return operation;
  };
}
module.exports = { install };
