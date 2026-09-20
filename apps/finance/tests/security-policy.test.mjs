import assert from 'node:assert/strict';
import test from 'node:test';

import { isNonRuntimeSentinelUse } from '../scripts/security-policy.mjs';

test('security policy ignores only the two reviewed pinned-bundle comments', () => {
  const pinned = 'apps/finance/web/vendor/product-session-browser-a7dad7ec.mjs';
  const first = "// TODO: we don't need it here, move out to separate fn";
  const second = '// TODO: return `this`';
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', pinned, first, 'TODO', first.indexOf('TODO')), true);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', pinned, second, 'TODO', second.indexOf('TODO')), true);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', pinned, '// TODO: connect fake button', 'TODO', 3), false);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', pinned, 'const state = "TODO";', 'TODO', 15), false);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', pinned, '<span>Placeholder</span>', 'Placeholder', 6), false);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', 'apps/finance/web/vendor/other.mjs', first, 'TODO', first.indexOf('TODO')), false);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', 'apps/finance/web/app.js', '// TODO: connect fake button', 'TODO', 3), false);
  assert.equal(isNonRuntimeSentinelUse('private-key', pinned, 'PRIVATE KEY', 'PRIVATE KEY', 0), false);
});
