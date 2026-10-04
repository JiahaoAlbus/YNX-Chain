import { cp, lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fault } from "./central-identity.mjs";

// These are immutable shipped extension inputs, not project source. Reviewing
// only a fixed helper list misses newly added modules and compiler assets.
async function extensionTree(root) {
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw Error('Extension root is not regular.');
  const canonical = await realpath(root), entries = new Map();
  let bytes = 0, count = 0;
  async function visit(directory, relative, depth) {
    if (depth > 32 || ++count > 8192 || await realpath(directory) !== directory) throw Error('Extension directory is unsafe.');
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Extension directory is not regular.');
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const path = join(directory, name), key = relative ? relative + '/' + name : name, current = await lstat(path);
      if (current.isSymbolicLink()) throw Error('Extension link is unsafe.');
      if (current.isDirectory()) { entries.set(key + '/', 'directory'); await visit(path, key, depth + 1); }
      else {
        if (!current.isFile() || ++count > 8192 || (bytes += current.size) > 128 * 1024 * 1024) throw Error('Extension input exceeds its regular-file budget.');
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const before = await file.stat();
          if (!before.isFile() || before.ino !== current.ino || before.dev !== current.dev || before.size !== current.size) throw Error('Extension input changed.');
          const digest = createHash('sha256'), buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, before.size)));
          for (let offset = 0; offset < before.size;) {
            const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
            if (!bytesRead) throw Error('Extension input changed.');
            digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
          }
          entries.set(key, digest.digest('hex'));
          const after = await file.stat(), located = await lstat(path);
          if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || located.isSymbolicLink() || located.ino !== before.ino || await realpath(path) !== path) throw Error('Extension input changed.');
        } finally { await file.close(); }
      }
    }
    const after = await lstat(directory);
    if (after.isSymbolicLink() || after.ino !== stat.ino || JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) throw Error('Extension directory changed.');
  }
  await visit(canonical, '', 0); return entries;
}
export async function verifyCoreExtensionInputs(expectedRoot, targetRoot, code = 'core_tools_review_required') {
  try {
    const expected = await extensionTree(expectedRoot), target = await extensionTree(targetRoot);
    if (expected.size !== target.size || [...expected].some(([name, digest]) => target.get(name) !== digest)) throw Error('Extension input differs.');
  } catch {
    throw fault('Bundled extension inputs changed. Review before replacing user files.', code, 409);
  }
}

export async function writePrivateReceipt(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(typeof value === "string" ? value : JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); }
}
export async function prepareCoreProject(context, brandingRoot = fileURLToPath(new URL("../../../native/ynx-brand", import.meta.url))) {
  for (const dir of ["user-data", "extensions"]) {
    const path = join(context.projectDirectory, dir); await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink()) throw fault("Native project metadata directory is a link.", "core_state_unsafe", 409);
  }
  const branding = JSON.parse(await readFile(join(brandingRoot, 'package.json'), 'utf8'));
  if (branding.publisher !== 'ynx' || branding.name !== 'ynx-developer-brand' || !/^\d+\.\d+\.\d+$/.test(branding.version || '')) throw fault("YNX branding manifest is invalid.", "core_brand_review_required", 503);
  const target = join(context.projectDirectory, "extensions", `ynx.ynx-developer-brand-${branding.version}`);
  try { if (!(await lstat(target)).isDirectory() || (await lstat(target)).isSymbolicLink()) throw fault("YNX branding directory changed.", "core_brand_review_required", 409); }
  catch (error) { if (error.code !== "ENOENT") throw error; await cp(brandingRoot, target, { recursive: true, errorOnExist: true, force: false }); }
  await verifyCoreExtensionInputs(brandingRoot, target, 'core_brand_review_required');
  const toolsRoot = fileURLToPath(new URL("../../../native/ynx-tools", import.meta.url));
  const tools = JSON.parse(await readFile(join(toolsRoot, 'package.json'), 'utf8'));
  if (tools.publisher !== 'ynx' || tools.name !== 'ynx-tools' || !/^(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})$/.test(tools.version || ''))
    throw fault('The bundled YNX Tools manifest is invalid.', 'core_tools_manifest_invalid', 503);
  const toolsTarget = join(context.projectDirectory, "extensions", `ynx.ynx-tools-${tools.version}`);
  try { const stat = await lstat(toolsTarget); if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault("YNX Tools directory changed.", "core_tools_review_required", 409); }
  catch (error) { if (error.code !== "ENOENT") throw error; await cp(toolsRoot, toolsTarget, { recursive: true, errorOnExist: true, force: false }); }
  await verifyCoreExtensionInputs(toolsRoot, toolsTarget);
  const directory = join(context.projectDirectory, "user-data", "User"); await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw fault("Native settings directory is a link.", "core_state_unsafe", 409);
  try { await writePrivateReceipt(join(directory, "settings.json"), {
    "workbench.colorTheme": "YNX Klein Light", "window.title": "YNX Developer — ${activeEditorShort}${separator}${folderName}",
    "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
    ...(context.egressProxy ? { "http.proxy": context.egressProxy, "http.proxySupport": "override" } : {}),
  }); } catch (error) { if (error.code !== "EEXIST") throw error; }
}
