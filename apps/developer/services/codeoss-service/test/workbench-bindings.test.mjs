import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composedWorkbenchBindings } from '../src/workbench-bindings.mjs';
const pin = { kind: 'ynx-theia', version: '1.76.0', architecture: 'darwin-arm64', lockSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) };
function context(sessionId = '12345678-1234-4321-8765-0123456789ab', projectDirectory = '/protected/projects/owner/project') {
  const value = { sessionId, runtimeId: 'abcdef01-1234-4321-8765-0123456789ab', owner: 'd'.repeat(64), projectId: 'project', directory: `/protected/sessions/${sessionId}`, projectDirectory, image: pin };
  value.identityDigest = createHash('sha256').update(`${value.owner}\n${value.projectId}\n${value.runtimeId}\n${value.sessionId}`).digest('hex');
  return value;
}
const options = { artifactRoot: '/protected/artifacts/reviewed', runtimeArtifact: pin };
test('reopening the same admitted project preserves profile path but binds Tools to the new durable session', () => {
  const first = composedWorkbenchBindings(context(), options);
  const next = composedWorkbenchBindings(context('99999999-1234-4321-8765-0123456789ab'), options);
  assert.equal(first.profileDirectory, next.profileDirectory);
  assert.equal(first.profileDirectory, '/protected/projects/owner/project/profile');
  assert.notEqual(first.environment.YNX_CORE_SESSION_ID, next.environment.YNX_CORE_SESSION_ID);
  assert.equal(next.environment.YNX_CORE_WORKSPACE, '/protected/projects/owner/project/workspace');
  assert.equal(Object.keys(first.environment).sort().join(','), 'THEIA_APP_PROJECT_PATH,THEIA_CONFIG_DIR,THEIA_DEFAULT_PLUGINS,YNX_CORE_SESSION_ID,YNX_CORE_WORKSPACE');
  assert.ok(Object.isFrozen(first.environment));
});
test('other admitted project gets a separate persistent profile', () => {
  const first = composedWorkbenchBindings(context(), options);
  const second = composedWorkbenchBindings(context(undefined, '/protected/projects/another/project'), options);
  assert.notEqual(first.profileDirectory, second.profileDirectory);
});
test('forged context, changed artifact and noncanonical protected root are rejected before generating bindings', () => {
  assert.throws(() => composedWorkbenchBindings({ ...context(), sessionId: 'not-a-session' }, options));
  assert.throws(() => composedWorkbenchBindings({ ...context(), identityDigest: 'e'.repeat(64) }, options));
  assert.throws(() => composedWorkbenchBindings({ ...context(), image: { ...pin, treeSha256: 'f'.repeat(64) } }, options));
  assert.throws(() => composedWorkbenchBindings(context(), { ...options, artifactRoot: '/protected/../workspace' }));
});
