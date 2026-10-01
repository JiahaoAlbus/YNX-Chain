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
  const target = join(context.projectDirectory, "extensions", "ynx.ynx-developer-brand-0.1.0");
  try { if (!(await lstat(target)).isDirectory() || (await lstat(target)).isSymbolicLink()) throw fault("YNX branding directory changed.", "core_brand_review_required", 409); }
  catch (error) { if (error.code !== "ENOENT") throw error; await cp(brandingRoot, target, { recursive: true, errorOnExist: true, force: false }); }
  for (const file of ["package.json", "klein-light.json", "ynx-logo.png", "LICENSE.txt"]) {
    const current = join(target, file), stat = await lstat(current);
    if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(join(brandingRoot, file))).equals(await readFile(current)))
      throw fault("YNX branding changed. Review it before replacing user files.", "core_brand_review_required", 409);
  }
  const directory = join(context.projectDirectory, "user-data", "User"); await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw fault("Native settings directory is a link.", "core_state_unsafe", 409);
  try { await writePrivateReceipt(join(directory, "settings.json"), {
    "workbench.colorTheme": "YNX Klein Light", "window.title": "YNX Developer — ${activeEditorShort}${separator}${folderName}",
    "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
    ...(context.egressProxy ? { "http.proxy": context.egressProxy, "http.proxySupport": "override" } : {}),
  }); } catch (error) { if (error.code !== "EEXIST") throw error; }
}
