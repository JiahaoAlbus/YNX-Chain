import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateRetainedCandles,MARKET} from '../web/market-data.js';

const trade=(id,time,price,amount=1)=>({id,market:MARKET,createdAt:time,priceMicro:price,amountMicro:amount,sourceType:'deterministic_price_time_match',sourceDigest:'a'.repeat(64)});
test('OHLCV uses chronological venue matches, exact integer volume and no invented intervals',()=>{
  const input=[trade('c','2026-10-03T00:03:00Z',7),trade('b','2026-10-03T00:00:59Z',12,Number.MAX_SAFE_INTEGER),trade('a','2026-10-03T00:00:01Z',10,Number.MAX_SAFE_INTEGER)];
  const before=JSON.stringify(input),candles=aggregateRetainedCandles(input,60000);
  assert.equal(candles.length,2);assert.deepEqual([candles[0].openMicro,candles[0].highMicro,candles[0].lowMicro,candles[0].closeMicro],[10,12,10,12]);
  assert.equal(candles[0].volumeMicro,'18014398509481982');assert.deepEqual(candles[0].trades.map(x=>x.id),['a','b']);assert.equal(candles.every(x=>x.complete===false),true);
  assert.equal(JSON.stringify(input),before);assert.equal(aggregateRetainedCandles(input,300000).length,1);assert.equal(aggregateRetainedCandles(input,3600000).length,1);
});
test('nanosecond ordering and timezone offsets preserve open/close; zero empty input stays empty',()=>{
  const input=[trade('a','2026-10-03T08:00:00.000000002+08:00',20),trade('z','2026-10-03T00:00:00.000000001Z',10)];
  const [c]=aggregateRetainedCandles(input,60000);assert.equal(c.openMicro,10);assert.equal(c.closeMicro,20);
  assert.deepEqual(aggregateRetainedCandles([],60000),[]);
});
test('invalid provenance, duplicate matches, unsafe prices/volume and unsupported intervals fail closed',()=>{
  const valid=trade('one','2026-10-03T00:00:00Z',1);
  for(const change of [{sourceDigest:'invented'},{sourceType:'external'},{createdAt:'invalid'},{priceMicro:0},{priceMicro:Number.MAX_SAFE_INTEGER+1},{amountMicro:0},{market:'BTC-USD'},null]) assert.throws(()=>aggregateRetainedCandles([change===null?null:{...valid,...change}],60000));
  assert.throws(()=>aggregateRetainedCandles([valid,valid],60000));assert.throws(()=>aggregateRetainedCandles([valid],1));
});
