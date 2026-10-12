// Terminal recovery can retry a failed stop. Preserve unresolved failures, but
// remove the failure for this exact state after verified persistence succeeds.
export function createTerminalLifecycle() {
  const starting = new Set(), finishing = new Set(), failures = new Map(), startupFailures = [];
  let closing = false, drainPromise;
  function start(work) {
    if (closing) return Promise.reject(Object.assign(new Error("Service maintenance; reconnect after restart."), { code: "service_maintenance" }));
    const promise = Promise.resolve().then(work); starting.add(promise);
    promise.then(() => starting.delete(promise), error => { starting.delete(promise); if (["child_exit_timeout", "interactive_cleanup_failed"].includes(error?.code)) startupFailures.push(error); });
    return promise;
  }
  function finish(state, work) {
    if (state.finishPromise) return state.finishPromise;
    state.closed = true;
    const promise = Promise.resolve().then(work).then(() => { failures.delete(state); return { ok: true }; }, error => { failures.set(state, error); return { ok: false, error }; }).finally(() => finishing.delete(promise));
    state.finishPromise = promise; finishing.add(promise); return promise;
  }
  function drain(stop) {
    closing = true;
    if (!drainPromise) drainPromise = (async () => { await Promise.allSettled([...starting]); await stop(); await Promise.all([...finishing]); if (failures.size || startupFailures.length) throw Object.assign(new Error("Interactive work could not be saved or stopped; recovery data was retained."), { code: "interactive_cleanup_failed" }); })();
    return drainPromise;
  }
  return { start, finish, drain, accepting: () => !closing, status: () => ({ starting: starting.size, finishing: finishing.size, cleanupFailures: failures.size + startupFailures.length }) };
}
