import { mkdtemp, lstat, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

export function verifiedPluginSessionExit({ backendClosed, cleanupStdout }) {
  return backendClosed === true && cleanupStdout === 'YNX_PROCESS_TREE_CLEANUP_VERIFIED\n';
}

// Own one copy only. Published copies require complete session-exit evidence;
// older and concurrently active sessions are never enumerated or removed.
export async function preparePrivatePluginCopy(temporary, prepare, { lifecycle = false } = {}) {
  const parent = await lstat(temporary);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(temporary) !== temporary || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw Error('Extension staging requires a canonical private directory.');
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
