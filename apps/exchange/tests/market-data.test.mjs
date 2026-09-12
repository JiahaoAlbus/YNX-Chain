import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketFeed, validateSnapshot, formatMicro, MARKET, SNAPSHOT_PATH, STREAM_PATH} from '../web/market-data.js';

// Isolated transport fixtures. These are never bundled or advertised as trades.
function snapshot(revision = 1) {
  const source = {authority: 'YNX-owned deterministic order state', version: 'exchange-public-state-v1', asOf: '2026-09-12T00:00:00Z', classification: 'testnet', status: 'degraded_single_host', coverage: 'stream-orderbook-matched-trades', stateBackend: 'file_snapshot', multiInstance: false};
  return {schemaVersion: 'exchange-public-market-v1', revision, market: MARKET, sourceMetadata: source,
    orderBook: {market: MARKET, sourceMetadata: source, bids: [], asks: [{id: 'order-fixture', market: MARKET, side: 'sell', priceMicro: 2_000_000, amountMicro: 10_000_000, filledMicro: 4_000_000, createdAt: source.asOf}]},
    trades: [{id: 'trade-fixture', market: MARKET, priceMicro: 2_000_000, amountMicro: 4_000_000, createdAt: source.asOf, sourceType: 'deterministic_price_time_match', sourceDigest: 'a'.repeat(64)}]};
}
function harness(fetcher = async () => Response.json(snapshot()), noStream = false) {
  const calls = [], sources = [], received = [], statuses = [], timers = new Map();
  let timerID = 0;
  class Source {
    constructor(url, options) { this.url = url; this.options = options; this.events = {}; this.closed = false; sources.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    close() { this.closed = true; }
    emit(name, value) { this.events[name]?.({data: JSON.stringify(value)}); }
  }
  const feed = createMarketFeed({fetchImpl: async (...args) => {calls.push(args); return fetcher(...args);}, EventSourceImpl: noStream ? null : Source,
    onSnapshot: value => received.push(value), onStatus: value => statuses.push(value),
    setTimer(fn, ms) { timers.set(++timerID, {fn, ms}); return timerID; }, clearTimer(id) { timers.delete(id); }});
  const timer = ms => { const entry = [...timers].find(([, value]) => value.ms === ms); assert.ok(entry, `timer ${ms}`); timers.delete(entry[0]); return entry[1].fn(); };
  return {feed, calls, sources, received, statuses, timers, timer};
}

test('guest snapshot and stream use only same-origin GET without account credentials', async () => {
  const h = harness(); await h.feed.start();
  assert.equal(h.calls[0][0], SNAPSHOT_PATH); assert.equal(h.calls[0][1].method, 'GET');
  assert.equal(h.calls[0][1].credentials, 'omit'); assert.deepEqual(h.calls[0][1].headers, {Accept: 'application/json'});
  assert.equal(h.sources[0].url, STREAM_PATH); assert.deepEqual(h.sources[0].options, {withCredentials: false});
  assert.equal(h.received[0].trades[0].sourceDigest, 'a'.repeat(64));
  assert.equal(h.statuses.at(-1).source.status, 'degraded_single_host'); h.feed.stop();
});
test('reconciled snapshots replace depth and tape without duplicate trades; empty snapshots clear them', async () => {
  const h = harness(); await h.feed.start();
  const next = snapshot(2); next.orderBook.asks = []; next.trades.push({...next.trades[0], id: 'second-trade'});
  h.sources[0].emit('reconciled', next); h.sources[0].emit('snapshot', next);
  assert.equal(h.feed.snapshot().trades.length, 2); assert.equal(h.feed.snapshot().orderBook.asks.length, 0);
  h.sources[0].emit('reconciled', {...snapshot(3), trades: [], orderBook: {...next.orderBook, bids: []}});
  assert.equal(h.feed.snapshot().trades.length, 0); h.feed.stop();
});
test('stream loss preserves labelled stale snapshot and reconnects by a fresh read', async () => {
  let version = 1; const h = harness(async () => Response.json(snapshot(version++))); await h.feed.start();
  const old = h.sources[0]; old.onerror();
  assert.equal(old.closed, true); assert.equal(h.feed.snapshot().revision, 1); assert.equal(h.statuses.at(-1).phase, 'reconnecting');
  await h.timer(1000); assert.equal(h.feed.snapshot().revision, 2); assert.equal(h.sources.length, 2);
  old.emit('snapshot', snapshot(900)); assert.equal(h.feed.snapshot().revision, 2);
  h.feed.stop(); assert.equal(h.sources[1].closed, true); assert.equal(h.timers.size, 0);
});
test('offline invalidates in-flight reads and events; retry recovers without replaying writes', async () => {
  let resolve; const h = harness(() => new Promise(done => {resolve = done;}));
  const running = h.feed.start(); h.feed.offline(); resolve(Response.json(snapshot())); await running;
  assert.equal(h.received.length, 0); assert.equal(h.sources.length, 0); assert.equal(h.statuses.at(-1).phase, 'offline');
  const resumed = h.feed.retry(); resolve(Response.json(snapshot(2))); await resumed;
  assert.equal(h.received.length, 1); assert.equal(h.calls.every(([, options]) => options.method === 'GET'), true); h.feed.stop();
});
test('newer manual refresh wins over delayed earlier HTTP result', async () => {
  const pending = []; const h = harness(() => new Promise(resolve => pending.push(resolve)));
  const first = h.feed.start(), second = h.feed.retry();
  pending[1](Response.json(snapshot(2))); await second; pending[0](Response.json(snapshot(1))); await first;
  assert.deepEqual(h.received.map(value => value.revision), [2]); assert.equal(h.sources.length, 1); h.feed.stop();
});
test('HTML fallback, HTTP failure and malformed source never become empty-market success', async () => {
  for (const response of [new Response('<html>fallback</html>', {headers: {'content-type': 'text/html'}}), Response.json({}, {status: 503}), Response.json({...snapshot(), market: 'BTC-USD'})]) {
    const h = harness(async () => response); await h.feed.start();
    assert.equal(h.received.length, 0); assert.equal(h.sources.length, 0); assert.equal(h.statuses.at(-1).phase, 'unavailable'); h.feed.stop();
  }
});
test('invalid or regressed stream data marks last valid state stale instead of replacing it', async () => {
  const h = harness(async () => Response.json(snapshot(4))); await h.feed.start();
  h.sources[0].emit('reconciled', snapshot(3)); assert.equal(h.feed.snapshot().revision, 4);
  assert.equal(h.statuses.at(-1).code, 'MARKET_DATA_INVALID'); h.feed.stop();
});
test('invalid duplicate IDs, unsafe amounts, mismatched chain provenance and false live state fail closed', () => {
  for (const change of [s => s.trades.push(s.trades[0]), s => s.orderBook.asks.push(s.orderBook.asks[0]), s => s.trades[0].priceMicro = Number.MAX_SAFE_INTEGER + 1,
    s => s.trades[0].sourceType = 'external', s => s.sourceMetadata.status = 'live', s => s.sourceMetadata.classification = 'mainnet', s => s.trades[0].sourceDigest = 'bad']) {
    const value = snapshot(); change(value); assert.throws(() => validateSnapshot(value), {code: 'MARKET_DATA_INVALID'});
  }
});
test('heartbeat timeout is bounded; no EventSource falls back to periodic snapshots', async () => {
  const h = harness(); await h.feed.start(); h.sources[0].emit('heartbeat', {revision: 1});
  h.timer(20_000); assert.equal(h.statuses.at(-1).code, 'MARKET_STREAM_TIMEOUT'); h.feed.stop();
  const poll = harness(async () => Response.json(snapshot()), true); await poll.feed.start();
  assert.equal(poll.statuses.at(-1).phase, 'polling'); await poll.timer(5000); assert.equal(poll.calls.length, 2); poll.feed.stop();
});
test('micro-unit display does not round large order notional through floating point', () => {
  assert.equal(formatMicro(999_999_999_999_999_999n), '999,999,999,999.999999');
  assert.equal(formatMicro(1), '0.000001'); assert.equal(formatMicro(2_000_000), '2.00');
  assert.throws(() => formatMicro(Number.MAX_SAFE_INTEGER + 1));
});
