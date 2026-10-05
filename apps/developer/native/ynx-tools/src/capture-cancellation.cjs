// Cancel a pending editor RPC without letting its late reply resume capture.
// Both outcomes remain observed, including a rejection after cancellation.
function waitForSignal(start, signal) {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(start);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return start(); }).then(
      value => { signal.removeEventListener('abort', abort); signal.aborted ? reject(signal.reason) : resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}
module.exports = { waitForSignal };
