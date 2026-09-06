// Track startup and persistence as well as attached sockets. Removing a session
// from a map is not evidence that its asynchronous cleanup has completed.
export function createSessionLifecycle() {
  const starting = new Set(), finishing = new Set(), failures = [];
  let closing = false, drainPromise;
  function start(work) {
    if (closing) return Promise.reject(Object.assign(new Error("Service maintenance; reconnect after restart."), { code: "service_maintenance" }));
    const promise = Promise.resolve().then(work);
    starting.add(promise);
    promise.then(() => starting.delete(promise), error => {
      starting.delete(promise);
      if (["child_exit_timeout", "interactive_cleanup_failed"].includes(error?.code)) failures.push(error);
    });
    return promise;
  }
  function finish(state, work) {
    if (state.finishPromise) return state.finishPromise;
    state.closed = true;
    state.finishPromise = Promise.resolve().then(work).then(() => ({ ok: true }), error => { failures.push(error); return { ok: false, error }; })
      .finally(() => finishing.delete(state.finishPromise));
    finishing.add(state.finishPromise);
    return state.finishPromise;
  }
  function drain(stop) {
    closing = true;
    if (!drainPromise) drainPromise = (async () => {
      await Promise.allSettled([...starting]);
      await stop();
      await Promise.all([...finishing]);
      if (failures.length) throw Object.assign(new Error("Interactive work could not be saved or stopped; recovery data was retained."), { code: "interactive_cleanup_failed" });
    })();
    return drainPromise;
  }
  return { start, finish, drain, accepting: () => !closing,
    status: () => ({ starting: starting.size, finishing: finishing.size, cleanupFailures: failures.length }) };
}

export async function closeWebSockets(wss) {
  for (const socket of wss.clients) socket.close(1001, "Service maintenance; reconnect after restart");
  await new Promise(resolve => {
    const timer = setTimeout(() => { for (const socket of wss.clients) socket.terminate(); }, 500);
    wss.close(() => { clearTimeout(timer); resolve(); });
  });
}

export async function waitForExit(exited, kill, timeoutMs = 2000) {
  const wait = () => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    exited.then(() => { clearTimeout(timer); resolve(true); });
  });
  kill("SIGTERM");
  if (await wait()) return;
  kill("SIGKILL");
  if (!await wait()) throw Object.assign(new Error("Interactive child did not exit. Recovery workspace was retained."), { code: "child_exit_timeout" });
}
