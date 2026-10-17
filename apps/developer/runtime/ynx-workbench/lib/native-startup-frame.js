// A local workbench must not wait indefinitely for a WebKit paint callback.
// This bounds only the two startup presentation waits, not normal editor frames.
function waitForStartupFrame(target, timeout = 250) {
  return new Promise(resolve => {
    let finished = false, frame;
    const settle = () => {
      if (finished) return;
      finished = true;
      target.clearTimeout(timer);
      if (frame !== undefined) target.cancelAnimationFrame(frame);
      resolve();
    };
    const timer = target.setTimeout(settle, timeout);
    frame = target.requestAnimationFrame(settle);
  });
}
async function startNative(target) {
  const { MeasurementContext } = require('@theia/core/lib/common');
  const startup = this.backendStopwatch.start('frontend');
  this.settlementContext = new MeasurementContext(this.stopwatch, 'Frontend', 100);
  await this.measure('startContributions', () => this.startContributions(), 'Start frontend contributions', false);
  this.stateService.state = 'started_contributions';
  const host = await this.getHost();
  this.attachShell(host);
  this.attachTooltip(host);
  await waitForStartupFrame(target);
  this.stateService.state = 'attached_shell';
  await this.measure('initializeLayout', () => this.initializeLayout(), 'Initialize the workbench layout', false);
  this.stateService.state = 'initialized_layout';
  await this.fireOnDidInitializeLayout();
  await this.measure('revealShell', () => revealNativeShell.call(this, host, target), 'Replace loading indicator with ready workbench UI (animation)', false);
  this.registerEventListeners();
  this.stateService.state = 'ready';
  // A navigation/HTTP receipt is not a restored workbench. Notify Cocoa only
  // after layout, initial-file contributions and the real shell reveal finish.
  const documentId = target.crypto.randomUUID();
  Object.defineProperty(target, '__ynxNativePresentationDocument', { value: documentId, configurable: true });
  target.webkit.messageHandlers.ynxLocalWorkbench.postMessage({ action: 'workbench-ready', documentId });
  this.settlementContext?.armAllSettled();
  startup.then(idToken => this.backendStopwatch.stop(idToken, 'Frontend application startup sequence completed (async work may still be pending)', []));
}
async function revealNativeShell(host, target) {
  const startup = this.getStartupIndicator(host);
  if (!startup) return;
  await waitForStartupFrame(target);
  startup.classList.add('theia-hidden');
  const { parseCssTime } = require('@theia/core/lib/browser/browser');
  const duration = parseCssTime(target.getComputedStyle(startup).transitionDuration, 0);
  await new Promise(resolve => target.setTimeout(resolve, duration));
  startup.parentElement?.removeChild(startup);
}
let installed = false;
function install(target = window) {
  if (installed || !target.webkit?.messageHandlers?.ynxLocalWorkbench) return;
  installed = true;
  const { FrontendApplication } = require('@theia/core/lib/browser/frontend-application');
  const original = FrontendApplication.prototype.start;
  FrontendApplication.prototype.start = function (...args) {
    return target.webkit?.messageHandlers?.ynxLocalWorkbench ? startNative.call(this, target) : original.apply(this, args);
  };
}
module.exports = { waitForStartupFrame, startNative, revealNativeShell, install };
