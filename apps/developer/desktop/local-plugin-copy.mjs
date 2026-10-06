import { mkdtemp, lstat, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Only remove this unpublished copy. Older sessions may still be running.
export async function preparePrivatePluginCopy(temporary, prepare) {
  const parent = await lstat(temporary);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(temporary) !== temporary || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw Error('Extension staging requires a canonical private directory.');
  const session = await mkdtemp(join(temporary, 'extensions-'));
  const identity = await lstat(session);
  try {
    await prepare(session);
    return join(session, 'plugins');
  } catch (error) {
    try {
      const currentParent = await lstat(temporary), current = await lstat(session);
      if (currentParent.dev !== parent.dev || currentParent.ino !== parent.ino || await realpath(temporary) !== temporary ||
          !current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) throw Error('Extension staging identity changed; residue retained.');
      await rm(session, { recursive: true, force: false });
    } catch (cleanupError) {
      error.pluginCopyCleanupError = cleanupError;
    }
    throw error;
  }
}
