import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const { admissionDeliveryCanonical: canonical, createInstalledAdmissionReceiver, openOriginalParentDelivery } = await import(process.env.YNX_PUBLIC_REPAIR_DELIVERY_SOURCE || './wallet-admission-delivery.mjs');

// Explicit PUBLIC stand-ins. No original key, installed receipt, subprocess,
// native socket, Gateway or crypto is used; this is receiver behavior only.
const at = 1800000000000;
const tuple = { service: 'wallet-product-session-v2', productId: 'developer', platform: 'macos', gatewayOrigin: 'https://wallet-auth.ynxweb4.com', operation: 'beginYNX' };
function installed() {
  const request = { version: 1, purpose: 'wallet-product-session-v2-service-admission/v1', service: tuple.service,
    productId: tuple.productId, platform: tuple.platform, applicationId: 'com.ynxweb4.developer.testnetpreview',
    gatewayOrigin: tuple.gatewayOrigin, registryDigest: '1'.repeat(64), consumerManifestDigest: '2'.repeat(64),
    gatewayManifestDigest: '3'.repeat(64), instanceId: 'PUBLIC-instance', currentReference: '4'.repeat(64),
    operations: ['beginYNX', 'handleReturn', 'restore', 'disconnect'], requestNonce: 'a'.repeat(43),
    requestedAtMs: at, expiresAtMs: at + 60000 };
  return { type: 'installed', sequence: 1, expiresAtMs: at + 20000, selection: {
    sourceSelection: { rootPath: '/PUBLIC/root', rootDigest: '5'.repeat(64), rolePath: '/PUBLIC/role', roleDigest: '6'.repeat(64) },
    receiptSelection: { receiptPath: '/PUBLIC/receipts/' + request.requestNonce + '.admission.json', receiptDigest: '7'.repeat(64) },
    expectedRequest: request, receiptDirectory: '/PUBLIC/receipts' } };
}
class PublicStream extends EventEmitter {
  writes = []; destroyed = false; callbacks = [];
  write(value, callback) { this.writes.push(value); if (this.holdWrite) this.callbacks.push(callback); else callback(); }
  destroy() { this.destroyed = true; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
for (const first of [undefined, null, false, 0, '']) test('R89 original parent failure preserves exact cause ' + String(first), async () => {
  let fail = false;
  const f = fixture({ parentCurrent() { if (fail) return Promise.reject(first); } });
  f.send(); await flush(); fail = true;
  await assert.rejects(f.receiver.assertCurrent(tuple), error => Object.hasOwn(error, 'cause') && error.cause === first);
  assert.equal(f.receiver.cleanupStatus().firstCause, first);
  assert.deepEqual(await f.receiver.finishCleanup(), { complete: true });
  f.receiver.close(Error('PUBLIC_LATE'));
  assert.equal(f.receiver.cleanupStatus().firstCause, first);
  assert.equal(f.closes(), 1);
});
test('R89 omitted close differs from explicit undefined failure', async () => {
  const omitted = fixture(); omitted.receiver.close();
  assert.equal(omitted.receiver.cleanupStatus().firstCause.code, 'WALLET_SERVICE_ADMISSION_UNAVAILABLE');
  await omitted.receiver.finishCleanup();
  const explicit = fixture(); explicit.receiver.close(undefined);
  assert.equal(explicit.receiver.cleanupStatus().firstCause, undefined);
  await explicit.receiver.finishCleanup();
});
function fixture({ validate, parentCurrent, parentClose, privateAcquire, privateCleanup } = {}) {
  let clock = at, closes = 0, calls = 0;
  const timers = new Set(), stream = new PublicStream();
  const parent = { async assertCurrent(r) { if (parentCurrent) return parentCurrent(r); }, async close() { closes++; if (parentClose) return parentClose(); } };
  const receiver = createInstalledAdmissionReceiver({ stream, parentBinding: parent, runningBackendModuleURL: 'file:///PUBLIC/App/Contents/Resources/server.mjs',
    acquirePrivateChannel: privateAcquire,
    getPrivateChannelCleanup: privateCleanup,
    now: () => clock, schedule: (fn, delay) => { const token = { fn, deadline: clock + delay }; timers.add(token); return token; }, unschedule: token => timers.delete(token),
    validateInstalled: validate || ((selection, entry) => {
      assert.equal(entry, 'file:///PUBLIC/App/Contents/Resources/server.mjs'); assert.ok(Object.isFrozen(selection.expectedRequest));
      return { async assertCurrent(v) { calls++; assert.equal(v.service, tuple.service); } };
    }) });
  return { stream, receiver, timers, clocks(value) { clock = value; }, closes: () => closes, calls: () => calls,
    send(value = installed()) { stream.emit('data', Buffer.from(canonical(value) + '\n')); } };
}
// PUBLIC same-reader transport instruments only, not a Native client/grant.
function privateFixture({ closeFailure } = {}) {
  let stop;
  const received=[],events=[],outbound=new Promise(resolve=>{stop=resolve;});
  const original={retire(cause){events.push(['retire',cause]);stop(null);},async join(){events.push(['join']);},async close(){events.push(['close']);if(closeFailure)throw closeFailure;}};
  const framer={assertCurrent(){},nextOutboundFrame(){return outbound;},acceptInboundFrame(raw){received.push(raw);},retireTransport(cause){events.push(['transport-retire',cause]);stop(null);}};
  return {channel:{original,framer},received,events};
}
test('R90 installed ACK transitions the same sole reader to SDK payload; child closes before parent',async()=>{
  const child=privateFixture();let acquisitions=0;
  const f=fixture({privateAcquire(){acquisitions++;assert.equal(f.stream.writes.length,1);return child.channel;},parentClose(){child.events.push(['parent-close']);}});
  assert.equal(acquisitions,0);f.send();await flush();
  f.stream.emit('data',Buffer.from('{"PUBLIC":'));f.stream.emit('data',Buffer.from('1}\n'));await flush();
  assert.equal(f.stream.listenerCount('data'),1);assert.deepEqual(child.received,['{"PUBLIC":1}']);
  assert.equal(acquisitions,1);f.receiver.close();assert.deepEqual(await f.receiver.finishCleanup(),{complete:true});
  assert.deepEqual(child.events.filter(e=>['join','close','parent-close'].includes(e[0])).map(e=>e[0]),['join','close','parent-close']);
  assert.equal(f.stream.listenerCount('data'),0);assert.equal(f.closes(),1);
});
test('R90 retirement joins late acquired actual partial before disposing original parent',async()=>{
  let release;const acquired=new Promise(resolve=>{release=resolve;}),child=privateFixture();
  const f=fixture({privateAcquire:()=>acquired,parentClose(){child.events.push(['parent-close']);}});f.send();await flush();
  f.receiver.close(false);let drained=false;const cleanup=f.receiver.finishCleanup().then(value=>{drained=true;return value;});
  await flush();assert.equal(drained,false);assert.equal(f.closes(),0);release(child.channel);
  assert.deepEqual(await cleanup,{complete:true});assert.equal(child.received.length,0);
  assert.deepEqual(child.events.filter(e=>['retire','join','close','parent-close'].includes(e[0])).map(e=>e[0]),['retire','join','close','parent-close']);
  assert.equal(child.events[0][1],false);
});
test('R90 uncertain child close retains child debt and never calls parent close',async()=>{
  const failure=Error('PUBLIC_CHILD_CLOSE'),child=privateFixture({closeFailure:failure});
  const f=fixture({privateAcquire:()=>child.channel});f.send();await flush();f.receiver.close();
  await assert.rejects(f.receiver.finishCleanup(),error=>error.cleanupError===failure);
  assert.equal(f.closes(),0);assert.equal(f.receiver.cleanupStatus().ownerRetained,true);
  f.receiver.close();await assert.rejects(f.receiver.finishCleanup());assert.equal(child.events.filter(e=>e[0]==='close').length,1);
});
test('R90 rejected SDK acquisition retains unknown partial debt without attempting parent close',async()=>{
  const first=Error('PUBLIC_PARTIAL_READY_REFUSED');let acquisitions=0;
  const f=fixture({privateAcquire(){acquisitions++;throw first;}});f.send();await flush();
  await assert.rejects(f.receiver.finishCleanup(),error=>error.cause===first&&error.cleanupError===first);
  assert.equal(f.closes(),0);assert.equal(f.receiver.cleanupStatus().ownerRetained,true);
  f.receiver.close();await assert.rejects(f.receiver.finishCleanup());assert.equal(acquisitions,1);
});
test('R91 fixed SDK cleanup getter joins same partial after falsy acquisition refusal',async()=>{
  const child=privateFixture();let acquire=0,get=0;
  const f=fixture({privateAcquire(){acquire++;throw undefined;},privateCleanup(){get++;return child.channel.original;},parentClose(){child.events.push(['parent-close']);}});
  f.send();await flush();assert.deepEqual(await f.receiver.finishCleanup(),{complete:true});
  assert.equal(f.receiver.cleanupStatus().firstCause,undefined);assert.equal(acquire,1);assert.equal(get,1);
  assert.deepEqual(child.events.map(e=>e[0]),['retire','join','close','parent-close']);assert.equal(child.events[0][1],undefined);
});
test('R91 only fixed SDK null confirms no child; original factory failure is retained',async()=>{
  const first=Error('PUBLIC_NO_CHILD');const f=fixture({privateAcquire(){throw first;},privateCleanup(){return null;}});
  f.send();await flush();assert.deepEqual(await f.receiver.finishCleanup(),{complete:true});
  assert.equal(f.receiver.cleanupStatus().firstCause,first);assert.equal(f.closes(),1);
});
test('R91 failed fixed cleanup lookup retains both first cause and cleanup debt',async()=>{
  const first=Error('PUBLIC_CAPTURE'),lookup=Error('PUBLIC_LOOKUP');
  const f=fixture({privateAcquire(){throw first;},privateCleanup(){throw lookup;}});f.send();await flush();
  await assert.rejects(f.receiver.finishCleanup(),error=>error.cause===first&&error.cleanupError===lookup);
  assert.equal(f.closes(),0);assert.equal(f.receiver.cleanupStatus().ownerRetained,true);
});
test('R91 reentrant startup shares one failed original selection without another fd adoption',async()=>{
  let acquisitions=0,closes=0;const first=Error('PUBLIC_BEFORE_FD');
  const supplier={async acquireOriginalIDEAdmissionParentDelivery(){acquisitions++;return{descriptor:4,assertCurrent(){throw first;},close(){closes++;}};}};
  const options={supplier,runningBackendModuleURL:'file:///PUBLIC/R91/server.mjs',validateInstalled(){throw Error('must not run');}};
  const [a,b]=await Promise.all([openOriginalParentDelivery(options),openOriginalParentDelivery(options)]);
  assert.equal(a,b);assert.equal(acquisitions,1);await a.finishCleanup();assert.equal(closes,1);
  assert.equal(await openOriginalParentDelivery(options),a);assert.equal(acquisitions,1);
});
test('R90 payload before installed ACK completion cannot acquire child or reach SDK',async()=>{
  const child=privateFixture();let acquired=0;const f=fixture({privateAcquire(){acquired++;return child.channel;}});
  f.stream.holdWrite=true;f.send();await flush();f.stream.emit('data',Buffer.from('{}\n'));
  f.stream.callbacks[0]();await flush();assert.equal(acquired,0);assert.equal(child.received.length,0);
  await f.receiver.finishCleanup();assert.equal(f.closes(),1);
});
test('PUBLIC normal installed epoch validates in actual-entry boundary and ACKs exact Native R9 tuple', async () => {
  const f = fixture(); await assert.rejects(f.receiver.assertCurrent(tuple), { code: 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED' });
  f.send(); await flush();
  assert.deepEqual(JSON.parse(f.stream.writes[0]), { type: 'ack', requestNonce: 'a'.repeat(43), receiptDigest: '7'.repeat(64), sequence: 1, consumerManifestDigest: '2'.repeat(64) });
  assert.equal(f.stream.writes[0], canonical(JSON.parse(f.stream.writes[0])) + '\n');
  for (const op of ['beginYNX', 'handleReturn', 'restore', 'disconnect']) await f.receiver.assertCurrent({ ...tuple, operation: op });
  assert.equal(f.calls(), 5); assert.equal(f.timers.size, 1);
  f.receiver.close(); f.receiver.close(); await f.receiver.finishCleanup(); assert.equal(f.closes(), 1); assert.equal(f.timers.size, 0);
});
test('PUBLIC fragmented canonical record gets one validation and ACK', async () => {
  const f = fixture(), bytes = Buffer.from(canonical(installed()) + '\n');
  for (const byte of bytes) f.stream.emit('data', Buffer.from([byte]));
  await flush(); assert.equal(f.stream.writes.length, 1); await f.receiver.assertCurrent(tuple); await f.receiver.finishCleanup();
});
for (const [name, change] of [
  ['wrong consumer product', v => { v.selection.expectedRequest.productId = 'social'; }],
  ['wrong operation list', v => { v.selection.expectedRequest.operations.push('sign'); }],
  ['wrong receipt nonce path', v => { v.selection.receiptSelection.receiptPath = '/PUBLIC/receipts/other.admission.json'; }],
  ['unbounded expiry', v => { v.expiresAtMs = at + 31000; }],
  ['extra account field', v => { v.account = 'PUBLIC'; }],
  ['noncanonical path', v => { v.selection.sourceSelection.rolePath = '/PUBLIC/../role'; }],
  ['extra authority field', v => { v.selection.sourceSelection.privateKey = 'PUBLIC-never-a-key'; }],
]) test('PUBLIC rejects ' + name + ' without ACK or validator effect', async () => {
  const f = fixture(), v = installed(); change(v); f.send(v); await flush();
  await assert.rejects(f.receiver.assertCurrent(tuple)); assert.equal(f.calls(), 0); assert.equal(f.stream.writes.length, 0); await f.receiver.finishCleanup();
});
for (const [name, bytes] of [
  ['oversized', Buffer.alloc(65537, 32)], ['multiple frames', Buffer.from(canonical(installed()) + '\n{}\n')],
  ['whitespace', Buffer.from(' ' + canonical(installed()) + '\n')], ['invalid UTF8', Buffer.from([0xff, 10])],
  ['BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical(installed()) + '\n')])],
]) test('PUBLIC framing retires ' + name, async () => {
  const f = fixture(); f.stream.emit('data', bytes); await flush(); await assert.rejects(f.receiver.assertCurrent(tuple));
  assert.equal(f.stream.writes.length, 0); await f.receiver.finishCleanup();
});
test('PUBLIC duplicate epoch does not validate/run a second time', async () => {
  const f = fixture(); f.send(); await flush(); f.send(); await flush();
  await assert.rejects(f.receiver.assertCurrent(tuple)); assert.equal(f.calls(), 1); assert.equal(f.stream.writes.length, 1); await f.receiver.finishCleanup();
});
test('PUBLIC EOF during async validation immediately retires; late validation cannot ACK', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; });
  const f = fixture({ validate: () => pending }); f.send(); await flush(); f.stream.emit('end');
  await assert.rejects(f.receiver.assertCurrent(tuple), { code: 'WALLET_SERVICE_ADMISSION_UNAVAILABLE' });
  resolve({ assertCurrent() {} }); await flush(); assert.equal(f.stream.writes.length, 0); await f.receiver.finishCleanup();
});
test('PUBLIC ACK callback uncertainty plus cancellation cannot activate epoch', async () => {
  const f = fixture(); f.stream.holdWrite = true; f.send(); await flush();
  f.receiver.close(); f.stream.callbacks[0](); await flush();
  await assert.rejects(f.receiver.assertCurrent(tuple)); assert.equal(f.closes(), 1); await f.receiver.finishCleanup();
});
test('PUBLIC pending four-op fails immediately on EOF and late result cannot return success', async () => {
  let resolve, count = 0; const pending = new Promise(r => { resolve = r; });
  const f = fixture({ validate: () => ({ assertCurrent() { return ++count === 1 ? undefined : pending; } }) });
  f.send(); await flush(); const operation = f.receiver.assertCurrent(tuple); await flush(); f.stream.emit('close');
  await assert.rejects(operation, { code: 'WALLET_SERVICE_ADMISSION_UNAVAILABLE' }); resolve(); await flush();
  await assert.rejects(f.receiver.assertCurrent(tuple)); await f.receiver.finishCleanup();
});
test('PUBLIC reentrant four-op retires both requests without duplicate effects', async () => {
  let count = 0; const f = fixture({ validate: () => ({ assertCurrent() { if (++count > 1) return new Promise(() => {}); } }) });
  f.send(); await flush(); const first = f.receiver.assertCurrent(tuple); await flush();
  await assert.rejects(f.receiver.assertCurrent(tuple)); await assert.rejects(first); assert.equal(count, 2); const done=f.receiver.finishCleanup();for(const token of [...f.timers])token.fn();assert.deepEqual(await done,{complete:false,unknown:true});assert.equal(f.closes(),0);
});
for (const scenario of ['expiry', 'rollback', 'parent-change']) test('PUBLIC current rejects ' + scenario + ' without refreshing authorization', async () => {
  let changed = false; const f = fixture({ parentCurrent: () => { if (changed) throw Object.assign(Error('PUBLIC-first'), { code: 'PUBLIC_OWNER_CHANGED' }); } });
  f.send(); await flush(); if (scenario === 'expiry') f.clocks(at + 20000); if (scenario === 'rollback') f.clocks(at - 1); if (scenario === 'parent-change') changed = true;
  await assert.rejects(f.receiver.assertCurrent(tuple)); assert.equal(f.stream.writes.length, 1); await f.receiver.finishCleanup();
});
test('PUBLIC partial record timeout and cleanup failure remain failure', async () => {
  const f = fixture({ parentClose: () => { throw Error('PUBLIC_CLOSE_FAILED'); } });
  f.stream.emit('data', Buffer.from('{')); for (const token of [...f.timers]) token.fn();
  await assert.rejects(f.receiver.assertCurrent(tuple)); await assert.rejects(f.receiver.finishCleanup(), e => e.cleanupError?.message === 'PUBLIC_CLOSE_FAILED'); assert.equal(f.closes(), 1);
});
test('PUBLIC cleanup deadline reports UNKNOWN without repeated close or reopening', async () => {
  const f = fixture({ parentClose: () => new Promise(() => {}) });
  f.receiver.close(); await flush();
  const done = f.receiver.finishCleanup(); for (const token of [...f.timers]) token.fn();
  assert.deepEqual(await done, { complete: false, unknown: true });
  await assert.rejects(f.receiver.assertCurrent(tuple)); f.receiver.close(); assert.equal(f.closes(), 1);
});
test('fixed original module absent parent supplier does not touch fd4 or evaluate validator', async () => {
  assert.equal(await openOriginalParentDelivery({ supplier: {}, runningBackendModuleURL: 'PUBLIC', validateInstalled() { throw Error('must not execute'); } }), null);
});
test('PUBLIC rejected original parent binding retains first failure and closes exactly once before fd adoption', async () => {
  const first = Object.assign(Error('PUBLIC_FIRST'), { code: 'WALLET_SERVICE_ADMISSION_DENIED' });
  let closes = 0;
  const supplier = { async acquireOriginalIDEAdmissionParentDelivery() { return { descriptor: 4,
    assertCurrent() { throw first; }, async close() { closes++; } }; } };
  const facade=await openOriginalParentDelivery({ supplier, runningBackendModuleURL: 'PUBLIC', validateInstalled() {} });
  assert.throws(()=>facade.assertCurrent(),error=>error===first);await facade.finishCleanup();
  assert.equal(closes, 1);
});
test('PUBLIC rejected parent cleanup error preserves original cause without retrying disposal', async () => {
  const first = Error('PUBLIC_FIRST'), cleanup = Error('PUBLIC_UNKNOWN_CLOSE'); let closes = 0;
  const supplier = { async acquireOriginalIDEAdmissionParentDelivery() { return { descriptor: 4,
    assertCurrent() { throw first; }, async close() { closes++; throw cleanup; } }; } };
  const facade=await openOriginalParentDelivery({ supplier, runningBackendModuleURL: 'PUBLIC', validateInstalled() {} });
  await assert.rejects(facade.finishCleanup(), error => error.cause === first && error.cleanupError === cleanup);assert.equal(facade.cleanupStatus().ownerRetained,true);
  assert.equal(closes, 1);
});

test('PUBLIC frozen Native R9 sender interoperates with actual IDE receiver and EOF retirement', { skip: !process.env.YNX_PUBLIC_NATIVE_BROKER_SOURCE }, async () => {
  // Optional PUBLIC integration source is test-only, never a production
  // authority selector. Root supplies the frozen original broker's exact path.
  const { pathToFileURL } = await import('node:url');
  const { createOriginalAdmissionBroker } = await import(pathToFileURL(process.env.YNX_PUBLIC_NATIVE_BROKER_SOURCE));
  class PublicLinkedStream extends PublicStream {
    write(value, callback) { this.writes.push(value); queueMicrotask(() => { this.peer.emit('data', Buffer.from(value)); callback(); }); }
    destroy() { if (this.destroyed) return; this.destroyed = true; queueMicrotask(() => this.peer.emit('end')); }
  }
  const native = new PublicLinkedStream(), ide = new PublicLinkedStream(); native.peer = ide; ide.peer = native;
  let closes = 0;
  const receiver = createInstalledAdmissionReceiver({ stream: ide, parentBinding: { assertCurrent() {}, close() { closes++; } },
    runningBackendModuleURL: 'file:///PUBLIC/Resources/server.mjs', now: () => at,
    validateInstalled: () => ({ assertCurrent() {} }) });
  const broker = createOriginalAdmissionBroker({ stream: native, assertChannelCurrent() {}, now: () => at });
  const v = installed(); await broker.deliver({ selection: v.selection, sequence: v.sequence, expiresAtMs: v.expiresAtMs, account: 'PUBLIC' });
  await flush(); await receiver.assertCurrent(tuple); assert.equal(ide.writes.length, 1);
  broker.close(); await flush(); await assert.rejects(receiver.assertCurrent(tuple)); await receiver.finishCleanup(); assert.equal(closes, 1);
});

// Only this selection is run for the four-P2 successor; old controls and raw
// results remain intact. Explicit PUBLIC callbacks never grant real supply.
for (const entered of ['parent-current', 'validation', 'validator-current', 'ACK']) test('P2 repair joins entered ' + entered + ' before disposal', async () => {
  let resolve, armed = false, count = 0;
  const pending = new Promise(r => { resolve = r; });
  const f = fixture({ parentCurrent: () => entered === 'parent-current' && armed ? pending : undefined,
    validate: () => entered === 'validation' ? pending : { assertCurrent() { count++; return entered === 'validator-current' && count > 1 ? pending : undefined; } } });
  if (entered === 'ACK') f.stream.holdWrite = true;
  f.send(); await flush();
  let op;
  if (entered === 'parent-current' || entered === 'validator-current') { armed = true; op = f.receiver.assertCurrent(tuple); await flush(); }
  f.stream.emit('end'); if (op) await assert.rejects(op);
  await flush(); assert.equal(f.closes(), 0, 'must retain borrowed original owner');
  assert.equal(f.receiver.cleanupStatus().pendingCalls, 1);
  assert.equal(f.receiver.cleanupStatus().ownerRetained, true);
  const done = f.receiver.finishCleanup();
  if (entered === 'ACK') f.stream.callbacks[0](); else resolve(entered === 'validation' ? { assertCurrent() {} } : undefined);
  await flush(); assert.deepEqual(await done, { complete: true });
  assert.equal(f.closes(), 1); assert.equal(f.receiver.cleanupStatus().ownerRetained, false);
  await assert.rejects(f.receiver.assertCurrent(tuple));
});
test('P2 repair unresolved entered borrow reports UNKNOWN without entering close', async () => {
  const f = fixture({ validate: () => new Promise(() => {}) }); f.send(); await flush(); f.receiver.close(); await flush();
  const done = f.receiver.finishCleanup(); for (const t of [...f.timers]) t.fn();
  assert.deepEqual(await done, { complete: false, unknown: true });
  assert.equal(f.closes(), 0); assert.equal(f.receiver.cleanupStatus().ownerRetained, true);
  assert.equal(f.receiver.cleanupStatus().pendingCalls, 1); f.receiver.close(); assert.equal(f.closes(), 0);
});
test('P2 repair late original rejection is joined without reviving or overwriting first cause', async () => {
  let reject; const pending = new Promise((_, r) => { reject = r; });
  const f = fixture({ validate: () => pending }); f.send(); await flush();
  const cause = Error('PUBLIC_CANCEL'); f.receiver.close(cause); reject(Error('PUBLIC_LATE')); await flush();
  assert.deepEqual(await f.receiver.finishCleanup(), { complete: true });
  assert.equal(f.receiver.cleanupStatus().firstCause, cause); assert.equal(f.stream.writes.length, 0);
});
for (const value of [false, null, undefined]) test('P2 repair partial owner retains falsy rejected cleanup ' + String(value), async () => {
  const first = Error('PUBLIC_FIRST'); let closes = 0;
  const binding = { descriptor: 4, assertCurrent() { throw first; }, close() { closes++; return Promise.reject(value); } };
  const facade = await openOriginalParentDelivery({ supplier: { acquireOriginalIDEAdmissionParentDelivery() { return binding; } }, runningBackendModuleURL: 'PUBLIC', validateInstalled() {} });
  assert.throws(() => facade.assertCurrent(), e => e === first);
  await assert.rejects(facade.finishCleanup(), e => e.cause === first && Object.hasOwn(e, 'cleanupError') && e.cleanupError === value);
  assert.equal(facade.cleanupStatus().ownerRetained, true); assert.equal(facade.cleanupStatus().cleanupState, 'failed');
  facade.close(); await assert.rejects(facade.finishCleanup()); assert.equal(closes, 1);
});
test('P2 repair partial owner rejects fulfilled incomplete close shape', async () => {
  let closes = 0; const first = Error('PUBLIC_FIRST');
  const facade = await openOriginalParentDelivery({ supplier: { acquireOriginalIDEAdmissionParentDelivery() { return {
    descriptor: 4, assertCurrent() { throw first; }, close() { closes++; return { complete: false }; }
  }; } }, runningBackendModuleURL: 'PUBLIC', validateInstalled() {} });
  await assert.rejects(facade.finishCleanup()); assert.equal(facade.cleanupStatus().ownerRetained, true); assert.equal(closes, 1);
});
test('P2 repair partial clean disposal still refuses service with original cause', async () => {
  let closes = 0; const first = Error('PUBLIC_FIRST');
  const facade = await openOriginalParentDelivery({ supplier: { acquireOriginalIDEAdmissionParentDelivery() { return {
    descriptor: 4, assertCurrent() { throw first; }, close() { closes++; }
  }; } }, runningBackendModuleURL: 'PUBLIC', validateInstalled() {} });
  assert.deepEqual(await facade.finishCleanup(), { complete: true }); assert.throws(() => facade.assertCurrent(), e => e === first);
  assert.equal(facade.cleanupStatus().ownerRetained, false); assert.equal(closes, 1);
});

for (const scenario of [
  ['post-frame','throw'],['post-frame','falsy'],['post-frame','incomplete'],
  ['EOF-entered','throw'],['EOF-entered','falsy'],['EOF-entered','incomplete'],
]) test('N1 repair observes derived install cleanup ' + scenario.join('/'), async () => {
  // Separate PUBLIC child catches unhandledRejection without involving an App,
  // fd, private owner, network, service or native target. Parent RED remains
  // an ordinary test failure with a finite captured event count.
  const { spawnSync } = await import('node:child_process');
  const source = process.env.YNX_PUBLIC_REPAIR_DELIVERY_SOURCE || new URL('./wallet-admission-delivery.mjs',import.meta.url).href;
  const harness = `import {EventEmitter} from 'node:events';
    import {createInstalledAdmissionReceiver,admissionDeliveryCanonical} from `+JSON.stringify(source)+`;
    const record=`+JSON.stringify(installed())+`, first=Error('PUBLIC_INSTALL'), clean=Error('PUBLIC_CLEANUP');
    const errors=[];process.on('unhandledRejection',e=>errors.push(e?.code||String(e)));
    let closes=0,release;const timers=new Set(),pending=new Promise((resolve,reject)=>{release=()=>reject(first);});
    class PublicStream extends EventEmitter {writes=[];write(v,done){this.writes.push(v);done();}destroy(){this.destroyed=true;}}
    const stream=new PublicStream(), receiver=createInstalledAdmissionReceiver({stream,
      parentBinding:{assertCurrent(){},close(){closes++;`+(scenario[1]==='throw'?"throw clean;":scenario[1]==='falsy'?"return Promise.reject(false);":"return {complete:false};")+`}},
      runningBackendModuleURL:'file:///PUBLIC/Resources/server.mjs',now:()=>1800000000000,
      schedule:(fn)=>{const t={fn};timers.add(t);return t;},unschedule:t=>timers.delete(t),
      validateInstalled:()=>`+(scenario[0]==='post-frame'?"Promise.reject(first)":"pending")+`});
    const flush=()=>new Promise(r=>setImmediate(r));
    stream.emit('data',Buffer.from(admissionDeliveryCanonical(record)+'\\n'));await flush();
    let before;
    `+(scenario[0]==='EOF-entered'?"stream.emit('end');await flush();before={closes,status:receiver.cleanupStatus()};release();":"before={closes};")+`
    await flush();await flush();let failure;
    try{await receiver.finishCleanup();}catch(e){failure=e;}
    receiver.close();await flush();
    const status=receiver.cleanupStatus();
    console.log(JSON.stringify({unhandled:errors,closes,before,retained:status.ownerRetained,state:status.cleanupState,
      pending:status.pendingCalls,firstIsOriginal:status.firstCause===`+(scenario[0]==='post-frame'?"first":"failure?.cause && status.firstCause.code==='WALLET_SERVICE_ADMISSION_UNAVAILABLE'")+`,
      cleanupMatches:`+(scenario[1]==='throw'?"status.cleanupError===clean":scenario[1]==='falsy'?"status.cleanupError===false":"status.cleanupError?.cleanupResult?.complete===false")+`,
      failurePresent:!!failure,writes:stream.writes.length,destroyed:stream.destroyed}));`;
  const result=spawnSync(process.execPath,['--input-type=module','--unhandled-rejections=warn','-e',harness],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.error,undefined);
  const observed=JSON.parse(result.stdout.trim());assert.deepEqual(observed.unhandled,[],result.stderr);
  assert.equal(observed.closes,1);assert.equal(observed.retained,true);assert.equal(observed.state,'failed');
  assert.equal(observed.pending,0);assert.equal(observed.firstIsOriginal,true);assert.equal(observed.cleanupMatches,true);
  assert.equal(observed.failurePresent,true);assert.equal(observed.writes,0);assert.equal(observed.destroyed,true);
  if(scenario[0]==='EOF-entered'){assert.equal(observed.before.closes,0);assert.equal(observed.before.status.pendingCalls,1);assert.equal(observed.before.status.ownerRetained,true);}
});
