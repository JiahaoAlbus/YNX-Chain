import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const MAX_FILES = 256,
  MAX_BYTES = 2 * 1024 * 1024;

export async function materializeSnapshot(root, snapshot) {
  for (const folder of snapshot.folders || [])
    await mkdir(safeWorkspaceJoin(root, folder), {
      recursive: true,
      mode: 0o700,
    });
  for (const [path, content] of Object.entries(snapshot.files)) {
    const target = safeWorkspaceJoin(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600, flag: "wx" });
  }
}
export async function readTextSnapshot(root, previous) {
  const files = {},
    folders = [];
  let bytes = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".tmp" || entry.name === ".ynx-build") continue;
      const absolute = resolve(directory, entry.name),
        path = relative(root, absolute);
      if (entry.isDirectory()) {
        folders.push(path);
        await walk(absolute);
      } else if (entry.isFile()) {
        const value = await readFile(absolute);
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
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw fault("Workspace path escaped its root.", "workspace_escape");
  return target;
}
function fault(message, code) {
  return Object.assign(new Error(message), { code });
}
