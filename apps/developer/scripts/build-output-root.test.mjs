import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, symlink, readFile, rm, writeFile, lstat, realpath, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildOutputRoot, claimBuildOutput, assertBuildOutputDirectory, verifyBuildOutputIdentity } from './build-output-root.mjs';
const developer = dirname(dirname(fileURLToPath(import.meta.url)));
async function fixture(run) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'ynx-output-admission-')));
  try { await run(parent); } finally { await rm(parent, { recursive: true }); }
}
test('default retains canonical owned candidate root without a new 0700 requirement', async () => {
  const result = await buildOutputRoot({});
  assert.equal(result.root, join(developer, '.ynx-developer-candidates'));
  assert.equal(result.external, false);
});
test('fresh private output records real filesystem and Git source identity', () => fixture(async parent => {
  const root = join(parent, 'outputs'), env = { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: root };
  const identity = await buildOutputRoot(env);
  assert.equal(identity.mode, 0o700);
  const output = join(root, 'fresh-core');
  await claimBuildOutput(output, env);
  const receipt = JSON.parse(await readFile(output + '.build-output.json'));
  assert.equal(receipt.identity.device, (await lstat(root)).dev);
  assert.equal(receipt.source.commit.length, 40);
  assert.equal(receipt.source.tree.length, 40);
  const expectedDirty = !!execFileSync('/usr/bin/git', ['-C', receipt.source.repository, 'status', '--porcelain', '--untracked-files=no', '--', 'apps/developer', 'packages/developer-client'], { encoding: 'utf8' }).trim();
  assert.equal(receipt.source.trackedDirty, expectedDirty);
  assert.equal((await lstat(output + '.build-output.json')).mode & 0o777, 0o600);
  await mkdir(join(output, 'plugins'));
  await assertBuildOutputDirectory(join(output, 'plugins'), env);
  await assert.rejects(claimBuildOutput(output, env));
}));
test('reject public/group-writable roots and unowned parents', () => fixture(async parent => {
  const root = join(parent, 'outputs'); await mkdir(root, { mode: 0o755 });
  const env = { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: root };
  await assert.rejects(buildOutputRoot(env));
  await chmod(root, 0o770); await assert.rejects(buildOutputRoot(env));
  await assert.rejects(buildOutputRoot({ YNX_DEVELOPER_BUILD_OUTPUT_ROOT: '/ynx-not-created-output-test' }));
}));
test('reject root/ancestor/nested symlinks and traversal', () => fixture(async parent => {
  const real = join(parent, 'real'); await mkdir(real, { mode: 0o700 });
  const link = join(parent, 'link'); await symlink(real, link);
  await assert.rejects(buildOutputRoot({ YNX_DEVELOPER_BUILD_OUTPUT_ROOT: link }));
  await assert.rejects(buildOutputRoot({ YNX_DEVELOPER_BUILD_OUTPUT_ROOT: join(link, 'child') }));
  const env = { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: real };
  await assert.rejects(claimBuildOutput(real + '/../escape', env));
  await assert.rejects(claimBuildOutput(join(parent, 'escape'), env));
  await symlink(parent, join(real, 'nested'));
  await assert.rejects(assertBuildOutputDirectory(join(real, 'nested'), env));
}));
test('receipt collision refuses without creating output', () => fixture(async parent => {
  const root = join(parent, 'outputs'), env = { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: root };
  await buildOutputRoot(env);
  const output = join(root, 'collision'); await writeFile(output + '.build-output.json', 'preserved');
  await assert.rejects(claimBuildOutput(output, env));
  await assert.rejects(lstat(output), { code: 'ENOENT' });
  assert.equal(await readFile(output + '.build-output.json', 'utf8'), 'preserved');
}));
test('root inode replacement and mode changes refuse the original claim', () => fixture(async parent => {
  const root = join(parent, 'outputs'), env = { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: root };
  const identity = await buildOutputRoot(env);
  await rename(root, root + '-preserved'); await mkdir(root, { mode: 0o700 });
  await assert.rejects(verifyBuildOutputIdentity(identity, env));
  await chmod(root, 0o755); await assert.rejects(verifyBuildOutputIdentity(identity, env));
}));
test('actual external volume root is canonical/private and separate from source volume', async () => {
  const external = '/Volumes/Data/Users/huangjiahao/.ynx-ide-build-artifacts-v2-20261005';
  const identity = await buildOutputRoot({ YNX_DEVELOPER_BUILD_OUTPUT_ROOT: external });
  assert.equal(identity.mode, 0o700);
  assert.notEqual(identity.device, (await lstat(developer)).dev);
  const output = join(external, 'admission-test-' + randomUUID());
  try {
    await claimBuildOutput(output, { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: external });
    assert.equal((await lstat(output)).dev, identity.device);
    await assertBuildOutputDirectory(output, { YNX_DEVELOPER_BUILD_OUTPUT_ROOT: external });
  } finally {
    await rm(output, { recursive: true, force: true });
    await rm(output + '.build-output.json', { force: true });
  }
});
test('input pin and compiler/RPC trust paths remain retained; only outputs use shared admission', async () => {
  const core = await readFile(join(developer, 'runtime/theia/scripts/package-runtime.mjs'), 'utf8');
  assert.match(core, /plugins\.startsWith\(candidateRoot\)/);
  assert.match(core, /cpp\.startsWith\(candidateRoot\)/);
  const formatter = await readFile(join(developer, 'scripts/bundle-solidity-format-runtime.mjs'), 'utf8');
  assert.match(formatter, /rpcRoot\.startsWith\(join\(developer,'.ynx-developer-candidates'\)/);
  const native = await readFile(join(developer, 'scripts/package-local-macos.sh'), 'utf8');
  assert.match(native, /root!==input\|\|!root\.startsWith\(candidates\+'\/'\)/);
  assert.match(native, /scripts\/build-output-root\.mjs claim/);
});
