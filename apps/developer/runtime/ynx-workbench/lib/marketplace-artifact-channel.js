'use strict';
// A launcher-owned endpoint, not an extension-host network capability.
const LIMIT = 8192;
function wire(stream, receive, retire) {
  let buffer = '', closed = false;
  const close = () => { if (closed) return; closed = true; stream.destroy(); retire(); };
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    if (closed) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer) > LIMIT) return close();
    while (buffer.includes('\n')) {
      const i = buffer.indexOf('\n'), frame = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { receive(JSON.parse(frame)); } catch { close(); return; }
    }
  });
  for (const event of ['error', 'end', 'close']) stream.on(event, close);
  return { close, send(value) {
    if (closed) throw Error('Extension download channel closed.');
    const frame = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(frame) > LIMIT || stream.writableLength > LIMIT) { close(); throw Error('Extension download channel capacity exceeded.'); }
    stream.write(frame);
  } };
}
function serveArtifacts(stream, downloader) {
  let retired = false, last = 0, cleanup;
  const active = new Map();
  const channel = wire(stream, message => {
    if (!message || Object.keys(message).sort().join(',') !== 'id,selection' || !Number.isSafeInteger(message.id) || message.id <= last) throw Error('Invalid artifact request.');
    last = message.id;
    if (active.size >= 2) { channel.send({ id: message.id, ok: false }); return; }
    const controller = new AbortController();
    const entry = { controller }; active.set(message.id, entry);
    entry.done = Promise.resolve().then(() => {
      if (retired) throw Error('Retired artifact session.');
      return downloader.download(message.selection, controller.signal);
    }).then(result => { if (!retired) channel.send({ id: message.id, ok: true, result }); })
      .catch(() => { if (!retired) { try { channel.send({ id: message.id, ok: false }); } catch { channel.close(); } } })
      .finally(() => active.delete(message.id));
  }, () => {
    retired = true;
    const entries = [...active.values()];
    for (const entry of entries) entry.controller.abort();
    cleanup = Promise.all(entries.map(entry => entry.done)).then(() => downloader.cleanup());
    // Keep rejection observed; close() still exposes cleanup failure to owner.
    cleanup.catch(() => {});
  });
  return { close() { channel.close(); return cleanup; } };
}
function artifactClient(stream, timeout = 125000) {
  let retired = false, sequence = 0;
  const pending = new Map();
  const channel = wire(stream, message => {
    const request = pending.get(message?.id);
    if (!request || !(message.ok === false && Object.keys(message).sort().join(',') === 'id,ok'
      || message.ok === true && Object.keys(message).sort().join(',') === 'id,ok,result')) throw Error('Invalid artifact response.');
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result); else request.reject(Error('Selected extension download failed or was refused.'));
  }, () => {
    retired = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Extension download ended; retry only after checking installation state.')); }
    pending.clear();
  });
  return { request(selection) {
    if (retired || pending.size >= 2 || !Number.isSafeInteger(sequence + 1)) return Promise.reject(Error('Extension download unavailable.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject, timer: setTimeout(channel.close, timeout) });
      try { channel.send({ id, selection }); } catch { channel.close(); }
    });
  }, close: channel.close };
}
function inheritedArtifacts() {
  try {
    if (process.env.YNX_EXTENSION_ARTIFACT_PIPE !== '6' || !require('node:fs').fstatSync(6).isSocket()) throw Error('Missing artifact pipe.');
    return artifactClient(new (require('node:net').Socket)({ fd: 6, readable: true, writable: true }));
  } catch { return { request: async () => { throw Error('Extension download channel unavailable.'); }, close() {} }; }
}
module.exports = { serveArtifacts, artifactClient, inheritedArtifacts };
