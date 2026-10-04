import { cp, lstat, mkdir, open, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fault } from "./central-identity.mjs";

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
  for (const file of ["package.json", "klein-light.json", "ynx-logo.png", "LICENSE.txt"]) {
    const current = join(target, file), stat = await lstat(current);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(join(brandingRoot, file))).equals(await readFile(current)))
      throw fault("YNX branding changed. Review it before replacing user files.", "core_brand_review_required", 409);
  }
  const toolsRoot = fileURLToPath(new URL("../../../native/ynx-tools", import.meta.url));
  const tools = JSON.parse(await readFile(join(toolsRoot, 'package.json'), 'utf8'));
  if (tools.publisher !== 'ynx' || tools.name !== 'ynx-tools' || !/^(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})$/.test(tools.version || ''))
    throw fault('The bundled YNX Tools manifest is invalid.', 'core_tools_manifest_invalid', 503);
  const toolsTarget = join(context.projectDirectory, "extensions", `ynx.ynx-tools-${tools.version}`);
  try { const stat = await lstat(toolsTarget); if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault("YNX Tools directory changed.", "core_tools_review_required", 409); }
  catch (error) { if (error.code !== "ENOENT") throw error; await cp(toolsRoot, toolsTarget, { recursive: true, errorOnExist: true, force: false }); }
  for (const file of ["package.json", "activity.svg", "ynx-logo.png", "LICENSE.txt", "src/extension.cjs", "src/guards.cjs", "src/template.cjs", "src/solidity-project.cjs"]) {
    if ((await lstat(join(toolsTarget, "src"))).isSymbolicLink()) throw fault("YNX Tools source directory changed.", "core_tools_review_required", 409);
    const current = join(toolsTarget, file), stat = await lstat(current);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(join(toolsRoot, file))).equals(await readFile(current))) throw fault("YNX Tools changed. Review before replacing user files.", "core_tools_review_required", 409);
  }
  const directory = join(context.projectDirectory, "user-data", "User"); await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw fault("Native settings directory is a link.", "core_state_unsafe", 409);
  try { await writePrivateReceipt(join(directory, "settings.json"), {
    "workbench.colorTheme": "YNX Klein Light", "window.title": "YNX Developer — ${activeEditorShort}${separator}${folderName}",
    "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
    ...(context.egressProxy ? { "http.proxy": context.egressProxy, "http.proxySupport": "override" } : {}),
  }); } catch (error) { if (error.code !== "EEXIST") throw error; }
}
