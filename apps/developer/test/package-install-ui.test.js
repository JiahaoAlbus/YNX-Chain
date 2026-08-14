import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Web package installation is exact, reviewed, persistent and fail-closed", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/runtime-profile-service/src/service.mjs"),
    deploy = await read("scripts/deploy-public-candidate-transaction.sh");
  assert.match(workbench, /Install an exact npm dependency/);
  assert.match(workbench, /install-package-once/);
  assert.match(workbench, /--ignore-scripts/);
  assert.match(workbench, /temporary install egress; fail closed unless removed/);
  assert.match(workbench, /"package\.json": result\.packageJson/);
  assert.match(workbench, /"package-lock\.json": result\.packageLock/);
  assert.match(client, /previousPackageLockBytes/);
  assert.match(service, /\/opt\/ynx-code-dependencies\/\$\{projectId\}/);
  assert.match(service, /package_network_cleanup_failed/);
  assert.match(service, /stop",containerName,"--force/);
  assert.match(service, /ln","-s",dependencies/);
  assert.match(deploy, /YNX_CODE_LXD_PACKAGE_NETWORK/);
  assert.doesNotMatch(workbench, /npm install.*shell/);
});
