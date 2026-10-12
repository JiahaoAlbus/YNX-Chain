'use strict';
const URI = require('@theia/core/lib/common/uri').default;
const { PythonTerminalWidget } = require('./python-terminal-widget');
const COMMANDS = Object.freeze({ prepare: 'ynx.debug.terminal.prepare', bind: 'ynx.debug.terminal.bind', finish: 'ynx.debug.terminal.finish', abandon: 'ynx.debug.terminal.abandon' });
function belongsToProject(session, workspace) {
  const root = new URI().withScheme('file').withPath(workspace).normalizePath();
  const explicit = session.options?.workspaceFolderUri;
  if (explicit !== undefined && explicit !== null) return explicit === root.toString();
  // The official Debug Python File command starts with an undefined folder.
  // Admit its resolved file only within this project; the backend supervisor
  // independently verifies real paths and sandbox permissions before launch.
  const inside = path => typeof path === 'string' && path.startsWith('/') &&
    root.isEqualOrParent(new URI().withScheme('file').withPath(path).normalizePath());
  return inside(session.configuration.program) &&
    (session.configuration.cwd === undefined || inside(session.configuration.cwd));
}
class PythonTerminalLifecycle {
  constructor(context, terminals, watcher, sessions) {
    this.context = context; this.terminals = terminals; this.watcher = watcher; this.sessions = sessions;
    this.entries = new Map(); this.threadLifecycles = new Map(); this.stopped = false; this.disposables = [];
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
        !belongsToProject(session, context.workspace)) throw Error('Python terminal needs the current local project launch.');
    if (this.entries.size >= 128) throw Error('Close a completed Python terminal before opening another.');
    this.installThreadLifecycle(session);
    const capability = globalThis.crypto.randomUUID();
    const entry = { sessionId, phase: 'prepared' };
    entry.timeout = setTimeout(() => this.abandon(capability), 30000); entry.timeout.unref?.();
    this.entries.set(capability, entry); return capability;
  }
  installThreadLifecycle(session) {
    if (this.threadLifecycles.has(session) || typeof session.handleThread !== 'function' || typeof session.scheduleUpdateThreads !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(session, 'handleThread'), original = session.handleThread;
    const scheduleDescriptor = Object.getOwnPropertyDescriptor(session, 'scheduleUpdateThreads');
    if (descriptor && !descriptor.configurable || scheduleDescriptor && !scheduleDescriptor.configurable) return;
    const record = { descriptor, scheduleDescriptor, active: new Set(), ended: false, disposables: [], waiting: [] };
    record.cancel = () => { clearTimeout(record.timer); for (const resolve of record.waiting.splice(0)) resolve(); };
    // Retained p-debounce has no cancellation API. Keep its 100 ms coalescing
    // behavior, while making this admitted session's queued refresh retireable.
    record.schedule = () => {
      if (record.ended) return Promise.resolve();
      clearTimeout(record.timer);
      const pending = new Promise(resolve => record.waiting.push(resolve));
      record.timer = setTimeout(() => { const result = session.updateThreads(undefined); for (const resolve of record.waiting.splice(0)) resolve(result); }, 100);
      return pending;
    };
    const cancel = () => { record.ended = true; record.cancel(); };
    record.wrapper = function(event) {
      const { reason, threadId } = event.body;
      if (reason === 'started') record.active.add(threadId);
      else if (reason === 'exited') record.active.delete(threadId);
      const result = original.call(this, event);
      // Theia schedules a threads request 100 ms after a started event, but
      // leaves that timer alive when a short Python process exits meanwhile.
      // Retire that obsolete query; live-thread and breakpoint queries remain.
      if (record.ended || reason === 'exited' && record.active.size === 0) record.cancel();
      return result;
    };
    Object.defineProperty(session, 'handleThread', { configurable: true, writable: true, value: record.wrapper });
    Object.defineProperty(session, 'scheduleUpdateThreads', { configurable: true, writable: true, value: record.schedule });
    for (const event of ['exited', 'terminated']) if (session.connection?.on) record.disposables.push(session.connection.on(event, cancel));
    if (session.onDispose) record.disposables.push(session.onDispose(() => this.releaseThreadLifecycle(session)));
    this.threadLifecycles.set(session, record);
  }
  releaseThreadLifecycle(session) {
    const record = this.threadLifecycles.get(session); if (!record) return;
    this.threadLifecycles.delete(session); record.ended = true; record.cancel();
    for (const disposable of record.disposables) disposable.dispose();
    if (session.handleThread === record.wrapper) {
      if (record.descriptor) Object.defineProperty(session, 'handleThread', record.descriptor);
      else delete session.handleThread;
    }
    if (session.scheduleUpdateThreads === record.schedule) {
      if (record.scheduleDescriptor) Object.defineProperty(session, 'scheduleUpdateThreads', record.scheduleDescriptor);
      else delete session.scheduleUpdateThreads;
    }
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
    for (const session of [...this.threadLifecycles.keys()]) this.releaseThreadLifecycle(session);
    for (const capability of [...this.entries.keys()]) this.abandon(capability);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}
module.exports = { PythonTerminalLifecycle, COMMANDS };
