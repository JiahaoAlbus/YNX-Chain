import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build the macOS package on macOS");
const arch = process.argv[2] || "universal";
if (!["arm64", "x64", "universal"].includes(arch)) throw new Error("Choose arm64, x64 or universal");
const root = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url)), "--mac", "--dir", `--${arch}`, "--publish", "never"], {
  stdio: "inherit", cwd: root, env: process.env
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
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
