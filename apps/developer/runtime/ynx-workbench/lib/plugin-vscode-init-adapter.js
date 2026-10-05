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
      closed = true; registration?.dispose(); endListener?.dispose();
    };
    const fail = error => { if (!closed) { release(); lifecycle.fail(error); } };
    try {
      if (configuration && typeof configuration === 'object') {
        configuration = { ...configuration, __ynxTestAdapterRequest: key };
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
    runLifecycles.set(run, { fail(error) { if (entry) entry.finish(error); else { finish(error); run.cancel(); } } });
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
