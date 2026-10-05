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
exports.adaptTestController = (controller, Source) => {
  if (controllers.has(controller)) return controller;
  controllers.add(controller);
  const requests = new Map();
  let cancellationDepth = 0;
  const createRun = controller.createTestRun;
  controller.createTestRun = function (request, ...args) {
    const run = createRun.call(this, request, ...args);
    const end = run.end;
    run.end = function () {
      if (this.ended) return;
      end.call(this);
      // The installed framework exposes this event but does not fire it.
      this.onDidEndEmitter.fire();
    };
    const entry = requests.get(request);
    if (entry) {
      entry.runs.add(run);
      run.onDidEnd(() => {
        entry.runs.delete(run);
        if (entry.settled && !entry.runs.size) entry.release();
      });
    }
    return run;
  };
  const runForUI = controller.runTestsForUI;
  controller.runTestsForUI = function (...args) {
    const profile = this.getProfile(args[0]);
    if (!profile) return runForUI.apply(this, args);
    const handler = profile.runHandler;
    const wrapped = (request) => {
      const source = new Source();
      const entry = { source, runs: new Set(), settled: false, release() {
        if (cancellationDepth || requests.get(request) !== entry) return;
        requests.delete(request); source.dispose();
      } };
      requests.set(request, entry);
      try {
        const result = handler.call(profile, request, source.token);
        const settled = () => {
          entry.settled = true;
          if (!entry.runs.size) entry.release();
        };
        if (result?.then) result.then(settled, error => {
          // Preserve the actual failure, and release only after any live runs end.
          console.error(error); settled();
        });
        else settled();
        return result;
      } catch (error) {
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
      cancelRun.call(this, runId);
      targets.forEach(entry => entry.source.cancel());
    } finally {
      cancellationDepth--;
      targets.forEach(entry => { if (!entry.runs.size) entry.release(); });
    }
  };
  const dispose = controller.dispose;
  controller.dispose = function () {
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
