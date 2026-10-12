// Opt-in native QA instrumentation: no source, paths, values or error content.
const installed = Symbol.for('ynx.debug-ui-trace');
function timerLocations(stack, limit = 4) {
  const locations = [];
  for (const row of String(stack).split('\n')) {
    const match = row.match(/\/([^/\s?:]+\.js):(\d+):(\d+)\)?$/);
    if (!match) continue;
    // A numeric filename fingerprint disambiguates chunks without exposing URLs.
    let hash = 0;
    for (const char of match[1]) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    locations.push(`timer.location.${hash}.${match[2]}.${match[3]}`);
    if (locations.length === limit) break;
  }
  return locations;
}
function traceMethods(targets, send, limit = 300, timers, arrayPrototype) {
  let sequence = 0, calls = 0, armed = false;
  const emit = (method, phase, call) => {
    const ceiling = arrayPrototype && !method.startsWith('array.') ? Math.max(0, limit - 20) : limit;
    if (!armed || sequence >= ceiling) return;
    try { send({ action: 'debug-ui-trace', seq: ++sequence, event: method, phase: phase === 'begin' ? 'begin' : 'end', count: call }); } catch (_) { /* Preserve execution. */ }
  };
  if (arrayPrototype && !arrayPrototype[installed]) {
    const push = arrayPrototype.push;
    let reported = false;
    arrayPrototype.push = function (...items) {
      if (armed && !reported && this.length >= 10000) {
        reported = true;
        const call = ++calls;
        emit('array.largePush', 'begin', call);
        for (const location of timerLocations(new Error().stack, 8)) emit(location.replace('timer.location', 'array.location'), 'begin', call);
      }
      return push.apply(this, items);
    };
    Object.defineProperty(arrayPrototype, installed, { value: true });
  }
  if (timers && !timers[installed]) {
    for (const name of ['setTimeout', 'setInterval']) {
      const schedule = timers[name];
      if (typeof schedule !== 'function') continue;
      timers[name] = function (callback, ...args) {
        if (typeof callback !== 'function') return schedule.call(this, callback, ...args);
        const locations = timerLocations(new Error().stack);
        return schedule.call(this, function (...values) {
          const call = ++calls;
          for (const location of locations) emit(location, 'begin', call);
          emit('timer.' + name, 'begin', call);
          try { return callback.apply(this, values); }
          finally { emit('timer.' + name, 'end', call); }
        }, ...args);
      };
    }
    Object.defineProperty(timers, installed, { value: true });
  }
  for (const [label, prototype, methods] of targets) {
    if (!prototype || prototype[installed]) continue;
    for (const method of methods) {
      const original = prototype[method];
      if (typeof original !== 'function') continue;
      prototype[method] = function (...args) {
        if (label === 'thread' && method === 'stepOver') armed = true;
        const call = ++calls;
        emit(label + '.' + method, 'begin', call);
        try {
          const result = original.apply(this, args);
          if (result && typeof result.then === 'function') {
            result.then(() => emit(label + '.' + method, 'end', call), () => emit(label + '.' + method, 'reject', call));
          } else emit(label + '.' + method, 'end', call);
          return result;
        } catch (error) { emit(label + '.' + method, 'throw', call); throw error; }
      };
    }
    Object.defineProperty(prototype, installed, { value: true });
  }
}
function install(target = globalThis) {
  if (target.__ynxDebugUiTraceEnabled !== true) return;
  const bridge = target.webkit?.messageHandlers?.ynxLocalWorkbench;
  if (!bridge) return;
  const { DebugEditorModel } = require('@theia/debug/lib/browser/editor/debug-editor-model');
  const { DebugInlineValueDecorator } = require('@theia/debug/lib/browser/editor/debug-inline-value-decorator');
  const { DebugThread } = require('@theia/debug/lib/browser/model/debug-thread');
  const { DebugStackFrame } = require('@theia/debug/lib/browser/model/debug-stack-frame');
  const { TabBarDecoratorService } = require('@theia/core/lib/browser/shell/tab-bar-decorator');
  const { DecorationsServiceImpl } = require('@theia/core/lib/browser/decorations-service');
  const { TreeWidget } = require('@theia/core/lib/browser/tree/tree-widget');
  const { StatusBarImpl } = require('@theia/core/lib/browser/status-bar/status-bar');
  traceMethods([
    ['editor', DebugEditorModel.prototype, ['updateModel', 'updateEditorDecorations', 'createInlineValueDecorations', 'createFrameDecorations', 'deltaDecorations', 'render', 'renderBreakpoints', 'updateBreakpointRanges', 'renderCurrentBreakpoints', 'createBreakpoints']],
    ['inline', DebugInlineValueDecorator.prototype, ['calculateDecorations', 'updateInlineValueDecorations', 'createInlineValueDecorationsInsideRange', 'getWordToPositionsMap']],
    ['thread', DebugThread.prototype, ['stepOver', 'fetchFrames', 'update', 'clear']],
    ['frame', DebugStackFrame.prototype, ['open', 'getScopes']],
    ['tab', TabBarDecoratorService.prototype, ['getDecorations']],
    ['decorations', DecorationsServiceImpl.prototype, ['getDecoration']],
    ['tree', TreeWidget.prototype, ['doUpdateDecorations', 'doUpdateRows', 'updateRows']],
    ['status', StatusBarImpl.prototype, ['update']],
  ], record => bridge.postMessage(record), 300, target, Array.prototype);
}
exports.traceMethods = traceMethods;
exports.timerLocations = timerLocations;
exports.install = install;
