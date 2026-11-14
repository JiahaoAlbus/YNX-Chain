import { open, lstat, readdir, statfs, realpath, readFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const GiB = 1024 ** 3, MiB = 1024 ** 2;
const fail = (code, message) => Object.assign(Error(message), { code });
// Darwin sys/fcntl.h O_EXLOCK. Node accepts native numeric open flags even
// though fs.constants does not expose this BSD-only flag. The kernel holds the
// exclusive flock on this exact descriptor and releases it on close or crash.
// Never emulate it with PID files, expiry, stale-lock deletion or chmod.
const O_EXLOCK = 0x00000020;
async function acquire(root, timeoutMs) {
  if (process.platform !== 'darwin') throw Error('The shared QA cache lock requires Darwin native open locking.');
  const deadline = Date.now() + timeoutMs, path = join(root, '.runtime-cache.lock');
  for (;;) {
    let fd;
    try {
      fd = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | O_EXLOCK, 0o600);
      const s = await fd.stat();
      if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600 || s.nlink !== 1)
        throw fail('YNX_RUNTIME_CACHE_LOCK_UNSAFE', 'Runtime cache lock is not an owned private regular file.');
      return fd;
    } catch (error) {
      if (fd) await fd.close();
      if (!['EAGAIN', 'EWOULDBLOCK'].includes(error.code)) throw error;
      if (Date.now() >= deadline) throw fail('YNX_RUNTIME_CACHE_BUSY', 'Another YNX launch is preparing the shared runtime cache. Retry after that launch finishes.');
      await delay(25); // Contention backoff; only a successful OS open grants entry.
    }
  }
}

async function allocatedBytes(root) {
  let total = 0, entries = 0;
  const pending = [root], deadline = Date.now() + 15000;
  while (pending.length) {
    if (++entries > 100000 || Date.now() > deadline) throw fail('YNX_RUNTIME_CACHE_INVENTORY_LIMIT', 'Runtime cache inventory exceeded its bounded inspection limit.');
    const p = pending.pop(), s = await lstat(p);
    if (s.isSymbolicLink() || ![0, process.getuid()].includes(s.uid) || (s.mode & 0o022) || !(s.isDirectory() || s.isFile()))
      throw fail('YNX_RUNTIME_CACHE_UNSAFE', 'Runtime cache contains unsafe ownership, permissions or links; no entry was removed.');
    total += Math.max(s.size, s.blocks * 512);
    if (s.isFile() && /^\.runtime-cache-reservation-[a-f0-9-]{36}\.json$/.test(basename(p))) {
      if (s.size > 4096 || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600) throw Error('Invalid preserved runtime cache reservation.');
      const record = JSON.parse(await readFile(p, 'utf8'));
      if (record.schema !== 'YNX_RUNTIME_CACHE_RESERVATION/v1' || !Number.isSafeInteger(record.bytes) || record.bytes <= 0) throw Error('Invalid preserved runtime cache reservation.');
      // A killed parent may leave a tar child still writing. Retain its full
      // admitted upper bound as well as the partial bytes; never assume that
      // releasing the parent's OS lock proves its descendants have drained.
      total += record.bytes;
    }
    if (!Number.isSafeInteger(total)) throw Error('Runtime cache allocation exceeds its numeric range.');
    if (s.isDirectory()) for (const n of await readdir(p)) pending.push(join(p, n));
  }
  return total;
}

export async function withRuntimeCacheBudget(root, task, { limitBytes = 2 * GiB, timeoutMs = 30000 } = {}) {
  const s = await lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o700 || await realpath(root) !== root)
    throw fail('YNX_RUNTIME_CACHE_UNSAFE', 'Runtime cache budget requires an existing owner-private directory.');
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) throw Error('Invalid runtime cache budget.');
  const lease = await acquire(root, timeoutMs);
  const reservations = [];
  let value, failure;
  try {
    value = await task(async (bytes, members = 1) => {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(members) || members < 0) throw Error('Invalid new runtime allocation estimate.');
      const space = await statfs(root), block = space.bsize;
      if (!Number.isSafeInteger(block) || block <= 0 || block > 65536) throw Error('Unsupported runtime cache allocation block size.');
      const reserve = bytes + members * block + 64 * MiB, existing = await allocatedBytes(root);
      if (!Number.isSafeInteger(reserve)) throw Error('Runtime allocation estimate exceeds its numeric range.');
      if (existing + reserve > limitBytes) throw fail('YNX_RUNTIME_CACHE_LIMIT', 'The shared QA runtime cache reached its 2 GiB limit. Existing projects and runtime versions were preserved.');
      if (space.bavail * block < reserve + 2 * GiB) throw fail('YNX_RUNTIME_CACHE_SPACE', 'Insufficient space for this runtime and the 2 GiB free-space reserve.');
      const path = join(root, '.runtime-cache-reservation-' + randomUUID() + '.json');
      const fd = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        await fd.writeFile(JSON.stringify({ schema: 'YNX_RUNTIME_CACHE_RESERVATION/v1', bytes: reserve }));
        await fd.sync();
        reservations.push({ path, stat: await fd.stat() });
      } finally { await fd.close(); }
      return { existing, reserve, limitBytes };
    });
  } catch (error) { failure = error; }
  const cleanupErrors = [];
  // Only this completed callback's own reservations are retired. Crashed
  // launches and failed extraction directories remain for owner recovery.
  for (const { path, stat } of reservations) {
    try {
        const current = await lstat(path);
        if (current.dev !== stat.dev || current.ino !== stat.ino) throw Error('Runtime cache reservation identity changed.');
        await unlink(path);
    } catch (error) { cleanupErrors.push(error); }
  }
  try { await lease.close(); } catch (error) { cleanupErrors.push(error); }
  if (failure && !cleanupErrors.length) throw failure;
  if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Runtime cache preparation or cleanup failed.', { cause: failure || cleanupErrors[0] });
  return value;
}
