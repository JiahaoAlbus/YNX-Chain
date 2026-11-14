import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile, readFile, lstat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeCacheSupportRoot } from './bundled-execution-runtime.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-cache-support-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home'), parent = join(home, 'Library/Application Support');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const qa = join(parent, 'YNXDeveloper-QA');
  const profile = n => join(qa, 'a'.repeat(40) + `-00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
  return { root, home, parent, qa, profile };
}

test('candidate profiles reuse one private runtime store while retaining isolated state and old caches', async t => {
  const f = await fixture(t), a = f.profile(1), b = f.profile(2);
  await mkdir(join(a, 'workbench-runtimes'), { recursive: true, mode: 0o700 });
  await writeFile(join(a, 'settings.json'), 'candidate A');
  await writeFile(join(a, 'workbench-runtimes', 'old-evidence'), 'preserved');
  const shared = await runtimeCacheSupportRoot(a, f);
  assert.equal(await runtimeCacheSupportRoot(b, f), shared);
  assert.equal(shared, join(f.parent, 'YNXDeveloper-RuntimeCache'));
  assert.equal((await lstat(shared)).mode & 0o777, 0o700);
  await mkdir(join(shared, 'workbench-runtimes', 'content-hash'), { recursive: true, mode: 0o700 });
  await writeFile(join(shared, 'workbench-runtimes', 'content-hash', 'sealed'), 'one copy');
  assert.equal(await readFile(join(await runtimeCacheSupportRoot(b, f), 'workbench-runtimes', 'content-hash', 'sealed'), 'utf8'), 'one copy');
  assert.equal(await readFile(join(a, 'settings.json'), 'utf8'), 'candidate A');
  assert.equal(await readFile(join(a, 'workbench-runtimes', 'old-evidence'), 'utf8'), 'preserved');
  assert.equal((await lstat(b)).mode & 0o777, 0o700);
});

test('custom, normal and malformed QA profiles retain their own cache without creating shared state', async t => {
  const f = await fixture(t);
  for (const p of [join(f.parent, 'YNXDeveloper'), join(f.root, 'custom'), join(f.qa, 'not-a-sealed-id'), join(f.profile(1), 'nested')])
    assert.equal(await runtimeCacheSupportRoot(p, f), p);
  await assert.rejects(lstat(join(f.parent, 'YNXDeveloper-RuntimeCache')), { code: 'ENOENT' });
});

test('a symlink cache is refused without writing its target', async t => {
  const f = await fixture(t), target = join(f.root, 'external');
  await mkdir(target, { mode: 0o700 });
  await symlink(target, join(f.parent, 'YNXDeveloper-RuntimeCache'));
  await assert.rejects(runtimeCacheSupportRoot(f.profile(1), f), /private and canonical/);
  await assert.rejects(lstat(join(target, 'workbench-runtimes')), { code: 'ENOENT' });
});

test('writable shared roots and writable ancestors fail closed without repairing permissions', async t => {
  const f = await fixture(t), shared = join(f.parent, 'YNXDeveloper-RuntimeCache');
  await mkdir(shared, { mode: 0o700 }); await chmod(shared, 0o770);
  await assert.rejects(runtimeCacheSupportRoot(f.profile(1), f), /private and canonical/);
  assert.equal((await lstat(shared)).mode & 0o777, 0o770);
  await chmod(shared, 0o700); await chmod(f.parent, 0o770);
  await assert.rejects(runtimeCacheSupportRoot(f.profile(1), f), /unsafe ancestor/);
  assert.equal((await lstat(f.parent)).mode & 0o777, 0o770);
});
