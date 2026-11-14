import assert from 'node:assert/strict';
import test from 'node:test';
import {OwnDirectoryGate, type OwnDirectoryAction} from './ownDirectory';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const unknown = {version:1, state:'RETAINED', accountViewRef:'account', data:null, firstFailureRetained:true};

test('cold entry observes only; it does not open or read the directory', async () => {
  const actions: OwnDirectoryAction[] = [];
  const gate = new OwnDirectoryGate(async () => ({async observeOwnDeviceDirectory(action) {
    actions.push(action);
    return unknown;
  }}));
  gate.select('restored', 'account');
  gate.observeCurrent();
  await tick();
  assert.deepEqual(actions, ['observe']);
  assert.equal(gate.getSnapshot().result?.state, 'RETAINED');
});

test('re-entry observes the original after an in-flight read without resubmitting it', async () => {
  const actions: OwnDirectoryAction[] = [];
  let finish!: (value: unknown) => void;
  const gate = new OwnDirectoryGate(async () => ({async observeOwnDeviceDirectory(action) {
    actions.push(action);
    if (action === 'read') return new Promise(resolve => {finish = resolve;});
    return unknown;
  }}));
  gate.select('old', 'account');
  const flight = gate.run('read');
  await tick();
  gate.select(null, null);
  gate.select('new', 'account');
  gate.observeCurrent();
  gate.observeCurrent();
  finish({...unknown, accountViewRef:'stale'});
  await flight;
  await tick();
  assert.deepEqual(actions, ['read', 'observe']);
  assert.equal(gate.getSnapshot().result?.accountViewRef, 'account');
});
