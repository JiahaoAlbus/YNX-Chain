'use strict';
const { execFile } = require('node:child_process');
const { isAbsolute, dirname, basename, join } = require('node:path');
const installed = new WeakSet();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// This is the original Theia process adapter, with its normal DAP transport.
// Only our generated, private local C++ launch has an owned tree to retire.
// Attach sessions and arbitrary extension/configuration processes stay outside.
function install(prototype, options = {}) {
  const env = options.environment || process.env;
  if ((options.platform || process.platform) !== 'darwin' || env.YNX_WORKSPACE_MODE !== 'local' || installed.has(prototype)) return;
  const original = prototype.createDebugAdapter;
  if (typeof original !== 'function') throw Error('The original debug adapter creator is unavailable');
  const runHelper = options.runHelper || execFile;
  prototype.createDebugAdapter = async function (session, ...args) {
    const config = session.configuration, request = config?.__ynxCppRunId;
    const generated = config?.type === 'lldb-dap' && config.request === 'launch' && UUID.test(request || '') &&
      session.workspaceFolder?.uri?.fsPath === env.YNX_LOCAL_WORKSPACE && config.cwd === env.YNX_LOCAL_WORKSPACE &&
      typeof env.TMPDIR === 'string' && config.program === join(env.TMPDIR, 'cpp-' + request, 'program');
    if (!generated) return original.call(this, session, ...args);
    const uid = options.uid ?? process.getuid();
    if (dirname(env.TMPDIR) !== '/private/tmp/yi-' + uid || !/^[a-f0-9]{8}-[A-Za-z0-9]{6}$/.test(basename(env.TMPDIR)) ||
        !isAbsolute(env.THEIA_APP_PROJECT_PATH || '') || typeof session.id !== 'string' || !session.id)
      throw Error('C/C++ cleanup requires its original private runtime and session');
    let adapter, pending, acknowledged = false, childClosed = false, observedChild, helperInFlight = false, failed = false;
    let stopping = false, closeHeld = false, helperConfirmed = false, publishClose;
    const onObservedClose = () => { childClosed = true; };
    const dispose = () => { protocol?.dispose(); observedChild?.removeListener('close', onObservedClose); };
    let protocol;
    try {
      adapter = await original.call(this, session, ...args);
      const child = adapter?.process, stop = adapter?.stop;
      if (!child || typeof stop !== 'function' || !Number.isSafeInteger(child.pid) || child.pid <= 1 || typeof child.once !== 'function')
        throw Error('C/C++ launch did not return its original process adapter');
      observedChild = child; child.once('close', onObservedClose);
      const handleClosed = adapter.handleClosed;
      if (typeof handleClosed !== 'function') throw Error('The original C/C++ adapter close contract is unavailable');
      adapter.handleClosed = function () {
        if (stopping) { closeHeld = true; return; }
        return handleClosed.call(this);
      };
      publishClose = () => {
        stopping = false;
        if (closeHeld) { closeHeld = false; handleClosed.call(adapter); }
      };
      protocol = adapter.onMessageReceived(raw => {
        try { const message = JSON.parse(raw); if (message.type === 'response' && message.command === 'disconnect' && message.success === true) acknowledged = true; }
        catch { /* The original transport handles malformed DAP messages. */ }
      });
      adapter.stop = function () {
        if (pending) return pending;
        failed = false;
        stopping = true;
        pending = (async () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            if (!acknowledged && !helperConfirmed) throw Error('C/C++ adapter exited before owned cleanup was confirmed');
            if (!childClosed) await new Promise((resolve, reject) => {
              const closed = () => { clearTimeout(timer); resolve(); };
              const timer = setTimeout(() => { child.removeListener('close', closed); reject(Error('C/C++ adapter streams did not close')); }, options.timeoutMs ?? 6000);
              child.once('close', closed);
            });
            child.stdin?.end(); dispose(); publishClose(); return;
          }
          await new Promise((resolve, reject) => {
            let closed = false, helperDone = false, settled = false;
            const finish = (failed, error) => {
              if (settled || (!failed && (!closed || !helperDone))) return;
              settled = true; clearTimeout(timer); child.removeListener('close', onClose);
              if (failed) reject(error); else resolve();
            };
            const onClose = () => { closed = true; finish(false); };
            child.once('close', onClose);
            const timer = setTimeout(() => finish(true, Error('C/C++ owned process exit was not confirmed')), options.timeoutMs ?? 6000);
            // Keep the adapter alive until the identity-checked helper has
            // captured/reaped its descendants. Killing the root first or using
            // a persisted PID can orphan a pending macOS debugserver.
            try {
              helperInFlight = true;
              runHelper(join(env.THEIA_APP_PROJECT_PATH, 'lib/backend/ynx-process-tree'), [String(child.pid), '--force'],
                { timeout: options.helperTimeoutMs ?? 4000, maxBuffer: 65536 }, error => {
                  helperInFlight = false;
                  if (failed) pending = undefined;
                  if (error) { finish(true, error); return; }
                  helperConfirmed = true;
                  helperDone = true; finish(false);
                });
            } catch (error) { helperInFlight = false; finish(true, error); }
          });
          // The child has exited. The retained stop() calls kill() even after
          // exit, so never issue a second PID signal after confirmed cleanup.
          child.stdin?.end(); dispose(); publishClose();
        })();
        pending.catch(() => { failed = true; if (!helperInFlight) pending = undefined; });
        return pending;
      };
      return adapter;
    } catch (error) { dispose(); throw error; }
  };
  installed.add(prototype);
}
module.exports = { install };
