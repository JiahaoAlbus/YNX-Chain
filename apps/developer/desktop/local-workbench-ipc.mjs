import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, lstat, realpath, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const NAME = /^[a-f0-9]{8}-[A-Za-z0-9]{6}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const exec = promisify(execFile);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const absent = async path => { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 2) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function inUse(path) {
  const executable = '/usr/sbin/lsof', stat = await lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) || await realpath(executable) !== executable) throw Error('Local IPC usage could not be verified.');
  try {
    const result = await exec(executable, ['-nP', '-t', '-a', '-u', String(process.getuid()), '+D', path], { timeout: 5000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin:/usr/sbin' } });
    if (result.stderr.trim()) throw Error('Local IPC usage query was incomplete.');
    return result.stdout.trim().length > 0;
  } catch (error) {
    // lsof's documented no-match exit is 1. Any diagnostic or timeout retains.
    if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return false;
    throw error;
  }
}
export const localIpcRoot = () => `/private/tmp/yi-${process.getuid()}`;
async function directory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || await realpath(path) !== path)
    throw Error('Local IPC directory ownership, permissions or canonical path changed.');
  return stat;
}
async function rootDirectory(root) {
  // Deliberately independent of Application Support, username and project path.
  if (root !== localIpcRoot()) throw Error('Local IPC root is not the owned short OS-user directory.');
  const parent = await lstat('/private/tmp');
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || !(parent.mode & 0o1000) || await realpath('/private/tmp') !== '/private/tmp')
    throw Error('Local IPC root parent is not the canonical system sticky directory.');
  try { await mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return directory(root);
}
async function readLease(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) throw Error('Local IPC lease is not a private regular file.');
    const value = JSON.parse(await file.readFile('utf8'));
    const after = await file.stat(); if (!same(stat, after) || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw Error('Local IPC lease changed while reading.');
    if (value.schemaVersion !== 1 || !NAME.test(value.name) || !UUID.test(value.projectId) || !/^[a-f0-9]{64}$/.test(value.workspaceSha256) ||
        !/^[a-f0-9]{32}$/.test(value.token) || !Number.isSafeInteger(value.ownerPid) || value.ownerPid < 2 ||
        !['prepared', 'launching', 'running'].includes(value.phase) || (value.backendPid !== null && (!Number.isSafeInteger(value.backendPid) || value.backendPid < 2)) ||
        !Number.isSafeInteger(value.dev) || !Number.isSafeInteger(value.ino)) throw Error('Local IPC lease is invalid. Residue was retained.');
    return { value, bytes: JSON.stringify(value), stat };
  } finally { await file.close(); }
}
async function writeLease(path, value) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
}
async function removeSession(root, rootStat, lease, { forceOwner = false } = {}) {
  if (!same(await directory(root), rootStat)) throw Error('Local IPC root changed; residue was retained.');
  const path = join(root, lease.value.name), retired = join(root, `retired-${lease.value.name}`), metadata = path + '.json';
  const current = await readLease(metadata);
  if (!same(current.stat, lease.stat) || current.bytes !== lease.bytes) throw Error('Local IPC lease changed; residue was retained.');
  if ((!forceOwner && alive(current.value.ownerPid)) || alive(current.value.backendPid) || current.value.phase === 'launching') return false;
  let target = path;
  if (await absent(path)) {
    if (await absent(retired)) { await unlink(metadata); return true; }
    target = retired;
  }
  const stat = await directory(target);
  if (stat.dev !== current.value.dev || stat.ino !== current.value.ino) throw Error('Local IPC session was replaced; residue was retained.');
  // An orphaned PTY/debug child may outlive both recorded PIDs. Never unlink
  // its open socket/file/cwd merely because the original backend has gone.
  if (await inUse(target)) return false;
  if (!same(await directory(target), stat)) throw Error('Local IPC session changed during usage verification.');
  const finalLease = await readLease(metadata);
  if (!same(finalLease.stat, current.stat) || finalLease.bytes !== current.bytes) throw Error('Local IPC lease changed during usage verification.');
  // Atomic quarantine before recursive removal. Node rm unlinks child symlinks,
  // never follows them; only the validated owned inode is removed.
  if (target === path) {
    if (!await absent(retired)) throw Error('Local IPC cleanup destination already exists.');
    await rename(path, retired);
    const moved = await directory(retired);
    if (!same(stat, moved)) throw Error('Local IPC session changed during cleanup.');
  }
  await rm(retired, { recursive: true }); await unlink(metadata); return true;
}
export async function reclaimLocalIpcSessions() {
  const root = localIpcRoot(), rootStat = await rootDirectory(root), result = { removed: 0, retained: 0 };
  const names = await readdir(root);
  if (names.length > 4096) throw Error('Local IPC inventory exceeded its bound; residue was retained.');
  for (const name of names) {
    if (!name.endsWith('.json') || !NAME.test(name.slice(0, -5))) continue;
    try {
      const lease = await readLease(join(root, name));
      if (lease.value.name + '.json' !== name) throw Error('Local IPC lease name mismatch.');
      if (await removeSession(root, rootStat, lease)) result.removed++; else result.retained++;
    } catch { result.retained++; } // Never delete an ambiguous/damaged/live lease.
  }
  return result;
}
export async function createLocalIpcSession(context) {
  if (!UUID.test(context.id) || typeof context.workspace !== 'string' || await realpath(context.workspace) !== context.workspace || !(await lstat(context.workspace)).isDirectory())
    throw Error('Local IPC session requires a canonical bound project.');
  await reclaimLocalIpcSessions();
  const root = localIpcRoot(), rootStat = await rootDirectory(root);
  const path = await mkdtemp(join(root, randomBytes(4).toString('hex') + '-'));
  const stat = await directory(path);
  // Reserve 54 bytes for normal adapter socket basenames below macOS sun_path.
  if (Buffer.byteLength(path) > 48) { await rm(path, { recursive: true }); throw Error('Local IPC session exceeded its path budget.'); }
  const name = path.slice(root.length + 1), metadata = path + '.json';
  let value = { schemaVersion: 1, name, token: randomBytes(16).toString('hex'), projectId: context.id,
    workspaceSha256: createHash('sha256').update(context.workspace).digest('hex'), ownerPid: process.pid, backendPid: null, phase: 'prepared', dev: stat.dev, ino: stat.ino };
  await writeLease(metadata, value); let lease = await readLease(metadata), disposed = false;
  const update = async changes => {
    if (disposed || !same(await directory(root), rootStat) || !same(await directory(path), stat)) throw Error('Local IPC session is no longer valid.');
    const current = await readLease(metadata);
    if (!same(lease.stat, current.stat) || lease.bytes !== current.bytes) throw Error('Local IPC lease changed.');
    value = { ...value, ...changes };
    const pending = join(root, `.lease-${randomBytes(12).toString('hex')}`);
    await writeLease(pending, value); await rename(pending, metadata); lease = await readLease(metadata);
  };
  return { path,
    async beginLaunch() { await update({ phase: 'launching' }); },
    async attach(pid) { if (!Number.isSafeInteger(pid) || pid < 2) throw Error('Invalid local backend PID.'); await update({ phase: 'running', backendPid: pid }); },
    async cleanup({ confirmedExited = false } = {}) {
      if (disposed) return true;
      // A failed spawn has no live backend; normal close is checked independently.
      if (value.phase === 'launching') {
        if (!confirmedExited) return false;
        await update({ phase: 'prepared' });
      }
      const removed = await removeSession(root, rootStat, lease, { forceOwner: true });
      if (removed) disposed = true;
      return removed;
    },
  };
}
