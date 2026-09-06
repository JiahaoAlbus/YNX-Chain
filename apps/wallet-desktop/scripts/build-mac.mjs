import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Build the macOS package on macOS");
const arch = process.argv[2] || "universal";
if (!["arm64", "x64", "universal"].includes(arch)) throw new Error("Choose arm64, x64 or universal");
const python = process.env.PYTHON_PATH || execFileSync("/usr/bin/which", ["python3"], { encoding: "utf8" }).trim();
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/electron-builder/cli.js", import.meta.url)), "--mac", "dmg", `--${arch}`, "--publish", "never"], {
  stdio: "inherit", env: { ...process.env, PYTHON_PATH: python }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
