'use strict';
const URI = require('@theia/core/lib/common/uri').default;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Theia 1.76 runInTerminal returns the persistent terminal's processId.
// DAP distinguishes that shell PID from the debuggee PID. This owned adapter
// changes only the response for a current supervised local Node launch.
// Correlation metadata is not an extension security boundary or a grant.
class LocalJsDebugTerminalContribution {
  constructor(context, sessions) { this.context = context; this.sessions = sessions; this.records = new Map(); this.stopped = false; }
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
    const owner = this;
    const wrapper = async function(request) {
      const context = await owner.context.getContext();
      if (owner.stopped || context?.mode !== 'local' || typeof context.workspace !== 'string' ||
          session.options?.workspaceFolderUri !== new URI(context.workspace).withScheme('file').toString() ||
          request?.arguments?.kind !== 'integrated') return original.call(this, request);
      const result = await original.call(this, request);
      if (!Number.isSafeInteger(result?.processId) || result.processId <= 0) throw Error('Local terminal did not return a real shell PID');
      const { processId, ...remaining } = result;
      return { ...remaining, shellProcessId: processId };
    };
    Object.defineProperty(session, 'runInTerminal', { configurable: true, writable: true, value: wrapper });
    this.records.set(session, { descriptor, wrapper });
  }
  restore(session) {
    const record = this.records.get(session); if (!record) return;
    if (session.runInTerminal === record.wrapper) {
      if (record.descriptor) Object.defineProperty(session, 'runInTerminal', record.descriptor);
      else delete session.runInTerminal;
    }
    this.records.delete(session);
  }
  onStop() { this.stopped = true; this.creation?.dispose(); this.destruction?.dispose(); for (const session of [...this.records.keys()]) this.restore(session); }
}
exports.LocalJsDebugTerminalContribution = LocalJsDebugTerminalContribution;
