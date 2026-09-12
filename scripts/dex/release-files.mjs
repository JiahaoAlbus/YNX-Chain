import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

// Read a build tree without following links into another build or private files.
export async function readReleaseFiles(directory) {
  const root = path.resolve(directory);
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("release root must be a real directory");
  const canonicalRoot = await realpath(root);
  const files = [];
  async function walk(current, prefix = "") {
    for (const name of (await readdir(current)).sort()) {
      const absolute = path.join(current, name);
      const relative = path.posix.join(prefix, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`symlink forbidden in release: ${relative}`);
      const resolved = await realpath(absolute);
      const within = path.relative(canonicalRoot, resolved);
      if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) throw new Error(`release entry escapes build directory: ${relative}`);
      if (info.isDirectory()) await walk(absolute, relative);
      else if (info.isFile()) {
        const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error(`release entry changed while reading: ${relative}`);
          files.push({ absolute, relative, data: await handle.readFile() });
        } finally { await handle.close(); }
      } else throw new Error(`unsupported release entry: ${relative}`);
    }
  }
  await walk(root);
  return files;
}
