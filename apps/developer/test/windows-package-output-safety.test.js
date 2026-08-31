import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("Windows packaging uses a fresh source-scoped candidate and protects prior evidence", async () => {
  const [pack, verify, installer, workflow] = await Promise.all([
    readFile(`${root}/scripts/package-windows.ps1`, "utf8"),
    readFile(`${root}/scripts/verify-windows-package.ps1`, "utf8"),
    readFile(`${root}/scripts/verify-windows-installer.ps1`, "utf8"),
    readFile(new URL("../../../.github/workflows/developer-windows.yml", import.meta.url), "utf8"),
  ]);
  for (const source of [pack, verify, installer]) {
    assert.match(source, /\.ynx-developer-windows-candidates/);
    assert.match(source, /YNX_DEVELOPER_WINDOWS_OUTPUT_DIR must stay under/);
  }
  assert.match(pack, /Refusing to overwrite existing Windows package candidate/);
  assert.doesNotMatch(pack, /Remove-Item \$outRoot -Recurse/);
  assert.match(verify, /Refusing to overwrite existing Windows native self-test evidence/);
  assert.match(installer, /Refusing to overwrite existing Windows MSIX installation evidence/);
  assert.match(installer, /packageSignatureValidatedByAddAppxPackage = \$true/);
  assert.match(workflow, /\.ynx-developer-windows-candidates\/\*\*\/ynx-developer-testnet-preview-windows-x64-test-signed\.msix/);
  assert.match(workflow, /\.ynx-developer-windows-candidates\/\*\*\/windows-msix-install-evidence\.json/);
  assert.match(workflow, /include-hidden-files: true/);
});
