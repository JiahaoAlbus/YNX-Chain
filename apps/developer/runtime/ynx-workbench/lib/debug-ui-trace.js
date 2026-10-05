// Opt-in native QA instrumentation: no source, paths, values or error content.
const installed = Symbol.for('ynx.debug-ui-trace');
function traceMethods(targets, send, limit = 300) {
  let sequence = 0, calls = 0, armed = false;
  const emit = (method, phase, call) => {
    if (!armed || sequence >= limit) return;
    try { send({ action: 'debug-ui-trace', seq: ++sequence, event: method, phase: phase === 'begin' ? 'begin' : 'end', count: call }); } catch (_) { /* Preserve execution. */ }
  };
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
  traceMethods([
    ['editor', DebugEditorModel.prototype, ['updateModel', 'updateEditorDecorations', 'createInlineValueDecorations', 'createFrameDecorations', 'deltaDecorations', 'render', 'renderBreakpoints', 'updateBreakpointRanges', 'renderCurrentBreakpoints', 'createBreakpoints']],
    ['inline', DebugInlineValueDecorator.prototype, ['calculateDecorations', 'updateInlineValueDecorations', 'createInlineValueDecorationsInsideRange', 'getWordToPositionsMap']],
    ['thread', DebugThread.prototype, ['stepOver', 'fetchFrames', 'update', 'clear']],
    ['frame', DebugStackFrame.prototype, ['open', 'getScopes']],
  ], record => bridge.postMessage(record));
}
exports.traceMethods = traceMethods;
exports.install = install;
