import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivatePayloadPump, PRIVATE_PAYLOAD_INBOUND_LIMIT, PRIVATE_PAYLOAD_OUTBOUND_LIMIT } from './private-payload-pump.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise,resolve,reject }; }
function fixture() {
  let waiter, live = true, held = false, current = async () => {};
  const queue=[], writes=[], callbacks=[], received=[], causes=[], errors=[];
  const framer = {
    assertCurrent() { if(!live) throw Error('PUBLIC_NOT_CURRENT'); },
    nextOutboundFrame() { if(queue.length) return Promise.resolve(queue.shift()); waiter=deferred();return waiter.promise; },
    acceptInboundFrame(raw) { received.push(raw); },
    retireTransport(cause) { causes.push(cause);live=false;waiter?.resolve(null); },
  };
  const stream={write(raw,done){writes.push(raw);if(held)callbacks.push(done);else done();}};
  const pump=createPrivatePayloadPump({stream,framer,assertCurrent:()=>current(),onFailure:error=>errors.push(error)});
  return {pump,framer,writes,callbacks,received,causes,errors,
    send(raw){if(waiter){const w=waiter;waiter=null;w.resolve(raw);}else queue.push(raw);},
    hold(){held=true;},current(fn){current=fn;},notCurrent(){live=false;}};
}
test('one writer takes each SDK frame once, using LF; no independent reader is installed',async()=>{
  const f=fixture();f.send('{"public":1}');assert.equal(f.writes.length,0);
  f.pump.start();f.pump.start();await flush();assert.deepEqual(f.writes,['{"public":1}\n']);
  f.send('{"public":2}');await flush();assert.equal(f.writes.length,2);
  f.pump.retire();await f.pump.finishCleanup();assert.equal(f.causes.length,1);
});
test('fragmented inbound exact raw reaches sole SDK framer unchanged',async()=>{
  const f=fixture();const raw='{"body":"你好\\nPUBLIC"}';const bytes=Buffer.from(raw+'\n');
  for(const byte of bytes)f.pump.accept(Buffer.from([byte]));await flush();
  assert.deepEqual(f.received,[raw]);f.pump.retire();await f.pump.finishCleanup();
});
test('cancel during dequeue cannot send a late frame or reopen the writer',async()=>{
  const f=fixture();f.pump.start();await flush();f.pump.retire(undefined);f.send('{"late":1}');
  await f.pump.finishCleanup();f.pump.start();assert.equal(f.writes.length,0);
  assert.equal(f.pump.status().firstCausePresent,true);assert.equal(f.pump.status().firstCause,undefined);
});
test('cancel retains entered write callback until actual settlement and never writes successor',async()=>{
  const f=fixture();f.hold();f.send('{"first":1}');f.send('{"second":1}');f.pump.start();await flush();
  f.pump.retire(Error('PUBLIC_CANCEL'));let drained=false;const done=f.pump.finishCleanup().then(()=>{drained=true;});
  await flush();assert.equal(drained,false);assert.equal(f.callbacks.length,1);
  f.callbacks[0]();await done;assert.equal(f.writes.length,1);assert.equal(f.pump.status().pending,0);
});
test('current loss before write prevents dispatch; late inbound current cannot deliver',async()=>{
  const f=fixture(), gate=deferred();f.current(()=>gate.promise);f.send('{"request":1}');f.pump.start();
  f.pump.accept(Buffer.from('{"response":1}\n'));await flush();f.pump.retire(false);gate.resolve();
  await f.pump.finishCleanup();assert.equal(f.writes.length,0);assert.equal(f.received.length,0);assert.equal(f.causes[0],false);
});
for(const bytes of [Buffer.from([255,10]),Buffer.from('\n'),Buffer.alloc(PRIVATE_PAYLOAD_INBOUND_LIMIT+1,65)])
test('malformed or oversized inbound retires without invoking SDK decoder '+bytes.length,async()=>{
  const f=fixture();f.pump.accept(bytes);await f.pump.finishCleanup();assert.equal(f.received.length,0);assert.equal(f.causes.length,1);
});
for(const raw of ['{}\n{}','x'.repeat(PRIVATE_PAYLOAD_OUTBOUND_LIMIT+1)])
test('invalid outbound is not written or retried '+raw.length,async()=>{
  const f=fixture();f.send(raw);f.pump.start();await flush();await f.pump.finishCleanup();assert.equal(f.writes.length,0);assert.equal(f.causes.length,1);
});
test('queue budget includes complete frames waiting for current',async()=>{
  const f=fixture(),gate=deferred();f.current(()=>gate.promise);
  f.pump.accept(Buffer.from('x'.repeat(100000)+'\n'));f.pump.accept(Buffer.from('y'.repeat(100000)+'\n'));
  assert.equal(f.pump.status().retired,true);gate.resolve();await f.pump.finishCleanup();assert.equal(f.received.length,0);
});
test('uncertain write preserves original cause and stops without resend',async()=>{
  const f=fixture();f.hold();f.send('{}');f.pump.start();await flush();const first=Error('PUBLIC_WRITE');f.callbacks[0](first);
  await flush();await f.pump.finishCleanup();assert.equal(f.pump.status().firstCause,first);assert.equal(f.writes.length,1);
  f.pump.retire(Error('PUBLIC_LATE'));assert.equal(f.pump.status().firstCause,first);
});
test('failed framer retirement retains cleanup debt including undefined rejection',async()=>{
  const f=fixture();f.framer.retireTransport=()=>{throw undefined;};f.pump.retire(null);
  const status=await f.pump.finishCleanup();assert.equal(status.complete,false);assert.equal(status.retireErrorPresent,true);assert.equal(status.retireError,undefined);
});
