// Test-only cross-language guest reader of a real restarted PostgreSQL venue.
import assert from 'node:assert/strict';
import {createMarketFeed, aggregateRetainedCandles, CANDLE_INTERVALS} from '../web/market-data.js';

const base = new URL(process.argv[2]);
assert.equal(base.hostname, '127.0.0.1');
const requests = [], statuses = [];
const feed = createMarketFeed({EventSourceImpl:null,
  fetchImpl:(pathname, options)=>{
    assert.ok(pathname.startsWith('/api/v1/market-data/'));
    assert.equal(options.method,'GET'); assert.equal(options.credentials,'omit');
    requests.push(pathname);
    return fetch(new URL(pathname.slice(4),base),options);
  }, onStatus:value=>statuses.push(value.phase)});
try {
  await feed.start();
  const before=structuredClone(feed.snapshot());
  assert.equal(before.trades.length,1);
  assert.equal(before.orderBook.bids.length,0); assert.equal(before.orderBook.asks.length,0);
  assert.equal(before.trades[0].amountMicro,1000000);
  assert.equal(before.trades[0].priceMicro,2000000);
  assert.match(before.trades[0].sourceDigest,/^[a-f0-9]{64}$/);
  assert.equal(before.sourceMetadata.stateBackend,'postgresql');
  assert.equal(before.sourceMetadata.multiInstance,true);
  feed.offline(); assert.equal(statuses.at(-1),'offline');
  await feed.retry(); assert.equal(statuses.at(-1),'polling');
  const after=feed.snapshot();
  assert.deepEqual(after.trades,before.trades);
  assert.deepEqual(after.orderBook.asks,before.orderBook.asks);
  assert.deepEqual(after.orderBook.bids,before.orderBook.bids);
  assert.equal(after.revision,before.revision);
  for(const interval of CANDLE_INTERVALS) {
    const candles=aggregateRetainedCandles(after.trades,interval);
    assert.equal(candles.length,1); assert.equal(candles[0].volumeMicro,'1000000');
    assert.equal(candles[0].openMicro,2000000); assert.equal(candles[0].closeMicro,2000000);
    assert.deepEqual(candles[0].trades,[{id:after.trades[0].id,sourceDigest:after.trades[0].sourceDigest}]);
    assert.equal(candles[0].complete,false); // retained tape is not whole-history coverage
  }
  assert.equal(requests.length,2);
  process.stdout.write('CANCELLED_MARKET_RECOVERY=verified\n');
} finally { feed.stop(); }
