import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile, symlink, chmod, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { withRuntimeCacheBudget } from './runtime-cache-budget.mjs';
const native = process.platform === 'darwin';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-cache-budget-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function holder(t, root, reserve = false) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const source = `import {withRuntimeCacheBudget} from ${JSON.stringify(new URL('./runtime-cache-budget.mjs', import.meta.url).href)};
    await withRuntimeCacheBudget(${JSON.stringify(root)},async admit=>{${reserve ? 'await admit(1);' : ''}process.send('held');await new Promise(r=>process.once('message',r));});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { assert.deepEqual(await Promise.race([once(child, 'message'), closed.then(x => { throw Error('Cache holder exited before admission: ' + x); })]), ['held', undefined]); }
  finally { clearTimeout(timer); }
  return { child, closed };
}

test('cache budget serializes real processes, and process death releases the kernel lock without deleting a lease', { skip: !native }, async t => {
  const root = await fixture(t), h = await holder(t, root);
  let entered = false;
  await assert.rejects(withRuntimeCacheBudget(root, async () => { entered = true; }, { timeoutMs: 0 }), { code: 'YNX_RUNTIME_CACHE_BUSY' });
  assert.equal(entered, false);
  h.child.kill('SIGKILL'); await h.closed;
  assert.equal(await withRuntimeCacheBudget(root, async () => 'recovered'), 'recovered');
  assert.equal((await lstat(join(root, '.runtime-cache.lock'))).nlink, 1);
});

test('the JavaScript lock actually interoperates with the existing native flock helper', { skip: !native }, async t => {
  const root = await fixture(t), helper = join(root, 'native-helper');
  // Compile the existing native algorithm with only its lock filename changed
  // so both real APIs contend on exactly the same canonical inode.
  const c = await readFile(new URL('./macos/local-workbench-lock.c', import.meta.url), 'utf8');
  const fixtureSource = join(root, 'budget-lock.c');
  await writeFile(fixtureSource, c.replace('"local-workbench.lock"', '".runtime-cache.lock"'));
  execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '-Wall', '-Wextra', '-Werror', fixtureSource, '-o', helper]);
  await withRuntimeCacheBudget(root, async () => {
    const child = spawn(helper, [root, '/bin/cat'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const [code] = await once(child, 'close'); assert.equal(code, 73);
  });
  const child = spawn(helper, [root, '/bin/cat'], { stdio: ['pipe', 'pipe', 'pipe'] }), closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  child.stdin.write('native-held\n');
  assert.equal(String((await once(child.stdout, 'data'))[0]), 'native-held\n');
  await assert.rejects(withRuntimeCacheBudget(root, async () => {}, { timeoutMs: 0 }), { code: 'YNX_RUNTIME_CACHE_BUSY' });
  child.stdin.end(); assert.equal((await closed)[0], 0);
  await withRuntimeCacheBudget(root, async () => {});
});

test('a crashed launch retains its allocation bound for possible still-writing descendants, without blocking existing cache reuse', { skip: !native }, async t => {
  const root = await fixture(t), h = await holder(t, root, true);
  h.child.kill('SIGKILL'); await h.closed;
  assert.equal(await withRuntimeCacheBudget(root, async () => 'existing runtime can be checked'), 'existing runtime can be checked');
  await assert.rejects(withRuntimeCacheBudget(root, async admit => admit(1), { limitBytes: 96 * 1024 ** 2 }), { code: 'YNX_RUNTIME_CACHE_LIMIT' });
  const { readdir } = await import('node:fs/promises');
  assert.equal((await readdir(root)).filter(n => n.startsWith('.runtime-cache-reservation-')).length, 1);
});

test('a real orphan writer stays covered by its durable reservation after the owner dies', { skip: !native }, async t => {
  const root = await fixture(t), output = join(root, 'orphan-output');
  const writer = `setTimeout(()=>{require('fs').writeFileSync(${JSON.stringify(output)},Buffer.alloc(1024*1024));},1000);`;
  const source = `import {spawn} from 'node:child_process';
    import {withRuntimeCacheBudget} from ${JSON.stringify(new URL('./runtime-cache-budget.mjs', import.meta.url).href)};
    await withRuntimeCacheBudget(${JSON.stringify(root)},async admit=>{await admit(1024*1024);
      const writer=spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:['ignore',1,2]});
      process.send({writerPID:writer.pid});await new Promise(()=>{});});`;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'), closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  const [{ writerPID }] = await once(child, 'message');
  child.kill('SIGKILL'); assert.equal((await exited)[1], 'SIGKILL');
  process.kill(writerPID, 0); // Observed actual owned descendant still exists.
  await withRuntimeCacheBudget(root, async () => {}); // The kernel lock is free.
  await assert.rejects(withRuntimeCacheBudget(root, async admit => admit(1), { limitBytes: 96 * 1024 ** 2 }), { code: 'YNX_RUNTIME_CACHE_LIMIT' });
  await closed; // Inherited output pipes close only after the orphan exits too.
  assert.equal((await lstat(output)).size, 1024 * 1024);
});

test('quota refusal preserves existing bytes and releases the lock for retry', { skip: !native }, async t => {
  const root = await fixture(t); await writeFile(join(root, 'old-evidence'), 'preserved');
  await assert.rejects(withRuntimeCacheBudget(root, async admit => { await admit(1); throw Error('allocation should not be admitted'); }, { limitBytes: 64 * 1024 ** 2 }), { code: 'YNX_RUNTIME_CACHE_LIMIT' });
  assert.equal(await readFile(join(root, 'old-evidence'), 'utf8'), 'preserved');
  await withRuntimeCacheBudget(root, async admit => { const result = await admit(1); assert.ok(result.existing > 0); });
  await assert.rejects(withRuntimeCacheBudget(root, async () => { throw Error('original task failure'); }), /original task failure/);
  assert.equal(await withRuntimeCacheBudget(root, async () => 'retry'), 'retry');
});

test('unsafe lock files and cache links fail closed without changing permissions or targets', { skip: !native }, async t => {
  const root = await fixture(t), path = join(root, '.runtime-cache.lock'), target = join(root, 'target');
  await writeFile(target, 'do not touch'); await symlink(target, path);
  await assert.rejects(withRuntimeCacheBudget(root, async () => {}), { code: 'ELOOP' });
  assert.equal(await readFile(target, 'utf8'), 'do not touch');
  const { unlink } = await import('node:fs/promises'); await unlink(path);
  await writeFile(path, '', { mode: 0o600 }); await chmod(path, 0o660);
  await assert.rejects(withRuntimeCacheBudget(root, async () => {}), { code: 'YNX_RUNTIME_CACHE_LOCK_UNSAFE' });
  assert.equal((await lstat(path)).mode & 0o777, 0o660);
});

test('cleanup failure preserves the original task error and does not remove a replacement reservation', { skip: !native }, async t => {
  const root = await fixture(t), original = Error('PUBLIC_ORIGINAL_CACHE_FAILURE');
  const { readdir, rename } = await import('node:fs/promises');
  let path;
  await assert.rejects(withRuntimeCacheBudget(root, async admit => {
    await admit(1);
    const name = (await readdir(root)).find(n => n.startsWith('.runtime-cache-reservation-'));
    path = join(root, name); await rename(path, path + '.preserved');
    await writeFile(path, 'replacement evidence', { mode: 0o600 });
    throw original;
  }), error => error instanceof AggregateError && error.cause === original && error.errors[0] === original);
  assert.equal(await readFile(path, 'utf8'), 'replacement evidence');
  await withRuntimeCacheBudget(root, async () => {});
});
