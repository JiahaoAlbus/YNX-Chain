'use strict';
// The launcher supplies a dedicated inherited pipe bound to one backend session;
// this module never opens sockets or selects a network destination.
const MAX_FRAME = 4 * 1024 * 1024 + 4096;
const { markFailure, failureEnvelope, validEnvelope, errorFromEnvelope } = require('./marketplace-diagnostics');
const unavailable = (category = 'CHANNEL_UNAVAILABLE') => markFailure(category);
function wire(stream, receive, onClose, receiveLimit = MAX_FRAME) {
  let buffer = '', closed = false;
  const close = (reason = unavailable()) => { if (closed) return; closed = true; stream.destroy(); onClose(reason); };
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    if (closed) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > receiveLimit) return close(unavailable('PROTOCOL'));
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { receive(JSON.parse(line)); } catch { close(unavailable('PROTOCOL')); return; }
    }
  });
  // Stream event arguments are not diagnostic payloads (and may contain paths).
  stream.on('error', () => close()); stream.on('end', () => close()); stream.on('close', () => close());
  return { close, send(value) {
    if (closed) throw unavailable();
    const encoded = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(encoded) > MAX_FRAME || stream.writableLength > MAX_FRAME) { close(); throw unavailable(); }
    stream.write(encoded);
  } };
}

function serveCatalog(stream, catalog) {
  let retired = false, lastId = 0, windowStart = Date.now(), count = 0;
  const active = new Map();
  const channel = wire(stream, message => {
    if (!message || Object.keys(message).sort().join(',') !== 'id,operation,options' || !Number.isSafeInteger(message.id) || message.id <= lastId || !['search', 'query', 'readme'].includes(message.operation)) throw unavailable();
    lastId = message.id;
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
    if (active.size >= 4 || ++count > 8) { channel.send({ id: message.id, ok: false, error: failureEnvelope(unavailable('QUOTA')) }); return; }
    const controller = new AbortController(); active.set(message.id, controller);
    Promise.resolve().then(() => {
      if (retired) throw unavailable();
      return catalog(message.operation, message.options, controller.signal);
    }).then(result => {
      if (!retired) channel.send({ id: message.id, ok: true, result });
    }).catch(error => {
      if (!retired) { try { channel.send({ id: message.id, ok: false, error: failureEnvelope(error) }); } catch { channel.close(); } }
    }).finally(() => active.delete(message.id));
  }, () => { retired = true; for (const controller of active.values()) controller.abort(); active.clear(); }, 8192);
  return channel;
}

function catalogClient(stream, timeoutMs = 16000) {
  let retired = false, sequence = 0;
  const pending = new Map();
  const channel = wire(stream, message => {
    const request = pending.get(message?.id);
    if (!request || !(message.ok === true && Object.keys(message).sort().join(',') === 'id,ok,result' || message.ok === false && Object.keys(message).sort().join(',') === 'error,id,ok' && validEnvelope(message.error))) throw unavailable('PROTOCOL');
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result); else request.reject(errorFromEnvelope(message.error));
  }, reason => { retired = true; for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); } pending.clear(); });
  return {
    request(operation, options = {}) {
      if (retired || !['search', 'query', 'readme'].includes(operation) || !Number.isSafeInteger(sequence + 1)) return Promise.reject(unavailable());
      if (pending.size >= 4) return Promise.reject(unavailable('QUOTA'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject, timer: setTimeout(() => channel.close(unavailable('TIMEOUT')), timeoutMs) });
        try { channel.send({ id, operation, options }); } catch { channel.close(); }
      });
    },
    close: channel.close,
  };
}
function inheritedCatalog() {
  try {
    if (process.env.YNX_MARKETPLACE_PIPE !== '4' || !require('node:fs').fstatSync(4).isSocket()) throw unavailable();
    return catalogClient(new (require('node:net').Socket)({ fd: 4, readable: true, writable: true }));
  } catch { return { request: async () => { throw unavailable(); }, close() {} }; }
}
module.exports = { serveCatalog, catalogClient, inheritedCatalog };
