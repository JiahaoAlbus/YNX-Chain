'use strict';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
class CppDebugTerminalContribution {
  constructor(context, terminals, sessions, URI, retainOutput) { Object.assign(this, { context, terminals, sessions, URI, retainOutput }); this.records = new Map(); }
  initialize() {
    this.creation = this.sessions.onDidCreateDebugSession(session => {
      const record = this.records.get(session.configuration?.__ynxCppRunId);
      if (!record || session.configuration?.type !== 'lldb-dap' || session.options?.workspaceFolderUri !== new this.URI(record.workspace).withScheme('file').toString()) return;
      record.session = session;
      if (record.ended) void session.stop(false).catch(error => session.logger?.error?.(error));
    });
    this.destruction = this.sessions.onDidDestroyDebugSession(session => {
      const id = session.configuration?.__ynxCppRunId, record = this.records.get(id);
      if (record?.session === session) void this.release(id, true);
    });
  }
  registerCommands(commands) {
    commands.registerCommand({ id: 'ynx.cpp.prepareDebugTerminal' }, { execute: (id, workspace) => this.prepare(id, workspace) });
    commands.registerCommand({ id: 'ynx.cpp.releaseDebugTerminal' }, { execute: (id, discard) => this.release(id, discard === true) });
  }
  async prepare(id, workspace) {
    if (this.stopped || !UUID.test(id || '') || this.records.has(id)) throw Error('C/C++ terminal request is invalid');
    const record = { workspace, ended: false, preparing: true }; this.records.set(id, record);
    const current = () => !this.stopped && !record.ended && this.records.get(id) === record;
    try {
      const context = await this.context.getContext();
      if (!current() || context.mode !== 'local' || context.workspace !== workspace) throw Error('C/C++ terminal project changed');
      record.terminal = await this.terminals.newTerminal({ title: 'C/C++ Debug', cwd: new this.URI(workspace).withScheme('file'), shellPath: '/usr/bin/tail', shellArgs: ['-f', '/dev/null'], env: { YNX_CPP_DEBUG_TERMINAL: id }, kind: 'debug', useServerTitle: false });
      this.retainOutput(record.terminal);
      record.closeListener = record.terminal.onTerminalDidClose(() => { void this.release(id); });
      record.disposeListener = record.terminal.onDidDispose(() => { void this.release(id); });
      if (!current()) throw Error('C/C++ terminal request ended');
      await record.terminal.start();
      if (!current()) throw Error('C/C++ terminal request ended');
      const info = await this.context.getCppTerminalDevice(record.terminal.terminalId, id, workspace);
      if (!current() || !/^\/dev\/ttys[0-9]+$/.test(info?.device || '')) throw Error('C/C++ terminal request ended');
      await this.terminals.open(record.terminal, { mode: 'activate', widgetOptions: { area: 'bottom' } });
      if (!current()) throw Error('C/C++ terminal request ended');
      return info;
    } catch (error) { record.ended = true; throw error; }
    finally { record.preparing = false; if (record.ended) await this.release(id, true); }
  }
  async release(id, discard = false) {
    const record = this.records.get(id); if (!record) return;
    record.ended = true;
    if (record.preparing) return; // Pending creation/start must close its eventual real PTY.
    if (discard) record.discard = true;
    if (record.closing) {
      await record.closing;
      if ((record.discard || record.session) && this.records.get(id) === record) this.records.delete(id);
      return;
    }
    record.closing = Promise.resolve().then(async () => {
      record.closeListener?.dispose(); record.disposeListener?.dispose();
      if (record.session && !record.session.isStopping) await record.session.stop(false);
      if (record.terminal && Number.isSafeInteger(record.terminal.terminalId) && record.terminal.terminalId >= 0)
        await record.terminal.shellTerminalServer.close(record.terminal.terminalId);
      else record.terminal?.dispose();
      record.closeListener?.dispose(); record.disposeListener?.dispose();
      if ((record.discard || record.session) && this.records.get(id) === record) this.records.delete(id);
      // A user may close the PTY between preparation and session creation.
      // Keep this ended request as a tombstone so its late session is stopped.
    });
    try { await record.closing; } catch (error) { record.closing = undefined; throw error; }
  }
  async onStop() { this.stopped = true; this.creation?.dispose(); this.destruction?.dispose(); await Promise.all([...this.records.keys()].map(id => this.release(id))); }
}
module.exports = { CppDebugTerminalContribution };
