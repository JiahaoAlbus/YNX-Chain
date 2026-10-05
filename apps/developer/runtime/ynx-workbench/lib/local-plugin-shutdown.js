'use strict';
// Connection-scoped plugin hosts are not root-container shutdown contributions.
// Register their existing termination protocol in the backend's awaited stop.
const installed = new WeakMap();
function install(prototype) {
  if (installed.has(prototype)) return installed.get(prototype);
  const active = new Set(), pending = new Map();
  const fork = prototype.fork, terminate = prototype.terminatePluginServer;
  let stopping = false, stopped;
  prototype.fork = function (...args) {
    if (stopping) throw Error('Local plugin host cannot start during backend shutdown.');
    const child = fork.apply(this, args); active.add(this);
    child.once('exit', () => { if (!this.childProcess || this.childProcess === child) active.delete(this); });
    return child;
  };
  prototype.terminatePluginServer = function (...args) {
    if (pending.has(this)) return pending.get(this);
    let operation;
    try { operation = Promise.resolve(terminate.apply(this, args)); }
    catch (error) { operation = Promise.reject(error); }
    pending.set(this, operation);
    operation.then(() => { pending.delete(this); if (!this.childProcess) active.delete(this); }, () => pending.delete(this));
    return operation;
  };
  const lifecycle = { onStop() {
    stopping = true;
    return stopped ||= Promise.allSettled([...new Set([...active, ...pending.keys()])].map(host => host.terminatePluginServer()))
      .then(results => { const errors = results.filter(result => result.status === 'rejected').map(result => result.reason); if (errors.length) throw new AggregateError(errors, 'Local plugin shutdown failed'); });
  } };
  installed.set(prototype, lifecycle); return lifecycle;
}
module.exports = { install };
