import { mkdtemp, lstat, realpath, rm, readdir, statfs, mkdir, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function verifiedPluginSessionExit({ backendClosed, cleanupStdout }) {
  return backendClosed === true && cleanupStdout === 'YNX_PROCESS_TREE_CLEANUP_VERIFIED\n';
}

// Own one copy only. Published copies require complete session-exit evidence;
// older and concurrently active sessions are never enumerated or removed.
export async function preparePrivatePluginCopy(temporary, prepare, { lifecycle = false, source } = {}) {
  const parent = await lstat(temporary);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(temporary) !== temporary || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw Error('Extension staging requires a canonical private directory.');
  if (source) await assertPluginCopyCapacity(temporary, source, { clone: process.platform === 'darwin' });
  const session = await mkdtemp(join(temporary, 'extensions-'));
  const identity = await lstat(session);
  let launched = false, closing;
  const cleanup = ({ confirmedSessionExited = false } = {}) => {
    if (closing) return closing;
    if (launched && !confirmedSessionExited) return Promise.resolve(false);
    closing = (async () => {
      const currentParent = await lstat(temporary), current = await lstat(session);
      if (currentParent.dev !== parent.dev || currentParent.ino !== parent.ino || await realpath(temporary) !== temporary ||
          !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
        throw Error('Extension staging identity changed; residue retained.');
      await rm(session, { recursive: true, force: false });
      return true;
    })();
    return closing;
  };
  try {
    await prepare(session);
    const plugins = join(session, 'plugins');
    return lifecycle ? Object.freeze({ plugins, beginLaunch() {
      if (closing || launched) throw Error('Extension session cannot be launched again.');
      launched = true;
    }, cleanup }) : plugins;
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      error.pluginCopyCleanupError = cleanupError;
    }
    throw error;
  }
}

// Clone metadata and runtime headroom are budgeted separately from full copies.
// This is a preflight, not a reservation; ENOSPC cleanup still applies.
export async function assertPluginCopyCapacity(temporary, source, { filesystem = statfs, clone = false, reserveBytes = (clone ? 64 : 128) * 1024 * 1024 } = {}) {
  const fs = await filesystem(temporary, { bigint: true });
  const block = BigInt(fs.bsize), available = BigInt(fs.bavail) * block;
  let required = 0n, files = 0;
  async function count(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw Error('Extension copy source must not contain links.');
    if (stat.isDirectory()) { required += block; for (const name of await readdir(path)) await count(join(path, name)); }
    else if (stat.isFile()) { required += clone ? block : (BigInt(stat.size) + block - 1n) / block * block; files++; }
    else throw Error('Extension copy source contains an unsupported entry.');
  }
  await count(source);
  required += BigInt(reserveBytes);
  if (available < required) {
    const mb = value => String((value + 1048575n) / 1048576n);
    throw Object.assign(Error('Not enough disk space to prepare IDE extensions: need ' + mb(required) + ' MiB including working space, available ' + mb(available) + ' MiB. Free at least ' + mb(required - available) + ' MiB and reopen. Existing projects and extension copies were preserved.'),
      { code: 'YNX_PLUGIN_COPY_SPACE', requiredBytes: String(required), availableBytes: String(available), missingBytes: String(required - available), files });
  }
  return { requiredBytes: String(required), availableBytes: String(available), files };
}

// Native clone has no silent allocation fallback. Only an unsupported filesystem
// permits a full copy, after a separate full-size capacity check.
export async function copyPrivatePluginTree(source, target, { helper, signal, run = promisify(execFile), capacity = assertPluginCopyCapacity } = {}) {
  const parentPath = dirname(target), parent = await lstat(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o077) || await realpath(parentPath) !== parentPath) throw Error('Private extension copy parent required.');
  if (process.platform !== 'darwin') {
    await capacity(parentPath, source);
    return cp(source, target, { recursive: true, errorOnExist: true, force: false });
  }
  await capacity(parentPath, source, { clone: true });
  await mkdir(target, { mode: 0o700 });
  const identity = await lstat(target);
  try {
    const result = await run(helper, ['--clone-plugins', source, target], { signal, timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 65536 });
    if (result.stdout !== 'YNX_PLUGIN_CLONE_VERIFIED\n') throw Error('Extension clone verification failed.');
  } catch (error) {
    if (error.code === 73) error.code = 'ENOSPC';
    if (error.code !== 78 || signal?.aborted) throw error;
    await capacity(parentPath, source);
    const currentParent = await lstat(parentPath), current = await lstat(target);
    if (currentParent.dev !== parent.dev || currentParent.ino !== parent.ino || await realpath(parentPath) !== parentPath || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw Error('Extension clone identity changed; partial copy retained.');
    await rm(target, { recursive: true });
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  }
}
