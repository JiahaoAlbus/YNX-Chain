import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireMatrixPurpose, runPlatformMatrix } from '../platform-matrix-runner.mjs';

test('protected purpose and caller readiness DATA reject before any candidate/output effect', async () => {
  const own = await mkdtemp(join(tmpdir(), 'p05-matrix-purpose-'));
  try {
    const output = join(own, 'must-not-exist');
    for (const claimed of [{}, { protectionInstalled: true, ready: true, team: 'PUBLIC00001' },
      { approvalReference: 'caller-says-approved', qualification: { ready: true } }]) {
      await assert.rejects(runPlatformMatrix({ ...claimed, purpose: 'protected-acceptance',
        candidatePath: join(own, 'unreadable-missing-candidate'), outputDirectory: output }),
      /PROTECTED_MATRIX_REQUIRES_INSTALLED_NATIVE_CANARY_AUTHORITY/);
    }
    await assert.rejects(access(output), { code: 'ENOENT' });
  } finally { await rm(own, { recursive: true }); }
});

test('missing purpose and arbitrary public approval cannot provision resources', async () => {
  for (const options of [{}, { approvalReference: 'arbitrary-string' },
    { purpose: 'native-loopback-capability', approvalReference: 'old-reference' },
    { purpose: 'native-loopback-capability', publicOnly: true }]) {
    await assert.rejects(runPlatformMatrix({ ...options, candidatePath: '/nonexistent-p05-public-candidate' }),
      /EXPLICIT_MATRIX_PURPOSE_REQUIRED|PUBLIC_MATRIX_REQUIRES_SEPARATELY_REVIEWED_RESOURCE_SCOPE/);
  }
});

test('explicit direct/local loopback diagnostics remain available without becoming protection', async () => {
  for (const localRoutedOnly of [false, true]) {
    const plan = requireMatrixPurpose({ purpose: 'native-loopback-capability', localRoutedOnly });
    assert.equal(plan.publicResourceProvisioning, false);
    assert.equal(plan.protectionInstalled, 'NOT_ESTABLISHED');
    assert.equal(plan.productionRouteAdmission, false);
    assert.equal(Object.isFrozen(plan), true);
    // The actual runner reaches its ordinary candidate validation only in this
    // explicit local purpose. No candidate, listener or native process is made.
    await assert.rejects(runPlatformMatrix({ purpose: plan.purpose, localRoutedOnly,
      candidatePath: '/nonexistent-p05-local-candidate' }), { code: 'ENOENT' });
  }
});

test('scope types and purpose aliases are closed', () => {
  for (const localRoutedOnly of ['false', 1, null]) {
    assert.throws(() => requireMatrixPurpose({ purpose: 'native-loopback-capability', localRoutedOnly }), /MATRIX_SCOPE_TYPE_REJECTED/);
  }
  for (const purpose of ['native-loopback-capability ', 'Native-loopback-capability', 'public-only', true]) {
    assert.throws(() => requireMatrixPurpose({ purpose }), /EXPLICIT_MATRIX_PURPOSE_REQUIRED/);
  }
});

test('actual CLI rejects protected mode before paths or public provisioning', () => {
  const runner = fileURLToPath(new URL('../platform-matrix-runner.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [runner, '--purpose', 'protected-acceptance',
    '--candidate', '/nonexistent-p05-cli-candidate', '--approval-reference', 'not-permission'],
  { encoding: 'utf8', timeout: 5000, maxBuffer: 32768 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /PROTECTED_MATRIX_REQUIRES_INSTALLED_NATIVE_CANARY_AUTHORITY/);
  assert.doesNotMatch(child.stderr, /ENOENT/);
  assert.equal(child.stdout, '');
});
