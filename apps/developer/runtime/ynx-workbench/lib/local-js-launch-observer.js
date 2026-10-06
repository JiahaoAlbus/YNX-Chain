'use strict';
// One authenticated subscription per admitted launch; no polling, PID guesses,
// file contents, or remote service traffic.
exports.observeLocalJsLaunch = function(environment, launchId, onEnd) {
  return new Promise((resolve, reject) => {
    const socket = require('node:net').connect(environment.YNX_JS_DEBUG_SOCKET);
    socket.setEncoding('utf8');
    let buffer = '', acknowledged = false, settled = false;
    const timer = setTimeout(() => finish({ error: 'JavaScript launch observation timed out' }), 5000);
    const dispose = () => { settled = true; clearTimeout(timer); socket.destroy(); };
    function finish(result) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (!acknowledged) reject(Error(result.error || 'JavaScript observation ended before admission'));
      else onEnd(result);
    }
    socket.once('connect', () => socket.write(JSON.stringify({ op: 'observe', launchId,
      projectId: environment.YNX_LOCAL_PROJECT_ID, credential: environment.YNX_JS_DEBUG_CREDENTIAL }) + '\n'));
    socket.on('error', () => finish({ error: 'JavaScript launch observation disconnected' }));
    socket.on('close', () => finish({ error: 'JavaScript launch observation disconnected' }));
    socket.on('data', data => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 4096) return finish({ error: 'Invalid JavaScript observation response' });
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value; try { value = JSON.parse(raw); } catch { return finish({ error: 'Invalid JavaScript observation response' }); }
        if (value.kind === 'observing' && !acknowledged) {
          acknowledged = true; clearTimeout(timer); resolve({ dispose });
        } else if (value.kind === 'ended' && acknowledged && (value.code === null || Number.isInteger(value.code) && value.code >= 0 && value.code <= 255) && typeof value.cancelled === 'boolean') {
          finish({ code: value.code, cancelled: value.cancelled, ...(value.error ? { error: value.error === 'JavaScript target could not be started' ? value.error : 'JavaScript process cleanup could not be verified' } : {}) });
        } else return finish({ error: 'JavaScript launch observation was refused' });
      }
    });
  });
};
