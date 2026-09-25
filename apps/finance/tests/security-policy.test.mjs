import assert from 'node:assert/strict';
import test from 'node:test';

import { isNonRuntimeSentinelUse, runtimePlaceholderPatterns } from '../scripts/security-policy.mjs';

function runtimeMarkers(text) {
  return runtimePlaceholderPatterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

test('security gate accepts Spanish todo but rejects real developer and visible placeholders', () => {
  assert.deepEqual(runtimeMarkers('Ver todo · Gasto de todo el período'), []);
  assert.deepEqual(runtimeMarkers('// TODO: wire a fake button'), ['TODO']);
  assert.deepEqual(runtimeMarkers('// FIXME: finish this route'), ['FIXME']);
  assert.deepEqual(runtimeMarkers('Coming soon'), ['Coming soon']);
  assert.deepEqual(runtimeMarkers('coming soon'), ['coming soon']);
  assert.deepEqual(runtimeMarkers('<span>Placeholder</span>'), ['>Placeholder<']);
});

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
