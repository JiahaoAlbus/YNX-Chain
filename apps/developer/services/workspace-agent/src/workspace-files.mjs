import { mkdir, readdir, writeFile, lstat, realpath, open as openFile } from "node:fs/promises";
import { constants } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { isWorkspacePath } from "./workspace-path.mjs";

const MAX_FILES = 256,
  MAX_BYTES = 2 * 1024 * 1024;

async function canonicalWorkspace(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw fault("Workspace root is a symbolic link.", "workspace_symlink");
  if (!info.isDirectory()) throw fault("Workspace root is not a directory.", "workspace_escape");
  return realpath(root);
}
async function ensureDirectories(root, path) {
  let directory = root;
  for (const part of path ? path.split("/") : []) {
    directory = resolve(directory, part);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw fault("Workspace directory is a symbolic link.", "workspace_symlink");
    if (!info.isDirectory() || await realpath(directory) !== directory)
      throw fault("Workspace path escaped its root.", "workspace_escape");
  }
}
export async function materializeSnapshot(root, snapshot) {
  root = await canonicalWorkspace(root);
  // Validate all relative paths before creating the first directory or file.
  for (const path of [...(snapshot.folders || []), ...Object.keys(snapshot.files)]) safeWorkspaceJoin(root,path);
  for (const folder of snapshot.folders || []) await ensureDirectories(root,folder);
  for (const [path, content] of Object.entries(snapshot.files)) {
    const target = safeWorkspaceJoin(root,path), parent = path.split("/").slice(0,-1).join("/");
    await ensureDirectories(root,parent);
    await writeFile(target, content, { mode: 0o600, flag: "wx" });
  }
}
export async function readTextSnapshot(root, previous) {
  root = await canonicalWorkspace(root);
  const files = {},
    folders = [];
  let bytes = 0;
  async function walk(directory) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || await realpath(directory) !== directory)
      throw fault("Snapshot directory changed to a link.", "workspace_symlink");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".tmp" || entry.name === ".ynx-build") continue;
      const absolute = resolve(directory, entry.name),
        path = relative(root, absolute);
      safeWorkspaceJoin(root, path);
      if (entry.isSymbolicLink()) throw fault("Snapshot entry is a symbolic link.", "workspace_symlink");
      if (entry.isDirectory()) {
        folders.push(path);
        await walk(absolute);
      } else if (entry.isFile()) {
        const file = await openFile(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        let value;
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > MAX_BYTES - bytes)
            throw fault("Workspace exceeds the text snapshot boundary.", "workspace_too_large");
          value = await file.readFile();
          if (await realpath(absolute) !== absolute)
            throw fault("Snapshot file changed to a link.", "workspace_symlink");
        } finally { await file.close(); }
        if (value.includes(0)) continue;
        bytes += value.length;
        if (Object.keys(files).length >= MAX_FILES || bytes > MAX_BYTES)
          throw fault(
            "Workspace exceeds the text snapshot boundary.",
            "workspace_too_large",
          );
        files[path] = value.toString("utf8");
      }
    }
  }
  await walk(root);
  const open = (previous.open || []).filter((path) =>
      Object.hasOwn(files, path),
    ),
    active = Object.hasOwn(files, previous.active)
      ? previous.active
      : open[0] || Object.keys(files)[0] || "";
  return { name: previous.name, folders, files, open, active };
}
export function safeWorkspaceJoin(root, path) {
  if (!isWorkspacePath(path))
    throw fault("Workspace path is not normalized and relative.", "workspace_escape");
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw fault("Workspace path escaped its root.", "workspace_escape");
  return target;
}
function fault(message, code) {
  return Object.assign(new Error(message), { code });
}
