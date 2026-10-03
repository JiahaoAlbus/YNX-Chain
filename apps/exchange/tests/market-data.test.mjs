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
function harness(fetcher = async () => Response.json(snapshot()), noStream = false, now = () => Date.now()) {
  const calls = [], sources = [], received = [], statuses = [], timers = new Map();
  let timerID = 0;
  class Source {
    constructor(url, options) { this.url = url; this.options = options; this.events = {}; this.closed = false; sources.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    close() { this.closed = true; }
    emit(name, value) { this.events[name]?.({data: JSON.stringify(value)}); }
  }
  const feed = createMarketFeed({fetchImpl: async (...args) => {calls.push(args); return fetcher(...args);}, EventSourceImpl: noStream ? null : Source,
    now,
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
test('rate-limited public reads honor bounded Retry-After without replacing cached data or sending writes',async()=>{
  for(const [header,delay] of [['45',45000],['999999',300000],['Sat, 03 Oct 2026 12:00:45 GMT',45000],['-1',1000],['bad',1000],['0',1000]]){
    let reads=0;const h=harness(async()=>++reads===1?Response.json(snapshot()):reads===2?new Response('',{status:429,headers:{'retry-after':header}}):Response.json(snapshot(2)),false,()=>Date.UTC(2026,9,3,12));
    await h.feed.start();const original=h.feed.snapshot();await h.feed.retry();
    assert.equal(h.feed.snapshot(),original);assert.equal(h.statuses.at(-1).code,'MARKET_RATE_LIMITED');assert.equal(h.sources[0].closed,true);
    assert.equal(h.timers.size,1);await h.timer(delay);assert.equal(h.feed.snapshot().revision,2);assert.equal(h.statuses.at(-1).phase,'live');
    h.sources.at(-1).onerror();assert.ok([...h.timers.values()].some(value=>value.ms===1000),'successful snapshot resets backoff');
    assert.equal(h.calls.every(([,o])=>o.method==='GET'&&o.credentials==='omit'),true);h.feed.stop();assert.equal(h.timers.size,0);
  }
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
test('snapshot timeout retires a stalled read immediately and fences its late body', async () => {
  const pending=[]; const h=harness(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.feed.start(); h.timer(10_000);
  assert.equal(h.statuses.at(-1).phase,'unavailable');
  assert.equal(h.statuses.at(-1).code,'MARKET_SOURCE_UNAVAILABLE');
  assert.equal(h.calls[0][1].signal.aborted,true);
  const recovery=h.timer(1000); pending[1](Response.json(snapshot(2))); await recovery;
  pending[0](Response.json(snapshot(1))); await first;
  assert.deepEqual(h.received.map(value=>value.revision),[2]);
  assert.equal(h.sources.length,1); assert.equal(h.statuses.at(-1).phase,'live');
  h.feed.stop(); assert.equal(h.timers.size,0);
});
test('bounded refresh promise releases awaiting preview even if the aborted transport never settles',async()=>{
  for(const action of ['deadline','offline','stop']){
    let completed=false;const h=harness(()=>new Promise(()=>{}));
    const request=h.feed.start().then(()=>completed=true);
    if(action==='deadline')h.timer(10_000);else h.feed[action]();
    await new Promise(setImmediate);assert.equal(completed,true,action);
    await request;assert.equal(h.received.length,0);h.feed.stop();assert.equal(h.timers.size,0);
  }
});
test('offline and stop clear the read deadline before an unresolved request returns', async () => {
  for(const method of ['offline','stop']){
    let resolve; const h=harness(()=>new Promise(done=>resolve=done)); const running=h.feed.start();
    h.feed[method](); assert.equal(h.timers.size,0); assert.equal(h.calls[0][1].signal.aborted,true);
    resolve(Response.json(snapshot())); await running;
    assert.equal(h.received.length,0);assert.equal(h.sources.length,0);
  }
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
test('same venue revision cannot silently replace depth or matched-trade provenance',async()=>{
  for(const change of [s=>s.orderBook.asks[0].priceMicro++,s=>s.orderBook.asks[0].filledMicro++,s=>s.orderBook.asks=[],s=>s.trades[0].amountMicro++,s=>s.trades[0].sourceDigest='b'.repeat(64),s=>s.trades=[]]){
    const h=harness();await h.feed.start();const original=h.feed.snapshot(),next=snapshot();change(next);
    h.sources[0].emit('reconciled',next);
    assert.equal(h.feed.snapshot(),original);assert.equal(h.received.length,1);
    assert.equal(h.statuses.at(-1).code,'MARKET_DATA_INVALID');assert.equal(h.sources[0].closed,true);
    h.feed.stop();assert.equal(h.timers.size,0);
  }
});
test('manual same-revision conflict preserves stale data then recovers at a newer revision',async()=>{
  let reads=0;const h=harness(async()=>{const next=snapshot(++reads===3?2:1);if(reads>1)next.trades[0].priceMicro++;return Response.json(next)});
  await h.feed.start();const original=h.feed.snapshot();await h.feed.retry();
  assert.equal(h.feed.snapshot(),original);assert.equal(h.statuses.at(-1).phase,'reconnecting');assert.equal(h.statuses.at(-1).code,'MARKET_DATA_INVALID');
  await h.timer(1000);assert.equal(h.feed.snapshot().revision,2);assert.equal(h.received.length,2);assert.equal(h.statuses.at(-1).phase,'live');h.feed.stop();
});
test('same-revision observation refresh and reordered rows do not invent a state mutation',async()=>{
  const initial=snapshot();initial.trades.push({...initial.trades[0],id:'other-trade'});
  const h=harness(async()=>Response.json(initial));await h.feed.start();
  const next=structuredClone(initial);next.trades.reverse();next.sourceMetadata.asOf='2026-09-12T00:01:00Z';
  h.sources[0].emit('reconciled',next);
  assert.equal(h.received.length,2);assert.equal(h.statuses.at(-1).phase,'live');assert.equal(h.sources[0].closed,false);
  assert.equal(h.feed.snapshot().sourceMetadata.asOf,next.sourceMetadata.asOf);h.feed.stop();
});
test('invalid duplicate IDs, unsafe amounts, mismatched chain provenance and false live state fail closed', () => {
  for (const change of [s => s.trades.push(s.trades[0]), s => s.orderBook.asks.push(s.orderBook.asks[0]), s => s.trades[0].priceMicro = Number.MAX_SAFE_INTEGER + 1,
    s => s.trades[0].sourceType = 'external', s => s.sourceMetadata.status = 'live', s => s.sourceMetadata.classification = 'mainnet', s => s.trades[0].sourceDigest = 'bad']) {
    const value = snapshot(); change(value); assert.throws(() => validateSnapshot(value), {code: 'MARKET_DATA_INVALID'});
  }
});
test('venue timestamps reject locale-dependent and normalized impossible calendar values', () => {
  for (const stamp of ['0', '09/12/2026', '2026-09-12', '2026-09-12T00:00:00',
    '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-09-12T24:00:00Z', '2026-09-12T00:00:00.1234567890Z']) {
    for (const change of [s => s.sourceMetadata.asOf = stamp, s => s.orderBook.asks[0].createdAt = stamp,
      s => s.trades[0].createdAt = stamp]) {
      const value = snapshot(); change(value);
      assert.throws(() => validateSnapshot(value), {code:'MARKET_DATA_INVALID'}, stamp);
    }
  }
});
test('venue RFC3339 UTC, offset and nanosecond timestamps remain accepted', () => {
  for (const stamp of ['2024-02-29T23:59:59Z', '2026-09-12T00:00:00.123456789Z',
    '2026-09-12T08:00:00+08:00', '2026-09-11T19:00:00-05:00']) {
    const value = snapshot(); value.sourceMetadata.asOf = stamp;
    value.orderBook.asks[0].createdAt = stamp; value.trades[0].createdAt = stamp;
    assert.equal(validateSnapshot(value), value);
  }
});
test('invalid venue time cannot enter HTTP market state or replace verified stream state', async () => {
  const malformed = snapshot(2); malformed.trades[0].createdAt = '2026-02-30T00:00:00Z';
  const http = harness(async () => Response.json(malformed)); await http.feed.start();
  assert.equal(http.received.length, 0); assert.equal(http.sources.length, 0);
  assert.equal(http.statuses.at(-1).code, 'MARKET_DATA_INVALID'); http.feed.stop();
  const stream = harness(); await stream.feed.start(); const original = stream.feed.snapshot();
  stream.sources[0].emit('reconciled', malformed);
  assert.equal(stream.feed.snapshot(), original); assert.equal(stream.received.length, 1);
  assert.equal(stream.sources[0].closed, true); assert.equal(stream.statuses.at(-1).code, 'MARKET_DATA_INVALID');
  stream.feed.stop(); assert.equal(stream.timers.size, 0);
});
test('heartbeat timeout is bounded; no EventSource falls back to periodic snapshots', async () => {
  const h = harness(); await h.feed.start(); h.sources[0].emit('heartbeat', {revision: 1});
  h.timer(20_000); assert.equal(h.statuses.at(-1).code, 'MARKET_STREAM_TIMEOUT'); h.feed.stop();
  const poll = harness(async () => Response.json(snapshot()), true); await poll.feed.start();
  assert.equal(poll.statuses.at(-1).phase, 'polling'); await poll.timer(5000); assert.equal(poll.calls.length, 2); poll.feed.stop();
});
test('a heartbeat ahead of the applied snapshot reconciles by GET rather than labelling old depth live', async () => {
  let revision = 1;
  const h = harness(async () => Response.json(snapshot(revision++))); await h.feed.start();
  const old = h.sources[0];
  old.emit('heartbeat', {revision: 1});
  assert.equal(h.calls.length, 1); assert.equal(old.closed, false);
  old.emit('heartbeat', {revision: 2});
  assert.equal(h.statuses.at(-1).phase, 'reconnecting');
  assert.equal(h.statuses.at(-1).code, 'MARKET_REVISION_GAP');
  assert.equal(old.closed, true); assert.equal(h.feed.snapshot().revision, 1);
  old.emit('reconciled', snapshot(900)); assert.equal(h.feed.snapshot().revision, 1);
  await h.timer(1000);
  assert.equal(h.feed.snapshot().revision, 2); assert.equal(h.statuses.at(-1).phase, 'live');
  assert.equal(h.calls.every(([, options]) => options.method === 'GET' && options.credentials === 'omit'), true);
  h.feed.stop();
});
test('failed revision-gap recovery keeps the last verified snapshot stale and retries with bounded backoff', async () => {
  let reads = 0;
  const h = harness(async () => ++reads === 1 ? Response.json(snapshot()) : Response.json({}, {status: 503}));
  await h.feed.start(); h.sources[0].emit('heartbeat', {revision: 2});
  await h.timer(1000);
  assert.equal(h.feed.snapshot().revision, 1); assert.equal(h.received.length, 1);
  assert.equal(h.statuses.at(-1).phase, 'reconnecting');
  assert.equal(h.statuses.at(-1).code, 'MARKET_SOURCE_UNAVAILABLE');
  assert.ok([...h.timers.values()].some(value => value.ms === 2000));
  h.feed.stop(); assert.equal(h.timers.size, 0);
});
test('healthy unchanged streams periodically read real snapshots without heartbeat-forged freshness', async () => {
  let reads = 0;
  const h = harness(async () => {
    const value = snapshot(1);
    value.sourceMetadata.asOf = ++reads === 1 ? '2026-09-12T00:00:00Z' : '2026-09-12T00:01:00Z';
    return Response.json(value);
  });
  await h.feed.start(); const old = h.sources[0];
  old.emit('heartbeat', {revision: 1});
  assert.equal(h.feed.snapshot().sourceMetadata.asOf, '2026-09-12T00:00:00Z');
  await h.timer(60_000);
  assert.equal(h.calls.length, 2); assert.equal(old.closed, true);
  assert.equal(h.feed.snapshot().sourceMetadata.asOf, '2026-09-12T00:01:00Z');
  assert.equal(h.feed.snapshot().revision, 1);
  old.emit('snapshot', snapshot(900)); assert.equal(h.feed.snapshot().revision, 1);
  h.feed.offline(); assert.equal(h.timers.size, 0);
});
test('periodic source read failure cannot keep cached rules live or fabricate an observation timestamp', async () => {
  let reads = 0;
  const h = harness(async () => ++reads === 1 ? Response.json(snapshot()) : Response.json({}, {status: 503}));
  await h.feed.start(); await h.timer(60_000);
  assert.equal(h.feed.snapshot().sourceMetadata.asOf, '2026-09-12T00:00:00Z');
  assert.equal(h.statuses.at(-1).phase, 'reconnecting'); assert.equal(h.received.length, 1);
  assert.equal(h.sources[0].closed, true);
  h.feed.stop(); assert.equal(h.timers.size, 0);
});
test('micro-unit display does not round large order notional through floating point', () => {
  assert.equal(formatMicro(999_999_999_999_999_999n), '999,999,999,999.999999');
  assert.equal(formatMicro(1), '0.000001'); assert.equal(formatMicro(2_000_000), '2.00');
  assert.throws(() => formatMicro(Number.MAX_SAFE_INTEGER + 1));
});

test('HTTP ambiguous or oversized market documents cannot become verified data', async t => {
  const valid=JSON.stringify(snapshot());
  for(const [name,body,headers] of [
    ['duplicate-revision',valid.replace('"revision":1','"revision":900,"revision":1'),{}],
    ['duplicate-price',valid.replace('"priceMicro":2000000','"priceMicro":9000000,"priceMicro":2000000'),{}],
    ['escaped-duplicate',valid.replace('"revision":1','"revision":900,"revis\\u0069on":1'),{}],
    ['oversized-body',valid+' '.repeat(8*1024*1024),{}],
    ['oversized-declared-body',valid,{'content-length':String(8*1024*1024+1)}]
  ]) await t.test(name,async()=>{
    const h=harness(async()=>new Response(body,{headers:{'content-type':'application/json',...headers}}));
    try { await h.feed.start(); assert.equal(h.received.length,0); assert.equal(h.sources.length,0); assert.equal(h.statuses.at(-1).code,'MARKET_DATA_INVALID'); }
    finally { h.feed.stop(); }
  });
});

test('ambiguous stream frame preserves prior verified snapshot and retires the stream',async()=>{
  const h=harness(); await h.feed.start(); const old=h.sources[0];
  old.events.reconciled({data:JSON.stringify(snapshot()).replace('"revision":1','"revision":900,"revision":1')});
  assert.equal(h.received.length,1); assert.equal(h.feed.snapshot().revision,1);
  assert.equal(old.closed,true); assert.equal(h.statuses.at(-1).code,'MARKET_DATA_INVALID');
  h.feed.stop();
});

test('valid additive audit fields and split UTF-8 remain compatible',async()=>{
  const value=snapshot(); value.audit={note:'quotes " braces } comma , slash \\ α العربية',optional:null,rows:[{label:'source'}]};
  const encoded=new TextEncoder().encode(JSON.stringify(value)+' \n\t');
  const cut=encoded.findIndex(byte=>byte>127)+1;
  const body=new ReadableStream({start(controller){controller.enqueue(encoded.slice(0,cut));controller.enqueue(encoded.slice(cut));controller.close();}});
  const h=harness(async()=>new Response(body,{headers:{'content-type':'application/json'}}));
  await h.feed.start(); assert.deepEqual(h.received,[value]); h.feed.stop();
});

test('nested duplicates, deep documents and malformed UTF-8 fail before snapshots',async()=>{
  const valid=JSON.stringify(snapshot());
  for(const body of [
    valid.replace('"priceMicro":2000000','"priceMicro":9000000,"priceMicro":2000000'),
    valid.slice(0,-1)+',"audit":'+'['.repeat(65)+'0'+']'.repeat(65)+'}',
    new Uint8Array([0xff,0xfe]), valid+'{}', valid+'trailing'
  ]) {
    const h=harness(async()=>new Response(body,{headers:{'content-type':'application/json'}}));
    await h.feed.start(); assert.equal(h.received.length,0); assert.equal(h.statuses.at(-1).code,'MARKET_DATA_INVALID'); h.feed.stop();
  }
});

test('stalled body is cancelled and retired on deadline, offline and stop',async()=>{
  for(const action of ['deadline','offline','stop']) {
    let cancelled=0;
    const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"schemaVersion":'));},cancel(){cancelled++;}});
    const h=harness(async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
    const waiting=h.feed.start(); await new Promise(setImmediate);
    if(action==='deadline')h.timer(10000);else h.feed[action]();
    await waiting; assert.equal(cancelled,1,action); assert.equal(h.received.length,0); assert.equal(h.sources.length,0);
    h.feed.stop(); assert.equal(h.timers.size,0);
  }
});
