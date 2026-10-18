'use strict';
const { markFailure } = require('./marketplace-diagnostics');

// Pace ordinary UI fan-out before the unchanged session capability. No new
// destinations, permissions, provider retries or quota are added.
function scheduleCatalog(client) {
  const queue = []; let active = 0, retired = false, timer, lastStart = -Infinity;
  const reject = category => markFailure(category);
  const pump = () => {
    clearTimeout(timer); timer = undefined;
    if (retired || active >= 4 || !queue.length) return;
    const now = performance.now();
    while (queue.length && now - queue[0].enqueued >= 16000) queue.shift().reject(reject('TIMEOUT'));
    if (!queue.length) return;
    const wait = 150 - (now - lastStart);
    if (wait > 0) { timer = setTimeout(pump, Math.ceil(wait)); return; }
    const request = queue.shift(); active++; lastStart = now;
    Promise.resolve().then(() => client.request(request.operation, request.options)).then(
      value => { active--; request.resolve(value); pump(); },
      error => { active--; request.reject(error); pump(); },
    );
    pump();
  };
  return {
    request(operation, options = {}) {
      if (retired) return Promise.reject(reject('CHANNEL_UNAVAILABLE'));
      if (!['search', 'query', 'readme'].includes(operation)) return Promise.reject(reject('POLICY'));
      if (queue.length + active >= 64) return Promise.reject(reject('QUOTA'));
      let captured;
      try {
        const encoded = JSON.stringify(options);
        if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > 7000) throw reject('POLICY');
        captured = JSON.parse(encoded);
        if (!captured || typeof captured !== 'object' || Array.isArray(captured)) throw reject('POLICY');
      } catch { return Promise.reject(reject('POLICY')); }
      return new Promise((resolve, reject) => {
        queue.push({ operation, options: captured, resolve, reject, enqueued: performance.now() }); pump();
      });
    },
    close() {
      if (retired) return;
      retired = true; clearTimeout(timer); timer = undefined;
      for (const request of queue.splice(0)) request.reject(reject('CHANNEL_UNAVAILABLE'));
      client.close();
    },
  };
}
module.exports = { scheduleCatalog };
