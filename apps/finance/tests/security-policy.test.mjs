import assert from 'node:assert/strict';
import test from 'node:test';

import { isNonRuntimeSentinelUse } from '../scripts/security-policy.mjs';

test('security policy ignores only vendored runtime comments', () => {
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', 'apps/finance/web/vendor/pinned.mjs', '// TODO: upstream optimization', 'TODO', 3), true);
  assert.equal(isNonRuntimeSentinelUse('runtime-placeholder', 'apps/finance/web/app.js', '// TODO: connect fake button', 'TODO', 3), false);
  assert.equal(isNonRuntimeSentinelUse('private-key', 'apps/finance/web/vendor/pinned.mjs', 'PRIVATE KEY', 'PRIVATE KEY', 0), false);
});

test('security policy distinguishes a manifest deny-list from a deployable filler endpoint', () => {
  const reservedHost = ['example', '.com'].join('');
  const rejected = `{"reject":["localhost","${reservedHost}"]}`;
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/mobile/contract/public-endpoint-manifest.json', rejected, reservedHost, rejected.indexOf(reservedHost)), true);

  const deployed = `{"endpoint":"https://${reservedHost}"}`;
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/mobile/contract/public-endpoint-manifest.json', deployed, reservedHost, deployed.indexOf(reservedHost)), false);
  assert.equal(isNonRuntimeSentinelUse('deployment-filler', 'apps/finance/.env.example', `API=https://${reservedHost}`, reservedHost, 12), false);
});
