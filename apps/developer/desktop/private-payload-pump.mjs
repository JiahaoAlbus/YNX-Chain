import { TextDecoder } from 'node:util';

// Byte transport for the existing fd4 reader ONLY. This owns no descriptor,
// listener, SDK decoder, authority or client acquisition. The fixed SDK owner
// supplies its framer privately after installed/ACK; callers feed that same
// reader's bytes to accept(). No write or effect is replayed after uncertainty.
export const PRIVATE_PAYLOAD_OUTBOUND_LIMIT = 576 * 1024;
export const PRIVATE_PAYLOAD_INBOUND_LIMIT = 192 * 1024;
const refused = () => Object.assign(Error('Original private payload transport retired.'), { code: 'IDE_PRIVATE_PAYLOAD_TRANSPORT_RETIRED' });
export function createPrivatePayloadPump({ stream, framer, assertCurrent, onFailure = () => {} }) {
  let retired = false, firstCause, firstCausePresent = false, retireError, retireErrorPresent = false;
  let buffered = Buffer.alloc(0), inboundBytes = 0, incoming = Promise.resolve(), started = false;
  const pending = new Set();
  const track = task => {
    const original = Promise.resolve(task); pending.add(original);
    void original.then(() => pending.delete(original), () => pending.delete(original));
    return original;
  };
  const retire = (...causes) => {
    if (retired) return;
    retired = true; firstCausePresent = true; firstCause = causes.length ? causes[0] : refused();
    try { if (framer.retireTransport(firstCause) !== undefined) throw refused(); }
    catch (error) { retireErrorPresent = true; retireError = error; }
    try { onFailure(firstCause); } catch {}
  };
  const live = () => { if (retired) throw refused(); };
  const current = async () => {
    live(); await assertCurrent(); live(); if (framer.assertCurrent() !== undefined) throw refused(); live();
  };
  async function write(raw) {
    if (typeof raw !== 'string' || !raw.length || raw.includes('\n') || Buffer.byteLength(raw) > PRIVATE_PAYLOAD_OUTBOUND_LIMIT) throw refused();
    await current();
    // Register and observe the exact callback even after retirement. A late
    // callback is drainage, never permission to write the next request.
    await track(new Promise((resolve, reject) => {
      stream.write(raw + '\n', error => error ? reject(error) : resolve());
    }));
    await current();
  }
  function start() {
    if (started || retired) return;
    started = true;
    track((async () => {
      try {
        while (!retired) {
          await current();
          const raw = await framer.nextOutboundFrame();
          if (retired) return;
          if (raw === null) throw refused();
          await write(raw);
        }
      } catch (error) { retire(error); }
    })());
  }
  function accept(chunk) {
    if (retired) return;
    try {
      const bytes = Buffer.from(chunk);
      // Bound queued frames too, not just the uncompleted line. Slow current
      // checks cannot turn many complete records into an unbounded queue.
      if (buffered.length + inboundBytes + bytes.length > PRIVATE_PAYLOAD_INBOUND_LIMIT + 1) throw refused();
      buffered = Buffer.concat([buffered, bytes]);
      let end;
      while ((end = buffered.indexOf(10)) >= 0) {
        if (end === 0 || end > PRIVATE_PAYLOAD_INBOUND_LIMIT) throw refused();
        const line = buffered.subarray(0, end); buffered = buffered.subarray(end + 1);
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(line);
        if (!Buffer.from(raw).equals(line)) throw refused();
        inboundBytes += line.length;
        incoming = track(incoming.then(async () => {
          try { await current(); if (framer.acceptInboundFrame(raw) !== undefined) throw refused(); }
          finally { inboundBytes -= line.length; }
        }));
        void incoming.catch(error => retire(error));
      }
      if (buffered.length > PRIVATE_PAYLOAD_INBOUND_LIMIT) throw refused();
    } catch (error) { retire(error); }
  }
  return Object.freeze({ start, accept, retire,
    async finishCleanup() {
      // framer.retireTransport must settle its pending dequeue. If an entered
      // write/dequeue never settles, this remains pending for the parent's
      // existing bounded UNKNOWN cleanup; do not pretend the pipe drained.
      while (pending.size) await Promise.allSettled([...pending]);
      return { complete: !retireErrorPresent, firstCausePresent, firstCause, retireErrorPresent, retireError };
    },
    status() { return { started, retired, firstCausePresent, firstCause, retireErrorPresent, retireError, pending: pending.size, bufferedBytes: buffered.length, inboundBytes }; },
  });
}
