// The native host may terminate WebKit without a pagehide event. Persist debug
// presentation state explicitly while the backend is alive, without stopping
// contributions or touching running sessions.
const loads = new WeakMap();
const installed = new WeakSet();
function trackLoad(prototype) {
  if (installed.has(prototype)) return;
  installed.add(prototype);
  const original = prototype.load;
  prototype.load = function (...args) {
    const record = {};
    loads.set(this, record);
    record.promise = Promise.resolve().then(() => original.apply(this, args));
    // Theia's startup contribution does not await these promises. Keep failures
    // observable by the close barrier without an unhandled rejection.
    record.promise.catch(() => {});
    return record.promise;
  };
}
async function persistDebugState(managers) {
  for (const manager of managers) {
    let record = loads.get(manager);
    // Closing before this contribution started must preserve its saved state.
    if (!record) continue;
    while (record) {
      await record.promise;
      if (record === loads.get(manager)) break;
      record = loads.get(manager);
    }
    manager.save();
  }
}
function install() {
  trackLoad(require('@theia/debug/lib/browser/breakpoint/breakpoint-manager').BreakpointManager.prototype);
  trackLoad(require('@theia/debug/lib/browser/debug-watch-manager').DebugWatchManager.prototype);
  trackLoad(require('@theia/debug/lib/browser/debug-configuration-manager').DebugConfigurationManager.prototype);
}
module.exports = { trackLoad, persistDebugState, install };
