import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("SKIP: macOS sandbox check is only applicable to the local macOS package.");
  process.exit(0);
}
const project = realpathSync(fileURLToPath(new URL("../test/fixtures/desktop-project/", import.meta.url)));
const escape = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const profile = `(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath "${escape(project)}")) (require-not (subpath "/private/tmp")) (require-not (subpath "/dev")))`;
const result = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/env", "node", "--test", `${project}/test/boundaries.test.js`], { cwd: project, encoding: "utf8" });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
if (result.status !== 0) throw new Error(`desktop sandbox check failed with ${result.status}`);
console.log("Desktop command sandbox denied network and out-of-workspace writes while returning real test output.");
