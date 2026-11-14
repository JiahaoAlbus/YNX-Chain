import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, chmod, rm, symlink, lstat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareBundledExecutionRuntime } from './bundled-execution-runtime.mjs';
import { withRuntimeCacheBudget } from './runtime-cache-budget.mjs';
const exec = promisify(execFile), native = process.platform === 'darwin';

test('source use does not relabel arbitrary supplied paths as bundled inputs', async () => {
  assert.deepEqual(await prepareBundledExecutionRuntime({ node: '/not-a-bundle/node', lockHelper: '/not-a-bundle/lock', supportRoot: '/unused' }),
    { node: '/not-a-bundle/node', lockHelper: '/not-a-bundle/lock' });
});

test('sealed bundle below writable installation ancestry uses private verified execution inputs', { skip: !native }, async t => {
  const base = await mkdtemp('/private/tmp/ynx-private-execution-');
  t.after(() => rm(base, { recursive: true, force: true }));
  const compiler = '/Library/Developer/CommandLineTools/usr/bin/clang', helper = join(base, 'vnode-helper');
  await exec(compiler, ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./macos/workspace-path-identity.c', import.meta.url)), '-o', helper]);
  async function fixture(name) {
    const shared = join(base, name), app = join(shared, 'Own.app'), resources = join(app, 'Contents/Resources'), runtime = join(resources, 'runtime');
    const desktop = join(resources, 'code/apps/developer/desktop'), supportRoot = join(base, name + '-private');
    await mkdir(desktop, { recursive: true }); await mkdir(runtime);
    await chmod(shared, 0o775); await mkdir(join(app, 'Contents/MacOS'));
    await copyFile(helper, join(app, 'Contents/MacOS/Fixture'));
    for (const n of ['node', 'ynx-js-node', 'workspace-path-identity', 'ynx-local-workbench-lock']) await copyFile(helper, join(runtime, n));
    await writeFile(join(runtime, 'local-js-debug-launcher.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(join(runtime, 'local-js-debug-launcher.mjs'), '// original launcher\n');
    await writeFile(join(desktop, 'local-debugpy-bootstrap.py'), 'print("bootstrap")\n');
    for (const n of ['bundled-execution-runtime.mjs', 'workspace-path-identity.mjs']) await copyFile(fileURLToPath(new URL(n, import.meta.url)), join(desktop, n));
    await writeFile(join(resources, 'build-provenance.json'), JSON.stringify({ productId: 'ynx-developer-v1', sourceDirty: false, platform: `macos-${process.arch}` }));
    await writeFile(join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.ynx.execution-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    const shipped = await import(pathToFileURL(join(desktop, 'bundled-execution-runtime.mjs')));
    const paths = await import(pathToFileURL(join(desktop, 'workspace-path-identity.mjs')));
    const input = { node: join(runtime, 'node'), lockHelper: join(runtime, 'ynx-local-workbench-lock'), supportRoot };
    return { app, runtime, desktop, shared, shipped, paths, input };
  }
  const f = await fixture('shared');
  await t.test('same real runtime fails project admission, then stages and reuses exact private bytes', async () => {
    await assert.rejects(f.paths.inspectWorkspacePathIdentity({ helper: join(f.runtime, 'workspace-path-identity'), path: f.runtime }), { code: 'YNX_PATH_UNSAFE_ANCESTOR' });
    const staged = await f.shipped.prepareBundledExecutionRuntime(f.input);
    assert.ok(staged.node.startsWith(f.input.supportRoot + '/bundled-execution/'));
    assert.equal((await lstat(dirname(dirname(staged.node)))).mode & 0o777, 0o700);
    assert.deepEqual(await readFile(staged.node), await readFile(f.input.node));
    assert.deepEqual(await readFile(staged.bootstrap), await readFile(join(f.desktop, 'local-debugpy-bootstrap.py')));
    const proof = await f.paths.inspectWorkspacePathIdentity({ helper: join(dirname(staged.node), 'workspace-path-identity'), path: dirname(staged.node) });
    await f.paths.assertWorkspacePathIdentity(proof);
    assert.deepEqual(await f.shipped.prepareBundledExecutionRuntime(f.input), staged);
    await assert.rejects(f.paths.inspectWorkspacePathIdentity({ helper: join(dirname(staged.node), 'workspace-path-identity'), path: f.runtime }), { code: 'YNX_PATH_UNSAFE_ANCESTOR' });
  });
  await t.test('distinct signed QA bundles reuse one execution inode after each package is independently checked', async () => {
    const home = join(base, 'qa-home'), parent = join(home, 'Library/Application Support');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const profile = n => join(parent, 'YNXDeveloper-QA', 'b'.repeat(40) + `-00000000-0000-0000-0000-${String(n).padStart(12, '0')}`);
    const firstRoot = await f.shipped.runtimeCacheSupportRoot(profile(1), { home });
    const first = await f.shipped.prepareBundledExecutionRuntime({ ...f.input, supportRoot: firstRoot });
    const g = await fixture('second-qa-bundle');
    const secondRoot = await g.shipped.runtimeCacheSupportRoot(profile(2), { home });
    const second = await g.shipped.prepareBundledExecutionRuntime({ ...g.input, supportRoot: secondRoot });
    assert.equal(firstRoot, secondRoot);
    assert.equal(first.node, second.node);
    assert.equal((await lstat(first.node)).ino, (await lstat(second.node)).ino);
    assert.deepEqual(await readFile(first.node), await readFile(g.input.node));
    // Sharing a verified cache must not turn it into authority for a modified
    // package with the same claimed candidate identity.
    await writeFile(join(g.runtime, 'local-js-debug-launcher.mjs'), '// package tampered after signing\n');
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime({ ...g.input, supportRoot: secondRoot }));
    assert.equal(await readFile(join(dirname(first.node), 'local-js-debug-launcher.mjs'), 'utf8'), '// original launcher\n');
  });
  await t.test('execution allocation refusal leaves no partial copy, and a budgeted retry can reuse the verified result', async () => {
    const g = await fixture('budgeted-inputs');
    await mkdir(g.input.supportRoot, { mode: 0o700 });
    const prepare = reserveAllocation => g.shipped.prepareBundledExecutionRuntime({ ...g.input, reserveAllocation });
    await assert.rejects(withRuntimeCacheBudget(g.input.supportRoot, prepare, { limitBytes: 64 * 1024 ** 2 }), { code: 'YNX_RUNTIME_CACHE_LIMIT' });
    assert.deepEqual(await readdir(join(g.input.supportRoot, 'bundled-execution')), []);
    const staged = await withRuntimeCacheBudget(g.input.supportRoot, prepare);
    assert.deepEqual(await withRuntimeCacheBudget(g.input.supportRoot, prepare, { limitBytes: 1 }), staged);
  });
  await t.test('cache content mutation rejects and is preserved, never silently repaired', async () => {
    const staged = await f.shipped.prepareBundledExecutionRuntime(f.input);
    await writeFile(join(dirname(staged.node), 'local-js-debug-launcher.mjs'), '// altered cache\n');
    await assert.rejects(f.shipped.prepareBundledExecutionRuntime(f.input), /Cached execution inputs changed/);
    assert.equal(await readFile(join(dirname(staged.node), 'local-js-debug-launcher.mjs'), 'utf8'), '// altered cache\n');
  });
  await t.test('caller cannot stage an arbitrary executable or helper', async () => {
    await assert.rejects(f.shipped.prepareBundledExecutionRuntime({ ...f.input, node: helper }), /exact runtime/);
    await assert.rejects(f.shipped.prepareBundledExecutionRuntime({ ...f.input, lockHelper: helper }), /exact runtime/);
  });
  await t.test('unsafe destination ancestors and destination symlinks remain rejected', async () => {
    const g = await fixture('unsafe-cache');
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime({ ...g.input, supportRoot: join(g.shared, 'private') }), /unsafe writable ancestor/);
    const target = join(base, 'real-private'); await mkdir(target, { mode: 0o700 });
    await symlink(target, g.input.supportRoot);
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime(g.input), /private and canonical/);
    assert.deepEqual(await readdir(target), []);
  });
  await t.test('invalid package signature rejects before a cache is created', async () => {
    const g = await fixture('invalid-signature');
    await writeFile(join(g.runtime, 'local-js-debug-launcher.mjs'), '// changed after signing\n');
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime(g.input));
    await assert.rejects(lstat(g.input.supportRoot), { code: 'ENOENT' });
  });
  await t.test('signed symlink inputs and writable runtime descendants reject', async () => {
    const g = await fixture('unsafe-input');
    await chmod(g.runtime, 0o775);
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime(g.input), /unsafe ownership or mode/);
    await chmod(g.runtime, 0o755);
    await rm(join(g.runtime, 'local-js-debug-launcher.mjs'));
    await symlink('node', join(g.runtime, 'local-js-debug-launcher.mjs'));
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', g.app]);
    await assert.rejects(g.shipped.prepareBundledExecutionRuntime(g.input), /unsafe ownership or mode/);
  });
});
