// Keep VS Code extension disposal semantics separate from the framework's
// internal cancellation policy. Disposing a source releases listeners; only
// explicit cancellation requests should cancel pending extension results.
const constructors = new WeakMap();
const emptyToken = Object.freeze({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
});
const testApis = new WeakSet();
const controllers = new WeakSet();
const runLifecycles = new WeakMap();
const debugApis = new WeakSet();
const testDebugAttempts = new Map();
const localDebugApis = new WeakSet();
exports.adaptLocalDebugging = (api, environment = process.env) => {
  const debug = api.debug;
  if (environment.YNX_WORKSPACE_MODE !== 'local' || !environment.YNX_DEBUG_SOCKET ||
      !/^[a-f0-9]{64}$/.test(environment.YNX_DEBUG_CREDENTIAL || '') ||
      environment.YNX_DEBUG_PROJECT !== environment.YNX_LOCAL_PROJECT_ID ||
      Object.keys(environment).some(key => key.startsWith('YNX_CORE_')) ||
      !debug?.registerDebugAdapterDescriptorFactory || localDebugApis.has(debug)) return;
  localDebugApis.add(debug);
  const createPythonTerminal = require('./python-terminal-creation').createPythonTerminalFactory(api);
  const register = debug.registerDebugAdapterDescriptorFactory;
  debug.registerDebugAdapterDescriptorFactory = function (type, factory) {
    if (!['debugpy', 'python'].includes(type)) return register.call(this, type, factory);
    return register.call(this, type, {
      async createDebugAdapterDescriptor(session, executable) {
        const descriptor = await factory.createDebugAdapterDescriptor(session, executable);
        if (session.configuration?.request !== 'launch') return descriptor;
        if (!descriptor?.command || !Array.isArray(descriptor.args)) throw Error('Local Python launch requires the reviewed debugpy executable');
        if (session.configuration.console === 'externalTerminal') throw Error('External Python debug terminals are not supported by the local sandbox; select internalConsole or integratedTerminal');
        const { connect } = require('node:net');
        const { randomUUID } = require('node:crypto');
        const emitter = new api.EventEmitter(), writes = new api.EventEmitter(), exits = new api.EventEmitter();
        const socket = connect(environment.YNX_DEBUG_SOCKET); socket.setEncoding('utf8');
        let ready = false, disposed = false, graceful = false, buffer = '', terminal, terminalExited = false, terminalRequest, termination;
        let terminalCapability, terminalClosed = false, terminalResultPublished = false, deferredTermination, drainTimer, processing = Promise.resolve();
        const pending = new Map();
        const send = message => { if (!disposed && !socket.destroyed) socket.write(JSON.stringify(message) + '\n'); };
        let resolve, reject;
        const preparation = new Promise((ok, fail) => { resolve = ok; reject = fail; });
        const timeout = setTimeout(() => fail(Error('Local Python supervisor did not admit this session')), 10000);
        const releaseTerminal = () => { writes.dispose(); exits.dispose(); };
        const dispose = (force = false) => {
          if (!force && terminal && !terminalExited && graceful) {
            // A normal DAP termination can precede the PTY's final data/exit.
            // Keep its transport alive for a bounded drain, not forever.
            drainTimer ||= setTimeout(() => fail(Error('Python terminal exit was not received after debugger termination')), 5000);
            return;
          }
          if (disposed) return; send({ op: 'stop' }); disposed = true;
          if (!graceful) testDebugAttempts.get(session.configuration.__ynxTestAdapterRequest)?.cancel();
          clearTimeout(timeout); clearTimeout(drainTimer); termination?.dispose(); socket.end();
          // Result widgets are user-owned after process completion. Disposing
          // the adapter must not discard their transcript or actual exit code.
          if (!terminal || terminalClosed) releaseTerminal();
          if (terminalCapability && !terminalResultPublished && !terminalClosed) {
            // No accepted frontend result exists: retire the unfinished widget,
            // including rejected finish calls; never leave a Running result.
            Promise.resolve(api.commands.executeCommand('ynx.debug.terminal.abandon', terminalCapability))
              .catch(error => console.error('Python terminal cleanup:', error))
              .finally(releaseTerminal);
          }
          emitter.dispose();
        };
        function fail(error) {
          if (disposed) return;
          clearTimeout(timeout);
          testDebugAttempts.get(session.configuration.__ynxTestAdapterRequest)?.fail(error);
          if (!ready) reject(error);
          else {
            for (const message of pending.values()) emitter.fire({ type: 'response', seq: 0, request_seq: message.seq, command: message.command, success: false, message: error.message });
            pending.clear();
            emitter.fire({ type: 'event', seq: 0, event: 'output', body: { category: 'stderr', output: `Local Python debug session: ${error.message}\n` } });
            emitter.fire({ type: 'event', seq: 0, event: 'terminated' });
          }
          dispose(true);
        }
        socket.once('connect', () => send({ op: 'start', credential: environment.YNX_DEBUG_CREDENTIAL,
          projectId: environment.YNX_DEBUG_PROJECT, requestId: randomUUID(), command: descriptor.command, args: descriptor.args, options: descriptor.options }));
        socket.on('error', fail);
        socket.on('close', () => {
          // Socket close can precede completion of async bind/finish handlers.
          // Publish all already-received tail/exit messages before teardown.
          processing = processing.then(() => { if (!disposed) { if (graceful) dispose(); else fail(Error('Python debug adapter connection closed')); } }).catch(fail);
        });
        socket.on('data', chunk => {
          buffer += chunk;
          if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) return fail(Error('Python debug message exceeded its bound'));
          for (let end; (end = buffer.indexOf('\n')) >= 0;) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            processing = processing.then(async () => {
              const message = JSON.parse(line);
              if (message.kind === 'ready') {
                clearTimeout(timeout); ready = true;
                resolve(new api.DebugAdapterInlineImplementation({
                  onDidSendMessage: emitter.event,
                  handleMessage(message) { if (disposed) return; if (message.type === 'request') pending.set(message.seq, message); send({ op: 'dap', message }); }, dispose,
                }));
              } else if (message.kind === 'dap') {
                const dap = message.message;
                if (dap.type === 'response') pending.delete(dap.request_seq);
                if (dap.type === 'request' && dap.command === 'runInTerminal') {
                  if (terminalRequest || dap.arguments?.kind !== 'integrated' || !api.window?.createTerminal) throw Error('Unsupported Python terminal request');
                  terminalRequest = dap;
                  if (!api.commands?.executeCommand) throw Error('The owned Python terminal lifecycle bridge is missing');
                  terminalCapability = await api.commands.executeCommand('ynx.debug.terminal.prepare', session.id);
                  terminal = createPythonTerminal(terminalCapability, { name: dap.arguments.title || 'Python Debug', pty: {
                    onDidWrite: writes.event, onDidClose: exits.event,
                    open(dimensions) { send({ op: 'terminal', requestSeq: dap.seq }); if (dimensions) send({ op: 'resize', ...dimensions }); },
                    close() { terminalClosed = true; releaseTerminal(); if (!disposed && !terminalExited) { graceful = false; emitter.fire({ type: 'event', seq: 0, event: 'terminated' }); dispose(true); } },
                    handleInput(data) { if (!terminalExited) send({ op: 'input', data }); },
                    setDimensions(dimensions) { if (!terminalExited) send({ op: 'resize', ...dimensions }); },
                  } });
                  await api.commands.executeCommand('ynx.debug.terminal.bind', terminalCapability, await terminal.id.promise);
                  terminal.show();
                } else {
                  if (dap.type === 'event' && dap.event === 'terminated') {
                    graceful = true;
                    if (terminal && !terminalExited) { deferredTermination = dap; dispose(); return; }
                  }
                  emitter.fire(dap);
                }
              } else if (message.kind === 'terminalData') {
                writes.fire(message.data);
              } else if (message.kind === 'terminalExit') {
                terminalExited = true; clearTimeout(drainTimer);
                if (!terminalClosed) {
                  await api.commands.executeCommand('ynx.debug.terminal.finish', terminalCapability, message.exitCode);
                  terminalResultPublished = true;
                }
                if (deferredTermination) { const event = deferredTermination; deferredTermination = undefined; emitter.fire(event); }
              }
              else if (message.kind === 'stderr' || message.kind === 'warning') emitter.fire({ type: 'event', seq: 0, event: 'output', body: { category: 'stderr', output: message.data || message.message + '\n' } });
              else if (message.kind === 'error') fail(Error(message.message));
              else if (message.kind === 'exit') {
                if (pending.size || !graceful) fail(Error(`Python adapter exited before session completed (${message.code ?? message.signal})`));
                else {
                  if (terminal && !terminalExited) { deferredTermination ||= { type: 'event', seq: 0, event: 'terminated' }; dispose(); }
                  else { emitter.fire({ type: 'event', seq: 0, event: 'terminated' }); dispose(); }
                }
              }
            }).catch(fail);
          }
        });
        termination = debug.onDidTerminateDebugSession?.(ended => { if (ended.id === session.id) { if (!ready) reject(Error('Python debug session was cancelled')); dispose(); } });
        return preparation;
      },
    });
  };
};
const localJsApis = new WeakSet();
exports.adaptLocalJsDebugging = (api, environment = process.env) => {
  const debug = api.debug;
  if (environment.YNX_WORKSPACE_MODE !== 'local' || !environment.YNX_JS_DEBUG_SOCKET ||
      !/^[a-f0-9]{64}$/.test(environment.YNX_JS_DEBUG_CREDENTIAL || '') ||
      environment.YNX_JS_DEBUG_PROJECT !== environment.YNX_LOCAL_PROJECT_ID ||
      !environment.YNX_JS_DEBUG_LAUNCHER || !environment.YNX_JS_DEBUG_NODE ||
      Object.keys(environment).some(key => key.startsWith('YNX_CORE_')) ||
      !debug?.registerDebugConfigurationProvider || localJsApis.has(debug)) return;
  localJsApis.add(debug);
  const launches = new Map(), pendingCleanup = new Set(), cleanupErrors = [], register = debug.registerDebugConfigurationProvider;
  const request = message => new Promise((ok, bad) => {
    const socket = require('node:net').connect(environment.YNX_JS_DEBUG_SOCKET); socket.setEncoding('utf8'); let buffer = '', settled = false;
    const timer = setTimeout(() => { socket.destroy(); bad(Error('Local JavaScript supervisor did not admit this launch')); }, 5000);
    const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.end(); error ? bad(error) : ok(value); };
    socket.once('connect', () => socket.write(JSON.stringify({ ...message, credential: environment.YNX_JS_DEBUG_CREDENTIAL, projectId: environment.YNX_LOCAL_PROJECT_ID }) + '\n'));
    socket.on('error', error => done(error)); socket.on('close', () => done(Error('Local JavaScript supervisor closed before admission')));
    socket.on('data', data => { buffer += data; if (Buffer.byteLength(buffer) > 65536) return done(Error('Invalid JavaScript admission response')); const end = buffer.indexOf('\n'); if (end < 0) return; try { const value = JSON.parse(buffer.slice(0, end)); done(value.kind === 'error' ? Error(value.message) : undefined, value); } catch (error) { done(error); } });
  });
  function release(id) {
    const record = launches.get(id); if (!record) return;
    clearTimeout(record.timer); launches.delete(id);
    const task = request({ op: 'cancel', launchId: id }); pendingCleanup.add(task);
    task.then(() => pendingCleanup.delete(task), error => { pendingCleanup.delete(task); cleanupErrors.push(error); }); return task;
  }
  const childChoices = new WeakMap(); let singleTargetNotice = false;
  const childChoice = configuration => childChoices.get(configuration) || { explicit: Object.prototype.hasOwnProperty.call(configuration || {}, 'autoAttachChildProcesses'), value: configuration?.autoAttachChildProcesses };
  async function configure(configuration, choice) {
    if (!configuration || configuration.request !== 'launch' || configuration.__pendingTargetId) return configuration;
    if (configuration.__ynxJsLaunch) { if (!launches.has(configuration.__ynxJsLaunch)) throw Error('Unknown local JavaScript launch correlation'); return configuration; }
    const runtime = configuration.runtimeExecutable;
    if (runtime && runtime !== 'node' && runtime !== environment.YNX_JS_DEBUG_NODE) throw Error('Select the bundled Node runtime for supervised local JavaScript debugging. Custom runtime configuration was retained.');
    if (configuration.runtimeArgs && (!Array.isArray(configuration.runtimeArgs) || configuration.runtimeArgs.some(value => typeof value !== 'string'))) throw Error('Invalid JavaScript runtime arguments');
    if (choice.explicit && choice.value !== undefined && typeof choice.value !== 'boolean') throw Error('Invalid explicit child-process debugging configuration');
    if (choice.explicit && choice.value === true) throw Error('Child-process debugging requires separate supervised endpoints; use a single Node launch in this local profile.');
    if (!choice.explicit && configuration.autoAttachChildProcesses === true && !singleTargetNotice) {
      if (!api.window?.showInformationMessage) throw Error('This local launch supports one Node process. Choose autoAttachChildProcesses: false explicitly to proceed.');
      await api.window.showInformationMessage('Local JavaScript debugging currently supports one Node process. Child-process debugging remains unavailable in this profile.'); singleTargetNotice = true;
    }
    if (launches.size >= 8) throw Error('Too many local JavaScript launches are pending. End a current session and retry.');
    const prepared = await request({ op: 'prepare', console: configuration.console || 'internalConsole', noDebug: configuration.noDebug === true, program: configuration.program, cwd: configuration.cwd });
    if (prepared.kind !== 'prepared' || !/^[a-f0-9-]{36}$/.test(prepared.launchId || '')) throw Error('Invalid JavaScript launch admission');
    const timer = setTimeout(() => { release(prepared.launchId)?.catch(error => console.error('JavaScript launch expiry:', error)); }, 30000); timer.unref?.();
    launches.set(prepared.launchId, { timer });
    const mapping = prepared.sourceMapping;
    if (mapping && (configuration.localRoot || configuration.remoteRoot) && (configuration.localRoot !== mapping.localRoot || configuration.remoteRoot !== mapping.remoteRoot)) { await release(prepared.launchId); throw Error('Existing localRoot/remoteRoot conflicts with this verified local project alias. Configuration was retained.'); }
    return { ...configuration, ...(!configuration.localRoot && !configuration.remoteRoot && mapping ? mapping : {}), runtimeExecutable: environment.YNX_JS_DEBUG_LAUNCHER, autoAttachChildProcesses: false, __ynxJsLaunch: prepared.launchId,
      env: { ...(configuration.env || {}), YNX_JS_DEBUG_SOCKET: environment.YNX_JS_DEBUG_SOCKET, YNX_JS_DEBUG_CREDENTIAL: environment.YNX_JS_DEBUG_CREDENTIAL,
        YNX_JS_DEBUG_LAUNCH: prepared.launchId, YNX_LOCAL_PROJECT_ID: environment.YNX_LOCAL_PROJECT_ID, YNX_WORKSPACE_MODE: 'local' } };
  }
  debug.registerDebugConfigurationProvider = function (type, provider, trigger) {
    if (!['node', 'pwa-node'].includes(type)) return register.call(this, type, provider, trigger);
    const original = provider.resolveDebugConfigurationWithSubstitutedVariables;
    const wrapper = Object.create(provider);
    if (provider.resolveDebugConfiguration) wrapper.resolveDebugConfiguration = async (...args) => { const choice = childChoice(args[1]); const result = await provider.resolveDebugConfiguration.apply(provider, args); if (result && typeof result === 'object') childChoices.set(result, choice); return result; };
    wrapper.resolveDebugConfigurationWithSubstitutedVariables = async (...args) => {
      const choice = childChoice(args[1]);
      const configuration = original ? await original.apply(provider, args) : args[1];
      const result = await configure(configuration, choice); if (result && typeof result === 'object') childChoices.set(result, choice); return result;
    };
    return register.call(this, type, wrapper, trigger);
  };
  const registerFactory = debug.registerDebugAdapterDescriptorFactory;
  if (registerFactory) debug.registerDebugAdapterDescriptorFactory = function (type, factory) {
    if (!['node', 'pwa-node'].includes(type)) return registerFactory.call(this, type, factory);
    const wrapper = Object.create(factory);
    wrapper.createDebugAdapterDescriptor = async (...args) => {
      try { return await factory.createDebugAdapterDescriptor.apply(factory, args); }
      catch (error) { await release(args[0]?.configuration?.__ynxJsLaunch)?.catch(cleanup => console.error('JavaScript descriptor cleanup:', cleanup)); throw error; }
    };
    return registerFactory.call(this, type, wrapper);
  };
  debug.onDidStartDebugSession?.(session => {
    const record = launches.get(session.configuration?.__ynxJsLaunch);
    if (record) clearTimeout(record.timer);
  });
  debug.onDidTerminateDebugSession?.(session => {
    release(session.configuration?.__ynxJsLaunch)?.catch(error => console.error('JavaScript debug cleanup:', error));
  });
  return {
    async whenIdle() { while (pendingCleanup.size) await Promise.allSettled([...pendingCleanup]); if (cleanupErrors.length) throw new AggregateError(cleanupErrors.splice(0), 'Local JavaScript debug cleanup failed'); },
    async dispose() { for (const id of [...launches.keys()]) release(id); await this.whenIdle(); }
  };
};
let debugRequestId = 0;
function adaptTestDebugging(debug) {
  if (!debug?.registerDebugAdapterTrackerFactory || debugApis.has(debug)) return;
  debugApis.add(debug);
  const start = debug.startDebugging;
  debug.startDebugging = function (folder, configuration, options) {
    const run = options?.testRun, lifecycle = runLifecycles.get(run);
    if (!lifecycle) return start.call(this, folder, configuration, options);
    if (run.ended || run.token.isCancellationRequested) return Promise.resolve(false);
    // An ephemeral correlation key, never a permission or persisted identity.
    // Named launch configurations cannot carry it; their false/reject path is
    // still handled, but tracker correlation requires the normal config object.
    const key = `${run.id}:${++debugRequestId}`;
    let registration, endListener, closed = false, launched = false;
    const release = () => {
      closed = true; testDebugAttempts.delete(key); registration?.dispose(); endListener?.dispose();
    };
    const fail = error => { if (!closed) { release(); lifecycle.fail(error); } };
    try {
      if (configuration && typeof configuration === 'object') {
        configuration = { ...configuration, __ynxTestAdapterRequest: key };
        testDebugAttempts.set(key, { fail, cancel() { if (!closed) { release(); lifecycle.cancel(); } } });
        registration = debug.registerDebugAdapterTrackerFactory('*', {
          createDebugAdapterTracker(session) {
            if (closed || session.configuration?.__ynxTestAdapterRequest !== key) return;
            return {
              onDidSendMessage(message) {
                if (message.type !== 'response' || !['initialize', 'launch', 'attach'].includes(message.command)) return;
                if (message.success === false) fail(new Error(message.message || `Debug adapter ${message.command} failed`));
                else if (message.success === true && (message.command === 'launch' || message.command === 'attach')) launched = true;
              },
              onError: fail,
              onExit() {
                // Theia 1.76 drops exit code/signal. A connection closed before
                // launch is authoritative failure; after launch preserve normal
                // test-result pipe draining and the extension's own end().
                if (!launched) fail(new Error('Debug adapter connection closed before launch completed'));
                else release();
              },
            };
          },
        });
      }
      endListener = run.onDidEnd(release);
      const result = start.call(this, folder, configuration, options);
      return Promise.resolve(result).then(value => {
        if (!value) fail(new Error('Debug session could not be started'));
        return value;
      }, error => { fail(error); throw error; });
    } catch (error) { fail(error); throw error; }
  };
}
exports.adaptTestController = (controller, Source) => {
  if (controllers.has(controller)) return controller;
  controllers.add(controller);
  const requests = new Map();
  // Weak tombstones retain cancellation/failure for late async createTestRun.
  const requestEntries = new WeakMap();
  let disposed = false;
  let cancellationDepth = 0;
  const createRun = controller.createTestRun;
  controller.createTestRun = function (request, ...args) {
    const run = createRun.call(this, request, ...args);
    const end = run.end;
    const states = new Map();
    const update = run.updateTestState;
    run.updateTestState = function (item, state) {
      if (!this.ended) states.set(item, state.state);
      return update.call(this, item, state);
    };
    const output = run.appendOutput;
    run.appendOutput = function (...values) {
      if (!this.ended) return output.apply(this, values);
    };
    run.end = function () {
      if (this.ended) return;
      end.call(this);
      // The installed framework exposes this event but does not fire it.
      this.onDidEndEmitter.fire();
    };
    const entry = requestEntries.get(request);
    const finish = (error) => {
      if (run.ended) return;
      if (error) {
        const message = { message: error instanceof Error ? error.message : String(error) };
        run.appendOutput(`Test execution error: ${message.message}\r\n`);
        // State values are the retained framework's Queued/Running. Never
        // overwrite completed tests or pretend a cancellation is a failure.
        for (const [item, state] of states) if (state === 1 || state === 2) run.errored(item, message);
      }
      run.end();
    };
    runLifecycles.set(run, { fail(error) { if (entry) entry.finish(error); else { finish(error); run.cancel(); } }, cancel() { if (entry) entry.finish(); else { finish(); run.cancel(); } } });
    if (entry) {
      entry.runs.add(run);
      run.onDidEnd(() => {
        entry.runs.delete(run);
        // Native activeRuns is keyed by request, so an intermediate run end
        // must not remove another live run created for that same request.
        const remaining = [...entry.runs].find(value => !value.ended);
        if (remaining) controller.activeRuns.set(request, remaining);
        if (entry.settled && !entry.runs.size) entry.release();
      });
      entry.finishRun.set(run, finish);
      if (entry.finished) {
        run.cancel();
        finish(entry.error);
      }
    } else if (disposed) {
      run.cancel(); finish();
    }
    return run;
  };
  const runForUI = controller.runTestsForUI;
  controller.runTestsForUI = function (...args) {
    if (disposed) return;
    const profile = this.getProfile(args[0]);
    if (!profile) return runForUI.apply(this, args);
    const handler = profile.runHandler;
    const wrapped = (request) => {
      const source = new Source();
      const entry = { source, runs: new Set(), finishRun: new WeakMap(), settled: false, finished: disposed, error: undefined,
        finish(error) {
          if (entry.finished) return;
          entry.finished = true; entry.error = error;
          // Seal results before notifying cancellation listeners, which may
          // synchronously end runs or create another run.
          cancellationDepth++;
          try {
            const live = [...entry.runs];
            for (const run of live) entry.finishRun.get(run)(error);
            source.cancel();
            for (const run of live) run.cancel();
          } finally {
            cancellationDepth--; entry.release();
          }
        }, release() {
        if (cancellationDepth || requests.get(request) !== entry) return;
        requests.delete(request); source.dispose();
      } };
      requests.set(request, entry);
      requestEntries.set(request, entry);
      try {
        const result = handler.call(profile, request, source.token);
        const settled = () => {
          entry.settled = true;
          if (!entry.runs.size) entry.release();
        };
        if (result?.then) result.then(settled, error => {
          console.error(error); entry.finish(error); settled();
        });
        else settled();
        return result;
      } catch (error) {
        entry.finish(error);
        entry.settled = true;
        if (!entry.runs.size) entry.release();
        throw error;
      }
    };
    profile.runHandler = wrapped;
    try { return runForUI.apply(this, args); }
    finally { if (profile.runHandler === wrapped) profile.runHandler = handler; }
  };
  const cancelRun = controller.cancelRun;
  controller.cancelRun = function (runId) {
    const targets = [...requests.values()].filter(entry => runId === undefined ||
      [...entry.runs].some(run => run.id === runId));
    cancellationDepth++;
    try {
      if (runId === undefined || !targets.length || [...this.activeRuns.values()].some(run => run.id === runId)) {
        cancelRun.call(this, runId);
      } else {
        // Several native runs can share one request, but only the latest is
        // present in the framework map. Select the actual owned run by ID.
        for (const entry of targets) for (const run of entry.runs) if (run.id === runId) run.cancel();
      }
      targets.forEach(entry => {
        // Native cancellation comes first, preserving adapter process cleanup.
        entry.source.cancel(); entry.finish();
      });
    } finally {
      cancellationDepth--;
      targets.forEach(entry => { if (!entry.runs.size) entry.release(); });
    }
  };
  const dispose = controller.dispose;
  controller.dispose = function () {
    disposed = true;
    this.cancelRun();
    [...requests.values()].forEach(entry => entry.release());
    return dispose.call(this);
  };
  return controller;
};
exports.adaptApi = api => {
  const NativeSource = api.CancellationTokenSource;
  let CompatibleSource = constructors.get(NativeSource);
  if (!CompatibleSource) {
    CompatibleSource = class extends NativeSource {
      cancel() {
        if (this._token === emptyToken) return;
        super.cancel();
      }
      dispose(cancel = false) {
        if (cancel) this.cancel();
        this._parentListener?.dispose();
        if (!this._token) this._token = emptyToken;
        else this._token.dispose?.();
      }
    };
    constructors.set(NativeSource, CompatibleSource);
  }
  api.CancellationTokenSource = CompatibleSource;
  exports.adaptLocalDebugging(api);
  exports.adaptLocalJsDebugging(api);
  adaptTestDebugging(api.debug);
  if (api.tests && !testApis.has(api.tests)) {
    testApis.add(api.tests);
    const create = api.tests.createTestController;
    api.tests.createTestController = function (...args) {
      return exports.adaptTestController(create.apply(this, args), CompatibleSource);
    };
  }
  return api;
};

exports.doInitialization = (apiFactory, plugin) => {
  // This owned file is copied beside the framework's sealed initializer.
  // Delegate plugin attribution, CJS/ESM loading and version metadata intact.
  require('./plugin-vscode-init').doInitialization(
    owner => exports.adaptApi(apiFactory(owner)), plugin);
};
