'use strict';
const URI = require('@theia/core/lib/common/uri').default;
// Theia finalizes output when both the process and its output channel close,
// then unconditionally disposes the widget. Retain that finalization sequence
// for this owned terminal, but use its existing wait-on-exit close interaction.
function retainTerminalOutput(terminal) {
  if (typeof terminal.finalizeAndDispose !== 'function') return;
  let finalized = false;
  terminal.finalizeAndDispose = function () {
    if (finalized) return;
    finalized = true;
    this.term.write('', () => {
      if (this.isDisposed) return;
      if (this._commandHistoryState?.currentCommand) this.finishCurrentCommand();
      this.waitOnExit(true);
    });
  };
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Theia 1.76 runInTerminal returns the persistent terminal's processId.
// DAP distinguishes that shell PID from the debuggee PID. This owned adapter
// changes only the response for a current supervised local Node launch.
// Correlation metadata is not an extension security boundary or a grant.
class LocalJsDebugTerminalContribution {
  constructor(context, sessions) { this.context = context; this.sessions = sessions; this.records = new Map(); this.closedTerminals = new WeakMap(); this.stopped = false; }
  initialize() {
    if (this.creation) return;
    this.creation = this.sessions.onDidCreateDebugSession(session => this.install(session));
    this.destruction = this.sessions.onDidDestroyDebugSession(session => this.restore(session));
  }
  install(session) {
    const configuration = session.configuration, env = configuration?.env;
    if (this.stopped || this.records.has(session) || !['node','pwa-node'].includes(configuration?.type) || configuration.request !== 'launch' ||
        configuration.console !== 'integratedTerminal' || !UUID.test(configuration.__ynxJsLaunch || '') || env?.YNX_JS_DEBUG_LAUNCH !== configuration.__ynxJsLaunch ||
        env.YNX_WORKSPACE_MODE !== 'local' || !UUID.test(env.YNX_LOCAL_PROJECT_ID || '') || !/^[a-f0-9]{64}$/.test(env.YNX_JS_DEBUG_CREDENTIAL || '') ||
        !configuration.runtimeExecutable?.endsWith('/local-js-debug-launcher.sh') || typeof session.runInTerminal !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(session, 'runInTerminal'), original = session.runInTerminal;
    if (descriptor && !descriptor.configurable) throw Error('Local Node terminal response cannot be adapted');
    const owner = this, record = { descriptor, wrapper: undefined, ended: false, terminals: new Set() };
    const wrapper = async function(request) {
      const context = await owner.context.getContext();
      if (record.ended || owner.stopped) throw Error('Local JavaScript terminal launch has ended');
      if (context?.mode !== 'local' || typeof context.workspace !== 'string' ||
          session.options?.workspaceFolderUri !== new URI(context.workspace).withScheme('file').toString() ||
          request?.arguments?.kind !== 'integrated') return original.call(this, request);
      // A new shell receives DAP's current env at PTY creation only. Passing env
      // again to executeCommand serializes credentials into visible shell text.
      if (record.ended) throw Error('Local JavaScript terminal launch has ended');
      const { title, cwd, args, env } = request.arguments;
      const terminal = await this.terminalServer.newTerminal({ title, cwd, env, kind: 'debug', useServerTitle: false });
      const current = () => !record.ended && !owner.stopped && !terminal.isDisposed;
      if (!current()) { terminal.dispose(); throw Error('Local JavaScript terminal launch has ended'); }
      retainTerminalOutput(terminal);
      record.terminals.add(terminal);
      let result;
      try {
        await terminal.start();
        if (!current()) throw Error('Local JavaScript terminal launch has ended');
        await this.terminalServer.open(terminal);
        if (!current()) throw Error('Local JavaScript terminal launch has ended');
        await terminal.executeCommand({ cwd, args });
        if (!current()) throw Error('Local JavaScript terminal launch has ended');
        result = { processId: await terminal.processId };
        if (!current()) throw Error('Local JavaScript terminal launch has ended');
        if (!Number.isSafeInteger(result.processId) || result.processId <= 0) throw Error('Local terminal did not return a real shell PID');
      } catch (error) { await owner.closeTerminal(terminal); record.terminals.delete(terminal); throw error; }
      if (!Number.isSafeInteger(result?.processId) || result.processId <= 0) throw Error('Local terminal did not return a real shell PID');
      const { processId, ...remaining } = result;
      // No-debug targets have no Inspector telemetry. Their authenticated host
      // observer ends the session; never give the adapter the long-lived shell
      // PID to poll or kill as though it were the target.
      return configuration.noDebug === true ? remaining : { ...remaining, shellProcessId: processId };
    };
    Object.defineProperty(session, 'runInTerminal', { configurable: true, writable: true, value: wrapper });
    record.wrapper = wrapper; this.records.set(session, record);
  }
  async closeTerminal(terminal) {
    // Closing the backend shell preserves the widget and its output evidence.
    if (this.closedTerminals.has(terminal)) return this.closedTerminals.get(terminal);
    if (Number.isSafeInteger(terminal.terminalId) && terminal.terminalId >= 0) {
      const closed = Promise.resolve().then(() => terminal.shellTerminalServer.close(terminal.terminalId));
      this.closedTerminals.set(terminal, closed);
      try { await closed; } catch (error) { this.closedTerminals.delete(terminal); throw error; }
    }
  }
  restore(session) {
    const record = this.records.get(session); if (!record) return;
    record.ended = true;
    for (const terminal of record.terminals) void this.closeTerminal(terminal).catch(error => session.logger?.error?.('Local JavaScript shell cleanup failed', error));
    if (session.runInTerminal === record.wrapper) {
      if (record.descriptor) Object.defineProperty(session, 'runInTerminal', record.descriptor);
      else delete session.runInTerminal;
    }
    this.records.delete(session);
  }
  onStop() { this.stopped = true; this.creation?.dispose(); this.destruction?.dispose(); for (const session of [...this.records.keys()]) this.restore(session); }
}
exports.LocalJsDebugTerminalContribution = LocalJsDebugTerminalContribution;

exports.retainTerminalOutput = retainTerminalOutput;
