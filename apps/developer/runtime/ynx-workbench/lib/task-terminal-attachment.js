const installed = new WeakSet();
let notify = () => {};
function setNotification(callback) { notify = callback; }
function installOn(prototype, timeoutMs = 10000) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const start = prototype.start;
  prototype.start = async function (...args) {
    if (this.options?.isPseudoTerminal) return start.apply(this, args);
    const server = this.shellTerminalServer, widget = this;
    const started = Date.now();
    let failed = false;
    const provider = this.connectionProvider;
    // Retained listen() drops openChannel rejection. Bridge it to the same
    // widget Deferred instead of leaving commands queued forever. Terminal
    // listen uses reconnect=false, so no reconnect registration is omitted.
    const connections = provider && typeof provider.openChannel === 'function' ? new Proxy(provider, { get(target, key) {
      if (key !== 'listen') return Reflect.get(target, key, target);
      return (path, handler, reconnect) => {
        if (reconnect) return target.listen(path, handler, reconnect);
        const pending = widget.waitForConnection;
        void target.openChannel(path, (openedPath, channel) => {
          if (failed || widget.isDisposed || widget.waitForConnection !== pending) { channel.close(); return; }
          handler(openedPath, channel);
        }).catch(error => pending?.reject(error));
      };
    }}) : undefined;
    // A short task may have exited already. Acknowledging attachment before
    // its output channel opens unregisters the retained backend ring buffer.
    const wrapped = new Proxy(server, { get(target, key) {
      if (key !== 'onAttachAttempted') return Reflect.get(target, key, target);
      return async id => {
        let timer, disposeListener;
        try {
          if (widget.isDisposed) throw Error('Terminal was closed before output connected');
          if (!widget.waitForConnection?.promise) throw Error('Terminal output connection was not created');
          await Promise.race([widget.waitForConnection.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Terminal output connection timed out')), timeoutMs);
            if (widget.onDidDispose) disposeListener = widget.onDidDispose(() => reject(Error('Terminal was closed before output connected')));
          })]);
          if (widget.isDisposed) throw Error('Terminal was closed before output connected');
          widget.logger?.info?.(`YNX_TERMINAL_CONNECTION id=${Number.isSafeInteger(id) ? id : -1} phase=connected elapsedMs=${Date.now() - started}`);
        } catch (error) {
          failed = true;
          widget.logger?.warn?.(`YNX_TERMINAL_CONNECTION id=${Number.isSafeInteger(id) ? id : -1} phase=failed elapsedMs=${Date.now() - started}`);
          if (!widget.isDisposed) widget.writeLine?.('Terminal output could not connect. Close this terminal and retry.');
          // Dismissal must not hold up failure cleanup or a later retry.
          try { void Promise.resolve(notify()).catch(() => {}); } catch (_) {}
          // An attachment to an existing process is not ownership of that
          // process. Only this start's freshly created shell can be closed.
          if ((typeof args[0] !== 'number' || args[0] !== id) && Number.isSafeInteger(id) && id >= 0) await server.close(id);
          throw error;
        } finally {
          clearTimeout(timer); disposeListener?.dispose();
          // Even failed attachment must release retained exited tasks. The
          // error propagates, so a failed connection is never called success.
          await server.onAttachAttempted(id);
        }
      };
    }});
    this.shellTerminalServer = wrapped;
    if (connections) this.connectionProvider = connections;
    try { return await start.apply(this, args); }
    finally {
      if (this.shellTerminalServer === wrapped) this.shellTerminalServer = server;
      if (this.connectionProvider === connections) this.connectionProvider = provider;
    }
  };
}
function install() { installOn(require('@theia/terminal/lib/browser/terminal-widget-impl').TerminalWidgetImpl.prototype); }
module.exports = { install, installOn, setNotification };
