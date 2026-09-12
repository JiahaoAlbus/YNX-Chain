// Invoked only by the Go httptest integration test. No production fixture route.
import assert from 'node:assert/strict';
import {createMarketFeed, STREAM_PATH} from '../web/market-data.js';
const base = new URL(process.argv[2]);
assert.equal(base.hostname, '127.0.0.1');
const requests = [];
const localFetch = (path, options) => {
  requests.push([path, options?.method || 'GET']);
  return fetch(new URL(path, base), options);
};
// Node transport for real HTTP SSE bytes, using the same callbacks as EventSource.
// This is test code, excluded from the served Web directory and release archive.
class HTTPEvents {
  constructor(path) { assert.equal(path, STREAM_PATH); this.listeners = {}; this.abort = new AbortController(); this.run(path); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  close() { this.abort.abort(); }
  async run(path) {
    try {
      const response = await localFetch(path, {signal: this.abort.signal, headers: {Accept: 'text/event-stream'}});
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
      let pending = ''; const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, {stream: true});
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const packet = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          const lines = packet.split('\n'), event = lines.find(line => line.startsWith('event: '))?.slice(7);
          const data = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
          this.listeners[event]?.({data});
        }
      }
    } catch { if (!this.abort.signal.aborted) this.onerror?.(); }
  }
}
let ready = false;
let finish, fail;
const done = new Promise((resolve, reject) => {finish = resolve; fail = reject;});
const feed = createMarketFeed({fetchImpl: localFetch, EventSourceImpl: HTTPEvents,
  onSnapshot(snapshot) {
    try {
      if (!ready) { ready = true; assert.equal(snapshot.trades.length, 0); console.log('READY'); }
      if (snapshot.trades.length === 1) {
        assert.equal(snapshot.trades[0].amountMicro, 4_000_000);
        assert.equal(snapshot.orderBook.asks[0].filledMicro, 4_000_000);
        assert.equal(requests.every(([, method]) => method === 'GET'), true);
        console.log(`MATCH=${snapshot.trades[0].sourceDigest}`); finish();
      }
    } catch (error) { fail(error); }
  }, onStatus(status) { if (['unavailable', 'reconnecting'].includes(status.phase)) fail(new Error(status.code)); }});
const timeout = setTimeout(() => fail(new Error('real HTTP market flow timed out')), 8000);
try { await feed.start(); await done; } finally {clearTimeout(timeout); feed.stop();}
