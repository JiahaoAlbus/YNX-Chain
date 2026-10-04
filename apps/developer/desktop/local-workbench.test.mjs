import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { localProjectContext, prepareLocalRuntime } from './local-workbench.mjs';
import { composedTreeDigest } from '../services/codeoss-service/src/composed-runtime.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(task) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-local-workbench-test-')));
  try { await task(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function payload(root, unsafe = false) {
  const source = join(root, 'source'), out = join(root, 'payload'); await mkdir(source); await mkdir(out);
  await writeFile(join(source, 'package-lock.json'), '{}');
  if (unsafe) await symlink('/etc/passwd', join(source, 'escape'));
  const pin = { kind: 'ynx-theia', version: '1.76.0', architecture: `darwin-${process.arch}`, lockSha256: digest('{}'), treeSha256: unsafe ? 'a'.repeat(64) : await composedTreeDigest(source) };
  const manifest = { ...pin, entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html', nodeVersion: '26.0.0' };
  const bytes = JSON.stringify(manifest); await writeFile(join(source, 'YNX-COMPOSED-RUNTIME.json'), bytes); pin.manifestSha256 = digest(bytes);
  execFileSync('/usr/bin/tar', ['-cf', join(out, 'workbench.tar'), '-C', source, '.'], { env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' } });
  await writeFile(join(out, 'workbench.pin.json'), JSON.stringify(pin));
  await writeFile(join(out, 'distribution.json'), JSON.stringify({ schemaVersion: 1, archive: 'workbench.tar', archiveSha256: digest(await readFile(join(out, 'workbench.tar'))), runtimeArtifact: pin, roundTripTreeVerified: true, localWorkspace: { enabled: true, identity: 'OS-user local project only', canonicalAdmission: false } }));
  return out;
}
test('real sealed tar extracts, verifies immutable cache and rejects later cache corruption', async () => fixture(async root => {
  const input = { payload: await payload(root), supportRoot: join(root, 'support') };
  const first = await prepareLocalRuntime(input), second = await prepareLocalRuntime(input); assert.equal(first.root, second.root);
  await writeFile(join(first.root, 'unexpected'), 'changed'); await assert.rejects(prepareLocalRuntime(input), /reviewed artifact/);
  const metadata = join(input.payload, 'distribution.json'), original = JSON.parse(await readFile(metadata));
  for (const localWorkspace of [undefined, { ...original.localWorkspace, canonicalAdmission: true }, { ...original.localWorkspace, enabled: false }]) {
    await writeFile(metadata, JSON.stringify({ ...original, localWorkspace }));
    await assert.rejects(prepareLocalRuntime(input), /distribution is invalid/);
  }
}));
test('archive digest mismatch and archive symlinks refuse execution inputs', async () => fixture(async root => {
  const out = await payload(root, true); await assert.rejects(prepareLocalRuntime({ payload: out, supportRoot: join(root, 'support') }), /unsupported paths/);
  await writeFile(join(out, 'workbench.tar'), 'tampered'); await assert.rejects(prepareLocalRuntime({ payload: out, supportRoot: join(root, 'support') }), /archive changed/);
}));
test('actual local project binding persists without Wallet identity and refuses conflicting profile', async () => fixture(async root => {
  const supportRoot = join(root, 'support'), projectDirectory = join(root, 'project'); await mkdir(projectDirectory);
  const first = await localProjectContext({ supportRoot, projectDirectory }), next = await localProjectContext({ supportRoot, projectDirectory }); assert.deepEqual(next, first);
  const path = join(first.profile, 'ynx-local-project.json');
  assert.deepEqual(JSON.parse(await readFile(path)), { schemaVersion: 1, projectId: first.id, workspace: projectDirectory, profile: first.profile });
  await writeFile(path, JSON.stringify({ schemaVersion: 1, projectId: first.id, workspace: '/another', profile: first.profile }));
  await assert.rejects(localProjectContext({ supportRoot, projectDirectory }), /another workspace/);
}));
test('symlinked project and nonprivate support state are refused', async () => fixture(async root => {
  const project = join(root, 'project'); await mkdir(project); await symlink(project, join(root, 'alias'));
  await assert.rejects(localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: join(root, 'alias') }), /canonical/);
  const exposed = join(root, 'exposed'); await mkdir(exposed, { mode: 0o755 });
  await assert.rejects(localProjectContext({ supportRoot: exposed, projectDirectory: project }), /private/);
}));
test('real native fd lock excludes a second backend and releases after backend exit', async () => fixture(async root => {
  const helper = join(root, 'local-lock'), profile = join(root, 'profile'), node = await realpath(process.execPath);
  await mkdir(profile, { mode: 0o700 });
  execFileSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./macos/local-workbench-lock.c', import.meta.url)), '-o', helper]);
  const first = spawn(helper, [profile, node, '-e', 'console.log("locked");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(first, 'close');
  try {
    const [ready] = await once(first.stdout, 'data'); assert.match(String(ready), /locked/);
    const refused = spawnSync(helper, [profile, node, '-e', 'console.log("unexpected")'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(refused.status, 73); assert.equal(refused.stdout, ''); assert.match(refused.stderr, /already open/);
    first.kill('SIGKILL'); await closed;
    const reopened = spawnSync(helper, [profile, node, '-e', 'console.log("reopened")'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(reopened.status, 0, reopened.stderr); assert.match(reopened.stdout, /reopened/);
    const secondProfile = join(root, 'other-profile'); await mkdir(secondProfile, { mode: 0o700 });
    await symlink(join(profile, 'local-workbench.lock'), join(secondProfile, 'local-workbench.lock'));
    assert.equal(spawnSync(helper, [secondProfile, node, '-e', 'process.exit(0)']).status, 65);
  } finally { if (first.exitCode === null && first.signalCode === null) { first.kill('SIGKILL'); await closed; } }
}));
