'use strict';
// Fixed inherited anonymous pipe: no socket address, receipt or source selector
// can be provided by the workspace, renderer or environment.
const { Socket } = require('node:net');
const { failure, supplierCode, known } = require('./wallet-admission-protocol');
const operations = new Set(['beginYNX', 'handleReturn', 'restore', 'disconnect']);
const missing = () => failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
const unavailable = () => failure('WALLET_SERVICE_ADMISSION_UNAVAILABLE');
function tuple(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(',') !== 'gatewayOrigin,operation,platform,productId,service'
    || value.service !== 'wallet-product-session-v2' || value.productId !== 'developer' || value.platform !== 'macos'
    || value.gatewayOrigin !== 'https://wallet-auth.ynxweb4.com' || !operations.has(value.operation)) throw failure('WALLET_SERVICE_ADMISSION_DENIED');
  return { service: value.service, productId: value.productId, platform: value.platform, gatewayOrigin: value.gatewayOrigin, operation: value.operation };
}
function frames(stream, receive, closed) {
  let buffer = '', done = false;
  const close = () => { if (!done) { done = true; stream.destroy(); closed(); } };
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    if (done) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 4096) return close();
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { receive(JSON.parse(line)); } catch { close(); return; }
    }
  });
  stream.on('error', close); stream.on('end', close); stream.on('close', close);
  return { close, send(value) { if (done) throw unavailable(); stream.write(JSON.stringify(value) + '\n'); } };
}
function serveAdmission(stream, admission) {
  let active = false, retired = false, last = 0;
  const wire = frames(stream, message => {
    if (active || retired || !message || Object.keys(message).sort().join(',') !== 'id,tuple' || !Number.isSafeInteger(message.id) || message.id <= last) throw unavailable();
    last = message.id; const input = tuple(message.tuple); active = true;
    Promise.resolve().then(() => { if (retired) throw unavailable(); return admission.assertCurrent(input); }).then(result => {
      if (result !== undefined) throw failure('WALLET_SERVICE_ADMISSION_DENIED');
      if (!retired) wire.send({ id: message.id, ok: true });
    }).catch(error => { if (!retired) wire.send({ id: message.id, ok: false, code: supplierCode(error) }); }).finally(() => { active = false; });
  }, () => { retired = true; });
  return wire;
}
function admissionClient(stream, timeoutMs = 5000) {
  let sequence = 0, pending, retired = false;
  const wire = frames(stream, message => {
    if (!pending || !message || message.id !== pending.id
      || !(message.ok === true && Object.keys(message).sort().join(',') === 'id,ok'
        || message.ok === false && Object.keys(message).sort().join(',') === 'code,id,ok' && known(message.code))) throw unavailable();
    const current = pending; pending = undefined; clearTimeout(current.timer);
    if (message.ok) current.resolve(); else current.reject(failure(message.code));
  }, () => { retired = true; if (pending) { clearTimeout(pending.timer); pending.reject(unavailable()); pending = undefined; } });
  return Object.freeze({
    assertCurrent(value) {
      let input; try { input = tuple(value); } catch (error) { return Promise.reject(error); }
      if (retired || pending || !Number.isSafeInteger(sequence + 1)) return Promise.reject(unavailable());
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending = { id, resolve, reject, timer: setTimeout(() => wire.close(), timeoutMs) };
        try { wire.send({ id, tuple: input }); } catch { wire.close(); }
      });
    },
    close: wire.close,
  });
}
function inheritedAdmission() {
  try { return admissionClient(new Socket({ fd: 3, readable: true, writable: true })); }
  catch { return Object.freeze({ assertCurrent: async () => { throw unavailable(); }, close() {} }); }
}
module.exports = { tuple, serveAdmission, admissionClient, inheritedAdmission, missing };
