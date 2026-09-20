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

test('security policy distinguishes a manifest deny-list from a deployable filler endpoint', () => {
  const reservedHost = ['example', '.com'].join('');
  const rejected = `{"reject":["localhost","${reservedHost}"]}`;
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/mobile/contract/public-endpoint-manifest.json', rejected, reservedHost, rejected.indexOf(reservedHost)), true);

  const deployed = `{"endpoint":"https://${reservedHost}"}`;
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/mobile/contract/public-endpoint-manifest.json', deployed, reservedHost, deployed.indexOf(reservedHost)), false);
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/.env.example', `API=https://${reservedHost}`, reservedHost, 12), false);
});
