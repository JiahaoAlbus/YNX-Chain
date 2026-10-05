// Opt-in diagnostic counters only. Never record terminal input/output, titles,
// commands, paths, settings, environment values or errors.
const installed = new WeakSet();
function traceTerminal(prototype, target, limit = 300) {
  const bridge = target.webkit?.messageHandlers?.ynxLocalWorkbench;
  if (target.__ynxTerminalUiTraceEnabled !== true || !bridge || installed.has(prototype)) return;
  installed.add(prototype);
  const states = new WeakMap(); let serial = 0, sequence = 0;
  const state = widget => {
    let value = states.get(widget);
    if (!value) { value = { id: ++serial, bytes: 0, writes: 0, renders: 0 }; states.set(widget, value); }
    return value;
  };
  const number = value => Number.isFinite(value) ? Math.min(2147483647, Math.max(0, Math.floor(value))) : 0;
  const emit = (widget, event) => {
    if (sequence >= limit) return;
    const s = state(widget), render = widget.term?._core?._renderService;
    try { bridge.postMessage({ action: 'terminal-ui-trace', seq: ++sequence, event, id: s.id,
      bytes: number(s.bytes), writes: number(s.writes), renders: number(s.renders),
      opened: +!!widget.termOpened, visible: +!!widget.isVisible, attached: +!!widget.isAttached,
      rows: number(widget.term?.rows), cols: number(widget.term?.cols),
      paused: +!!(render?._isPaused), pending: +!!(render?._renderDebouncer?._animationFrame),
      docVisible: +(target.document?.visibilityState === 'visible'),
      renderer: +!!render, disposed: +!!widget.isDisposed }); } catch { /* Preserve execution. */ }
  };
  for (const method of ['init', 'open', 'write', 'onAfterShow', 'onResize']) {
    const original = prototype[method]; if (typeof original !== 'function') continue;
    prototype[method] = function (...args) {
      const s = state(this), wasOpened = this.termOpened;
      if (method === 'write') { s.writes++; s.bytes += typeof args[0] === 'string' ? new TextEncoder().encode(args[0]).byteLength : args[0]?.byteLength || 0; }
      const result = original.apply(this, args);
      if (!s.listened && this.term?.onRender) {
        s.listened = true;
        this.toDispose.push(this.term.onRender(() => { s.renders++; if (s.renders <= 8) emit(this, 'render'); }));
        const timer = target.setTimeout(() => emit(this, 'settled'), 1000);
        this.toDispose.push({ dispose: () => target.clearTimeout(timer) });
      }
      const render = this.term?._core?._renderService;
      if (render && !s.observed && typeof render._handleIntersectionChange === 'function') {
        s.observed = true;
        const originalObserver = render._handleIntersectionChange, widget = this;
        const observer = function (...entries) { const value = originalObserver.apply(this, entries); emit(widget, 'observer'); return value; };
        render._handleIntersectionChange = observer;
        this.toDispose.push({ dispose() { if (render._handleIntersectionChange === observer) render._handleIntersectionChange = originalObserver; } });
      }
      if (!(method === 'open' && wasOpened) && !(method === 'write' && s.writes > 12)) emit(this, method);
      return result;
    };
  }
}
function install(target = window) {
  if (target.__ynxTerminalUiTraceEnabled !== true) return;
  traceTerminal(require('@theia/terminal/lib/browser/terminal-widget-impl').TerminalWidgetImpl.prototype, target);
}
module.exports = { traceTerminal, install };
