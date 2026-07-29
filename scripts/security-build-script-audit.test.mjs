import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditBuildScripts } from "./security-build-script-audit.mjs";

function fixture({ lockEntry, allowlistEntry, packageJson, platform = "linux" }) {
  const rootDir = mkdtempSync(join(tmpdir(), "ynx-build-script-audit-"));
  mkdirSync(join(rootDir, "security-platform"), { recursive: true });
  writeFileSync(
    join(rootDir, "package-lock.json"),
    `${JSON.stringify({ packages: { "": {}, "node_modules/example": lockEntry } }, null, 2)}\n`,
  );
  writeFileSync(
    join(rootDir, "security-platform/build-script-allowlist.json"),
    `${JSON.stringify({ allowed: { "node_modules/example": allowlistEntry } }, null, 2)}\n`,
  );
  if (packageJson) {
    mkdirSync(join(rootDir, "node_modules/example"), { recursive: true });
    writeFileSync(join(rootDir, "node_modules/example/package.json"), `${JSON.stringify(packageJson)}\n`);
  }
  return {
    errors: auditBuildScripts({ rootDir, platform }),
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

test("accepts an absent optional install-script package excluded from the current platform", () => {
  const result = fixture({
    lockEntry: { hasInstallScript: true, optional: true, os: ["darwin"] },
    allowlistEntry: { lockFlagOnlyReviewed: true },
  });
  try {
    assert.deepEqual(result.errors, []);
  } finally {
    result.cleanup();
  }
});

test("fails closed when an allowlisted package is absent on a supported platform", () => {
  const result = fixture({
    lockEntry: { hasInstallScript: true, optional: true, os: ["linux"] },
    allowlistEntry: { lockFlagOnlyReviewed: true },
  });
  try {
    assert.match(result.errors.join("\n"), /metadata is unavailable for supported platform linux/);
  } finally {
    result.cleanup();
  }
});

test("fails closed when a missing package is not optional", () => {
  const result = fixture({
    lockEntry: { hasInstallScript: true, os: ["darwin"] },
    allowlistEntry: { lockFlagOnlyReviewed: true },
  });
  try {
    assert.match(result.errors.join("\n"), /metadata is unavailable/);
  } finally {
    result.cleanup();
  }
});

test("detects reviewed lifecycle command drift when package metadata is present", () => {
  const result = fixture({
    lockEntry: { hasInstallScript: true },
    allowlistEntry: { postinstall: "node reviewed.js" },
    packageJson: { scripts: { postinstall: "node changed.js" } },
  });
  try {
    assert.match(result.errors.join("\n"), /postinstall differs from reviewed command/);
  } finally {
    result.cleanup();
  }
});
