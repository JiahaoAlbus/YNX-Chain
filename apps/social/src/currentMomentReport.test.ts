import test from 'node:test';
import assert from 'node:assert/strict';
import { runCurrentMomentReport } from './currentMomentReport';

const hash = 'a'.repeat(64);
test('already stale performs no fingerprint or send', async () => {
  let calls = 0;
  assert.equal(await runCurrentMomentReport(() => false, async () => { calls++; return hash; }, async () => { calls++; return 1; }), undefined);
  assert.equal(calls, 0);
});
test('authority loss while fingerprinting prevents submission', async () => {
  let live = true, sends = 0;
  assert.equal(await runCurrentMomentReport(() => live, async () => { live = false; return hash; }, async () => { sends++; return 1; }), undefined);
  assert.equal(sends, 0);
});
test('late committed response is not published to a stale view', async () => {
  let live = true, sends = 0;
  assert.equal(await runCurrentMomentReport(() => live, async () => hash, async () => { sends++; live = false; return { id: 'original' }; }), undefined);
  assert.equal(sends, 1);
});
test('normal current operation forwards exact fingerprint and receipt', async () => {
  const receipt = Object.freeze({ id: 'original' });
  assert.equal(await runCurrentMomentReport(() => true, async () => hash, async evidence => { assert.equal(evidence, hash); return receipt; }), receipt);
});
test('invalid fingerprint never reaches backend', async () => {
  let sends = 0;
  await assert.rejects(runCurrentMomentReport(() => true, async () => 'invalid', async () => { sends++; }), /fingerprint/);
  assert.equal(sends, 0);
});
test('unknown backend outcome is not retried or turned into success', async () => {
  let sends = 0;
  await assert.rejects(runCurrentMomentReport(() => true, async () => hash, async () => { sends++; throw new Error('unknown'); }), /unknown/);
  assert.equal(sends, 1);
});
