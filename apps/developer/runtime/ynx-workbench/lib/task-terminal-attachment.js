const installed = new WeakSet();
function installOn(prototype, timeoutMs = 10000) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const start = prototype.start;
  prototype.start = async function (...args) {
    if (this.kind !== 'task' || this.options?.isPseudoTerminal) return start.apply(this, args);
    const server = this.shellTerminalServer, widget = this;
    // A short task may have exited already. Acknowledging attachment before
    // its output channel opens unregisters the retained backend ring buffer.
    const wrapped = new Proxy(server, { get(target, key) {
      if (key !== 'onAttachAttempted') return Reflect.get(target, key, target);
      return async id => {
        let timer, disposeListener;
        try {
          if (widget.isDisposed) throw Error('Task terminal was closed before output connected');
          if (!widget.waitForConnection?.promise) throw Error('Task output connection was not created');
          await Promise.race([widget.waitForConnection.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Task output connection timed out')), timeoutMs);
            if (widget.onDidDispose) disposeListener = widget.onDidDispose(() => reject(Error('Task terminal was closed before output connected')));
          })]);
          if (widget.isDisposed) throw Error('Task terminal was closed before output connected');
        } finally {
          clearTimeout(timer); disposeListener?.dispose();
          // Even failed attachment must release retained exited tasks. The
          // error propagates, so a failed connection is never called success.
          await server.onAttachAttempted(id);
        }
      };
    }});
    this.shellTerminalServer = wrapped;
    try { return await start.apply(this, args); }
    finally { if (this.shellTerminalServer === wrapped) this.shellTerminalServer = server; }
  };
}
function install() { installOn(require('@theia/terminal/lib/browser/terminal-widget-impl').TerminalWidgetImpl.prototype); }
module.exports = { install, installOn };
