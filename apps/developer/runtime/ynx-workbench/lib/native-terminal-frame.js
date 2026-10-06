// WebKit can withhold a paint callback while the native window is visible.
// Keep xterm's renderer/debouncer; bound only each terminal's pending frame.
const installed = new WeakSet();
function boundedFrames(parent, visible, timeout = 250) {
  const pending = new Map(); let next = 0, disposed = false;
  const cancel = id => {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id);
    parent.clearTimeout(entry.timer);
    if (entry.frame !== undefined) parent.cancelAnimationFrame(entry.frame);
  };
  const scheduleDeadline = (id, entry) => {
    if (entry.timer !== undefined || !visible()) return;
    entry.timer = parent.setTimeout(() => {
      entry.timer = undefined;
      if (visible()) finish(id, entry, parent.performance.now());
    }, timeout);
  };
  const finish = (id, entry, time) => {
    if (disposed || pending.get(id) !== entry) return;
    cancel(id); // Retire before callback: rendering can queue another frame.
    entry.callback(time);
  };
  const request = callback => {
    if (disposed) return 0;
    const id = ++next, entry = { callback };
    pending.set(id, entry);
    entry.frame = parent.requestAnimationFrame(time => finish(id, entry, time));
    scheduleDeadline(id, entry);
    return id;
  };
  const proxy = new Proxy(parent, { get(target, key) {
    if (key === 'requestAnimationFrame') return request;
    if (key === 'cancelAnimationFrame') return cancel;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { window: proxy, resume() {
    for (const [id, entry] of pending) scheduleDeadline(id, entry);
  }, dispose() {
    disposed = true;
    for (const id of pending.keys()) cancel(id);
  } };
}
function installOn(prototype, target) {
  if (!target.webkit?.messageHandlers?.ynxLocalWorkbench || installed.has(prototype)) return;
  installed.add(prototype);
  const states = new WeakMap(), open = prototype.open, show = prototype.onAfterShow;
  prototype.open = function (...args) {
    const result = open.apply(this, args);
    if (!this.termOpened || states.has(this)) return result;
    // This adapter is for the pinned xterm 5.3 debouncer. Refuse a changed
    // shape instead of replacing an unknown renderer or global window API.
    const debouncer = this.term?._core?._renderService?._renderDebouncer;
    const parent = debouncer?._parentWindow;
    if (!parent || typeof parent.requestAnimationFrame !== 'function' || typeof parent.cancelAnimationFrame !== 'function' || typeof debouncer.refresh !== 'function') return result;
    const widget = this;
    const frames = boundedFrames(parent, () => !widget.isDisposed && widget.isAttached && widget.isVisible && !widget.term._core._renderService._isPaused && target.__ynxNativeWindowVisible === true);
    states.set(this, frames);
    const initialFrame = debouncer._animationFrame;
    if (initialFrame !== undefined) parent.cancelAnimationFrame(initialFrame);
    debouncer._animationFrame = undefined;
    debouncer._parentWindow = frames.window;
    const render = this.term._core._renderService, observer = render._handleIntersectionChange;
    const resumeObserver = typeof observer === 'function' ? function (...args) {
      const result = observer.apply(this, args);
      frames.resume();
      return result;
    } : undefined;
    if (resumeObserver) render._handleIntersectionChange = resumeObserver;
    const resume = () => frames.resume();
    target.addEventListener('ynx-window-visibility', resume);
    this.toDispose.push({ dispose() {
      frames.dispose();
      target.removeEventListener('ynx-window-visibility', resume);
      if (render._handleIntersectionChange === resumeObserver) render._handleIntersectionChange = observer;
      if (debouncer._parentWindow === frames.window) {
        debouncer._animationFrame = undefined;
        debouncer._parentWindow = parent;
      }
    } });
    // Preserve queued row ranges and refresh callbacks in the mature
    // debouncer, including its initial frame scheduled during term.open().
    this.term.refresh(0, this.term.rows - 1);
    return result;
  };
  prototype.onAfterShow = function (...args) {
    const result = show.apply(this, args);
    states.get(this)?.resume();
    return result;
  };
}
function install(target = window) {
  installOn(require('@theia/terminal/lib/browser/terminal-widget-impl').TerminalWidgetImpl.prototype, target);
}
module.exports = { boundedFrames, installOn, install };
