import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink,stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build the macOS package on macOS");
const arch = process.argv[2] || "universal";
if (!["arm64", "x64", "universal"].includes(arch)) throw new Error("Choose arm64, x64 or universal");
const root = fileURLToPath(new URL("..", import.meta.url));
// Narrow normal-entry overrides for an already pinned local distribution.
// Never silently drop flags or pass arbitrary builder configuration through.
const extra=process.argv.slice(3),builderOptions=[];let electronDist=null,noRebuild=false;
for(const option of extra){
  if(option.startsWith('--config.electronDist=')&&electronDist===null){
    electronDist=option.slice('--config.electronDist='.length);
    if(!path.isAbsolute(electronDist)||electronDist.includes('\0')||electronDist.split('/').some(p=>p==='.'||p==='..'))throw Error('LOCAL_ELECTRON_DIST_ABSOLUTE_REQUIRED');
  }else if(option==='--config.npmRebuild=false'&&!noRebuild)noRebuild=true;
  else throw Error('UNSUPPORTED_MAC_BUILD_OPTION');
}
if((electronDist!==null)!==noRebuild)throw Error('LOCAL_ELECTRON_DIST_AND_NO_REBUILD_REQUIRED');
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if(electronDist!==null){
  if(!(await stat(electronDist)).isDirectory()||!(await stat(path.join(electronDist,'Electron.app/Contents/MacOS/Electron'))).isFile())throw Error('LOCAL_ELECTRON_DIST_INCOMPLETE');
  const version=(await readFile(path.join(electronDist,'version'),'utf8')).trim();
  if(version!==metadata.devDependencies.electron)throw Error('LOCAL_ELECTRON_VERSION_MISMATCH');
  builderOptions.push('--config.electronDist='+electronDist,'--config.npmRebuild=false');
}
// Fixed module must be frozen in a separately authorized native build first.
// Packaging never silently compiles/downloads a missing authority implementation.
const originalAuthNative=await stat(path.join(root,'native/original-auth-identity.node'));
if(!originalAuthNative.isFile()||originalAuthNative.size===0)throw Error('AUTH_NATIVE_FROZEN_MODULE_REQUIRED');
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url)), "--mac", "--dir", `--${arch}`, "--publish", "never", ...builderOptions], {
  stdio: "inherit", cwd: root, env: process.env
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const appDir = path.join(root, "dist", arch === "x64" ? "mac" : `mac-${arch}`, `${metadata.build.productName}.app`);
const output = path.join(root, "dist", `ynx-wallet-macos-${metadata.version}-${arch}.dmg`);
const stage = await mkdtemp(path.join(os.tmpdir(), "ynx-wallet-dmg-"));
try {
  execFileSync("/usr/bin/ditto", [appDir, path.join(stage, `${metadata.build.productName}.app`)]);
  await symlink("/Applications", path.join(stage, "Applications"));
  // Native disk image creation avoids dmg-builder's optional Python/Finder dependency.
  execFileSync("/usr/bin/hdiutil", ["create", "-volname", metadata.build.productName, "-srcfolder", stage, "-ov", "-format", "UDZO", output], { stdio: "inherit" });
  console.log(`Created ${output}`);
} finally { await rm(stage, { recursive: true, force: true }); }
