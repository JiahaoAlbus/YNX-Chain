import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalClassifierWorker } from './localClassifierWorker';

for (const mode of ['abort', 'failure'] as const) {
  test(`late subscription cleanup failure after ${mode} stops replacement engines`, async () => {
    const abort = new AbortController();
    let created = 0, detached = 0, terminated = 0, dispatched = 0;
    const classifier = new LocalClassifierWorker(() => {
      ++created;
      return {
        subscribe(_result, fail) {
          if (mode === 'abort') abort.abort();
          else fail();
          return () => { ++detached; throw new Error('Subscription cleanup failed'); };
        },
        postMessage() { ++dispatched; },
        terminate() { ++terminated; },
      };
    }, { supportedMimeTypes: ['image/png'] });
    await assert.rejects(classifier.classify(new Uint8Array([1]), 'image/png', abort.signal),
      mode === 'abort' ? /stopped/ : /worker failed/);
    await assert.rejects(classifier.classify(new Uint8Array([2]), 'image/png', new AbortController().signal), /stopped/);
    assert.equal(created, 1);
    assert.equal(detached, 1);
    assert.equal(terminated, 1);
    assert.equal(dispatched, 0);
    classifier.close();
  });
}
