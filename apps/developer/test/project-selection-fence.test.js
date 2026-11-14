import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRequestEpoch } from '../frontend/src/codeoss/requestEpoch.ts';

test('selection retires old output before render/effects', async () => {
  const fence = createProjectRequestEpoch('P');
  const captured = fence.capture();
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const displayed = [];
  const pending = response.then(value => { if (fence.current(captured)) displayed.push(value); });
  fence.activate('Q');
  assert.equal(fence.project(), 'Q');
  resolve('P late output');
  await pending;
  assert.deepEqual(displayed, []);
  assert.equal(fence.current(fence.capture()), true);
});

test('P to Q to P never revives the first P', () => {
  const fence = createProjectRequestEpoch('P');
  const oldP = fence.capture();
  fence.activate('Q');
  const oldQ = fence.capture();
  fence.activate('P');
  assert.equal(fence.current(oldP), false);
  assert.equal(fence.current(oldQ), false);
  assert.equal(fence.project(), 'P');
});

test('same-project reselection and refresh retire prior requests', () => {
  const fence = createProjectRequestEpoch('P');
  const initial = fence.capture();
  fence.activate('P');
  assert.equal(fence.current(initial), false);
  const refresh = fence.capture();
  fence.invalidate();
  assert.equal(fence.current(refresh), false);
  assert.equal(fence.project(), 'P');
});
