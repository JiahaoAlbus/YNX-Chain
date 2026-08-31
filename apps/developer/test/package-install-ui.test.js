import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Web npm and Python package installation is exact, reviewed, persistent and fail-closed", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/runtime-profile-service/src/service.mjs"),
    python = await read("services/runtime-profile-service/src/python-package.mjs"),
    image = await read("scripts/build-cloud-toolchain-image.sh"),
    deploy = await read("scripts/deploy-public-candidate-transaction.sh");
  assert.match(workbench, /Install an exact dependency/);
  assert.match(workbench, /install-package-once/);
  assert.match(workbench, /--ignore-scripts/);
  assert.match(workbench, /--only-binary=:all:/);
  assert.match(workbench, /requirements\.ynx\.lock/);
  assert.match(workbench, /temporary install egress; fail closed unless removed/);
  assert.match(workbench, /"package\.json": result\.packageJson/);
  assert.match(workbench, /"package-lock\.json": result\.packageLock/);
  assert.match(client, /previousPackageLockBytes/);
  assert.match(client, /previousRequirementsBytes/);
  assert.match(service, /\/opt\/ynx-code-dependencies\/\$\{projectId\}/);
  assert.match(service, /package_network_cleanup_failed/);
  assert.match(service, /"stop",\s*containerName,\s*"--force"/);
  assert.match(service, /"ln",\s*"-s",\s*dependencies/);
  assert.match(python, /python_lock_state_mismatch/);
  assert.match(python, /--only-binary=:all:/);
  assert.match(python, /binaryOnly: true/);
  assert.match(python, /package_network_cleanup_failed/);
  assert.doesNotMatch(python, /shell:\s*true/);
  assert.match(image, /python3-pip python3-venv/);
  assert.match(image, /lxc init "\$source_alias" "\$builder" --no-profiles --storage "\$storage_pool"/);
  assert.match(image, /lxc config device add "\$builder" ynx-package-egress nic network="\$package_network" name=eth0/);
  assert.match(image, /package_network == ynx-pkg-egress/);
  assert.match(image, /Ubuntu APT sources must use HTTPS under reviewed package egress/);
  assert.match(image, /apt\/ubuntu\.sources/);
  assert.match(image, /timeout 180 cloud-init status --wait/);
  assert.match(image, /lxc file push "\$apt_sources_path" "\$builder\/etc\/apt\/sources\.list\.d\/ubuntu\.sources"/);
  assert.match(image, /lxc exec "\$builder" -- grep -R -E/);
  assert.match(image, /rm -rf \/var\/lib\/apt\/lists\/\*/);
  assert.match(image, /Acquire::ForceIPv4=true/);
  assert.match(image, /Acquire::Retries=3/);
  assert.match(image, /rustc 1\.75\.0/);
  assert.match(image, /cargo 1\.75\.0/);
  assert.match(image, /cargo --version \| grep "\^cargo 1\.75\.0\$"/);
  assert.match(image, /rustfmt=1\.75\.0\+dfsg0ubuntu1-0ubuntu7\.4/);
  assert.match(image, /rustfmt --version \| grep "\^rustfmt 1\.7\.0-stable "/);
  assert.match(image, /YNX_CODE_IMAGE_BUILD_FAILED status=%s line=%s/);
  assert.ok(
    image.indexOf("rm -rf /var/lib/apt/lists/*") <
      image.indexOf("update -qq"),
  );
  assert.ok(
    image.indexOf("cloud-init status --wait") < image.indexOf("lxc file push"),
  );
  assert.match(deploy, /YNX_CODE_LXD_PACKAGE_NETWORK/);
  assert.doesNotMatch(workbench, /npm install.*shell/);
});
