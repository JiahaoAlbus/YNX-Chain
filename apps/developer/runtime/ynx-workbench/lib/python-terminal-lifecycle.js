'use strict';
const URI = require('@theia/core/lib/common/uri').default;
const { PythonTerminalWidget } = require('./python-terminal-widget');
const COMMANDS = Object.freeze({ prepare: 'ynx.debug.terminal.prepare', bind: 'ynx.debug.terminal.bind', finish: 'ynx.debug.terminal.finish', abandon: 'ynx.debug.terminal.abandon' });
class PythonTerminalLifecycle {
  constructor(context, terminals, watcher, sessions) {
    this.context = context; this.terminals = terminals; this.watcher = watcher; this.sessions = sessions;
    this.entries = new Map(); this.stopped = false; this.disposables = [];
  }
  registerCommands(registry) {
    for (const [operation, id] of Object.entries(COMMANDS)) this.disposables.push(registry.registerCommand({ id }, { execute: (...args) => this[operation](...args) }));
  }
  initialize() {
    this.creationListener ||= this.terminals.onDidCreateTerminal(widget => {
      const capability = widget instanceof PythonTerminalWidget && widget.ownedPythonCreation;
      const entry = capability && this.entries.get(capability);
      if (!entry || entry.widget || entry.phase !== 'prepared' || this.stopped) return;
      entry.widget = widget;
      entry.close = widget.onDidDispose(() => this.release(capability));
    });
  }
  async prepare(sessionId) {
    this.initialize();
    const context = await this.context.getContext();
    const session = this.sessions.getSession(sessionId);
    if (this.stopped || context?.mode !== 'local' || typeof context.workspace !== 'string' || !context.workspace.startsWith('/') ||
        !session || !['python','debugpy'].includes(session.configuration?.type) || session.configuration.request !== 'launch' ||
        session.options?.workspaceFolderUri !== new URI(context.workspace).withScheme('file').toString()) throw Error('Python terminal needs the current local project launch.');
    if (this.entries.size >= 128) throw Error('Close a completed Python terminal before opening another.');
    const capability = globalThis.crypto.randomUUID();
    const entry = { sessionId, phase: 'prepared' };
    entry.timeout = setTimeout(() => this.abandon(capability), 30000); entry.timeout.unref?.();
    this.entries.set(capability, entry); return capability;
  }
  bind(capability, id) {
    const entry = this.entries.get(capability), widget = entry?.widget;
    if (this.stopped || entry?.phase !== 'prepared' || !widget || widget.isDisposed || widget.id !== id || this.terminals.getById(id) !== widget ||
        widget.ownedPythonCreation !== capability) throw Error('Python terminal does not match its exact creation.');
    clearTimeout(entry.timeout); entry.phase = 'bound'; return true;
  }
  finish(capability, code) {
    const entry = this.entries.get(capability), widget = entry?.widget;
    if (this.stopped || entry?.phase !== 'bound' || !widget || widget.isDisposed || widget.terminalId < 0 ||
        (code !== undefined && (!Number.isInteger(code) || code < -2147483648 || code > 2147483647))) throw Error('Python terminal result is stale or invalid.');
    // The session may have just ended normally. Its established creation binding
    // survives that ordering, but cannot be reused after widget close or finish.
    this.watcher.getTerminalClient().onTerminalExitChanged({ terminalId: widget.terminalId, code, reason: 2, attached: false });
    if (widget.exitStatus?.code !== code || widget.exitStatus?.reason !== 2) throw Error('The native Python terminal did not accept its exit status.');
    widget.sealOwnedPythonResult(capability); entry.phase = 'completed'; return true;
  }
  release(capability) {
    const entry = this.entries.get(capability); if (!entry) return;
    this.entries.delete(capability); clearTimeout(entry.timeout); entry.close?.dispose();
  }
  abandon(capability) {
    const entry = this.entries.get(capability); if (!entry) return;
    const widget = entry.widget;
    this.release(capability);
    if (entry.phase !== 'completed' && widget && !widget.isDisposed) widget.dispose();
  }
  onStop() {
    this.stopped = true; this.creationListener?.dispose();
    for (const capability of [...this.entries.keys()]) this.abandon(capability);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
module.exports = { PythonTerminalLifecycle, COMMANDS };
