import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONTENT_FILTER, LocalContentDisplay, type ContentScores } from './localContentDisplay';

const original = new TextEncoder().encode('Authorized ordinary test content');
const safe: ContentScores = { gore: 0.01, explicit_violence: 0.02, sexual_content: 0.03 };

for (const [name, invalid] of [
  ['null', null],
  ['undefined', undefined],
  ['missing-category', { gore: 0.01, explicit_violence: 0.02 }],
  ['throwing-field', Object.defineProperty({ ...safe }, 'gore', {
    get() { throw new Error('Classifier bridge field failed'); },
  })],
] as const) {
  test(`${name} result settles fail-closed, wipes owned input and permits retry`, async () => {
    let calls = 0;
    let captured: Uint8Array | undefined;
    const gate = new LocalContentDisplay({
      supportedMimeTypes: ['text/plain'],
      async classify(bytes) {
        captured = bytes;
        // Intentionally simulate an invalid runtime bridge result; this is not
        // a model or a production type-check escape.
        return ++calls === 1 ? invalid as unknown as ContentScores : safe;
      },
    }, { maxConcurrent: 1, maxBytes: 1024, timeoutMs: 1000 });
    gate.configure({ ...DEFAULT_CONTENT_FILTER, enabled: true });
    const failed = await gate.begin('first', original, 'text/plain').completed;
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.reason, 'classification_failed');
    assert.equal(gate.canDisplay('first', original, failed), false);
    assert.ok(captured && captured.every(byte => byte === 0));
    const retry = gate.begin('retry', original, 'text/plain');
    assert.equal(retry.initial.status, 'pending');
    assert.equal((await retry.completed).status, 'clear');
    gate.dispose();
  });
}

test('adapter scores are captured once before validation and thresholding', async () => {
  let reads = 0;
  const changing = Object.defineProperty({ ...safe }, 'gore', {
    get() { return ++reads === 1 ? 0.9 : 0.01; },
  });
  const gate = new LocalContentDisplay({
    supportedMimeTypes: ['text/plain'],
    async classify() { return changing; },
  });
  gate.configure({ ...DEFAULT_CONTENT_FILTER, enabled: true });
  const decision = await gate.begin('event', original, 'text/plain').completed;
  assert.equal(reads, 1);
  assert.equal(decision.status, 'folded');
  assert.deepEqual(decision.flagged, ['gore']);
  assert.equal(gate.canDisplay('event', original, decision), false);
  gate.dispose();
});
