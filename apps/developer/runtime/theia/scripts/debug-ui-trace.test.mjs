import test from 'node:test';
import assert from 'node:assert/strict';
import trace from '../../ynx-workbench/lib/debug-ui-trace.js';

test('trace is dormant until step and bounded without retaining or sending user content', async () => {
  const rows = [], secret = 'private project text';
  const pending = Promise.resolve(secret);
  const proto = { stepOver() { return pending; }, render() { return this.value; } };
  trace.traceMethods([['thread', proto, ['stepOver', 'render']]], value => rows.push(value), 6);
  const object = Object.assign(Object.create(proto), { value: secret });
  assert.equal(object.render(), secret);
  assert.equal(rows.length, 0);
  assert.equal(object.stepOver(), pending);
  await pending;
  for (let index = 0; index < 100; index++) assert.equal(object.render(), secret);
  assert.equal(rows.length, 6);
  assert.equal(JSON.stringify(rows).includes(secret), false);
  assert.deepEqual(rows[0], { action: 'debug-ui-trace', seq: 1, event: 'thread.stepOver', phase: 'begin', count: 2 });
  for (const row of rows) {
    assert.match(row.event, /^[A-Za-z0-9_.-]{1,80}$/);
    assert.ok(['begin', 'end'].includes(row.phase));
  }
});

test('trace preserves throw, rejection, return identities and tolerates unavailable native sink', async () => {
  const error = new Error('never logged');
  const pending = Promise.reject(error);
  const proto = { stepOver() { return 9; }, fail() { throw error; }, rejected() { return pending; } };
  trace.traceMethods([['thread', proto, ['stepOver', 'fail', 'rejected']]], () => { throw new Error('native unavailable'); });
  assert.equal(proto.stepOver(), 9);
  assert.throws(() => proto.fail(), value => value === error);
  assert.equal(proto.rejected(), pending);
  await assert.rejects(pending, value => value === error);
  trace.install({});
  trace.install({ __ynxDebugUiTraceEnabled: true });
});

test('installing twice does not add duplicate wrappers', () => {
  let count = 0;
  const proto = { stepOver() { return 4; } };
  const targets = [['thread', proto, ['stepOver']]];
  trace.traceMethods(targets, () => count++);
  const first = proto.stepOver;
  trace.traceMethods(targets, () => assert.fail('duplicate sink'));
  assert.equal(proto.stepOver, first);
  assert.equal(proto.stepOver(), 4);
  assert.equal(count, 2);
});

test('timer wrapper records only after arming and preserves callback receiver arguments and handle', () => {
  const scheduled = [], rows = [], timerHost = { setTimeout(callback, delay, ...args) { scheduled.push({ callback, delay, args }); return 123; }, setInterval(callback, delay) { scheduled.push({ callback, delay }); return 456; } };
  const proto = { stepOver() {} };
  trace.traceMethods([['thread', proto, ['stepOver']]], row => rows.push(row), 300, timerHost);
  const receiver = {};
  const fn = function (value) { assert.equal(this, receiver); return value; };
  assert.equal(timerHost.setTimeout(fn, 12, 42), 123);
  assert.equal(scheduled[0].delay, 12);
  assert.equal(scheduled[0].callback.call(receiver, ...scheduled[0].args), 42);
  assert.equal(rows.length, 0);
  proto.stepOver();
  assert.equal(scheduled[0].callback.call(receiver, 43), 43);
  assert.equal(rows.at(-2).event, 'timer.setTimeout');
  assert.equal(rows.at(-2).phase, 'begin');
  assert.equal(rows.at(-1).phase, 'end');
  assert.equal(timerHost.setInterval(fn, 5), 456);
  assert.equal(timerHost.setTimeout('legacy string', 9), 123);
  assert.equal(scheduled.at(-1).callback, 'legacy string');
});

test('timer stack serialization exposes numeric positions only and is bounded', () => {
  const stack = 'secret\nfunction@http://localhost:123/bundle.js:10:20\n at user (/secret/private.js:30:40)\n' + 'x@http://local/chunk.js:50:60\n'.repeat(20);
  const locations = trace.timerLocations(stack);
  assert.equal(locations.length, 4);
  for (const item of locations) assert.match(item, /^timer\.location\.\d+\.\d+\.\d+$/);
  assert.equal(JSON.stringify(locations).includes('secret'), false);
});

test('large push is observed once, preserves mutation and is gated before step', () => {
  const rows = [], proto = { stepOver() {} }, arrayProto = { push: Array.prototype.push };
  trace.traceMethods([['thread', proto, ['stepOver']]], value => rows.push(value), 300, undefined, arrayProto);
  const array = new Array(10000);
  assert.equal(arrayProto.push.call(array, 1), 10001);
  assert.equal(rows.length, 0);
  proto.stepOver();
  assert.equal(arrayProto.push.call(array, 2), 10002);
  assert.equal(array[10001], 2);
  arrayProto.push.call(array, 3);
  assert.equal(rows.filter(row => row.event === 'array.largePush').length, 1);
});
