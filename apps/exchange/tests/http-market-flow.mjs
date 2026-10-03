// Invoked only by the Go httptest integration test. No production fixture route.
import assert from 'node:assert/strict';
import {createMarketFeed, STREAM_PATH,aggregateRetainedCandles} from '../web/market-data.js';
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
let matched = false, recovering = false;
const statuses = [];
let finish, fail;
const done = new Promise((resolve, reject) => {finish = resolve; fail = reject;});
const feed = createMarketFeed({fetchImpl: localFetch, EventSourceImpl: HTTPEvents,
  onSnapshot(snapshot) {
    try {
      if (!ready) { ready = true; assert.equal(snapshot.trades.length, 0); console.log('READY'); }
      if (snapshot.trades.length === 1) {
        assert.equal(snapshot.trades[0].amountMicro, 4_000_000);
        assert.equal(snapshot.orderBook.asks[0].filledMicro, 4_000_000);
        for(const interval of [60000,300000,3600000]){
          const candles=aggregateRetainedCandles(snapshot.trades,interval);assert.equal(candles.length,1);
          assert.equal(candles[0].volumeMicro,'4000000');assert.equal(candles[0].openMicro,snapshot.trades[0].priceMicro);assert.equal(candles[0].closeMicro,snapshot.trades[0].priceMicro);
          assert.deepEqual(candles[0].trades,[{id:snapshot.trades[0].id,sourceDigest:snapshot.trades[0].sourceDigest}]);assert.equal(candles[0].complete,false);
        }
        assert.equal(requests.every(([, method]) => method === 'GET'), true);
        if (!matched) { matched = true; console.log(`MATCH=${snapshot.trades[0].sourceDigest}`); finish(); }
      }
    } catch (error) { fail(error); }
  }, onStatus(status) { statuses.push(status.phase); if (!recovering && ['unavailable', 'reconnecting'].includes(status.phase)) fail(new Error(status.code)); }});
const timeout = setTimeout(() => fail(new Error('real HTTP market flow timed out')), 8000);
try {
  await feed.start(); await done;
  const before = structuredClone(feed.snapshot());
  recovering = true; feed.offline(); assert.equal(statuses.at(-1), 'offline');
  // Real guest HTTP re-read after transport loss. Cached matches may remain
  // visible but cannot alone claim a recovered live source.
  await feed.retry(); assert.equal(statuses.at(-1), 'live');
  const after = feed.snapshot();
  assert.deepEqual(after.trades, before.trades);
  assert.deepEqual(after.orderBook.bids, before.orderBook.bids);
  assert.deepEqual(after.orderBook.asks, before.orderBook.asks);
  const {asOf: beforeTime,...beforeSource} = before.orderBook.sourceMetadata;
  const {asOf: afterTime,...afterSource} = after.orderBook.sourceMetadata;
  assert.deepEqual(afterSource,beforeSource);
  assert.ok(Date.parse(afterTime)>=Date.parse(beforeTime));
  assert.equal(after.revision, before.revision);
  assert.ok(requests.filter(([path]) => path !== STREAM_PATH).length >= 2);
  assert.equal(requests.every(([,method]) => method === 'GET'), true);
  for(const interval of [60000,300000,3600000])assert.deepEqual(aggregateRetainedCandles(after.trades,interval),aggregateRetainedCandles(before.trades,interval));
} finally {clearTimeout(timeout); feed.stop();}
