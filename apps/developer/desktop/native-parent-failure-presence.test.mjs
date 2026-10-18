import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createNativeParentControl } from './native-parent-control.mjs';
for (const first of [false, undefined, null, 0, '']) test(`native parent retains original ${String(first)} failure presence through cleanup`, async () => {
  const input = new PassThrough(), control = createNativeParentControl({ input }); let calls = 0;
  control.subscribe({ actions: ['PUBLIC_TEST_ONLY'], async receive() { if (++calls === 1) throw first; throw Error('PUBLIC_LATER_ERROR'); } });
  input.write(Buffer.from('{"action":"PUBLIC_TEST_ONLY"}\n{"action":"PUBLIC_TEST_ONLY"}\n'));
  const result = await control.finishCleanup();
  assert.equal(result.complete, false); assert.equal(result.firstFailure, first); assert.equal(result.firstFailurePresent, true);
  assert.equal(control.status().firstFailurePresent, true); input.destroy();
});
