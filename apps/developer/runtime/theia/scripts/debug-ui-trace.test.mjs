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
