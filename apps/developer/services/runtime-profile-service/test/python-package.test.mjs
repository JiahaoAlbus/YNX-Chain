import assert from "node:assert/strict";
import test from "node:test";
import { validatePythonPackageInstall } from "../src/python-package.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const request = {
  protocolVersion: "ynx-code-runtime/v1",
  approval: "install-package-once",
  ecosystem: "python",
  projectId: "project-a",
  packageSpec: "colorama==0.4.6",
  workspaceBytes: 512,
  workspaceFileCount: 1,
  previousRequirementsBytes: 0,
  hasRequirementsLock: true,
};

test("Python wheel locks require one SHA-256-bound entry per normalized package name", () => {
  const valid = validatePythonPackageInstall({
    ...request,
    requirementsLock: `Colorama==0.4.6 --hash=sha256:${HASH_A}\n`,
  });
  assert.equal(valid.requirementsLock, `Colorama==0.4.6 --hash=sha256:${HASH_A}\n`);

  assert.throws(() => validatePythonPackageInstall({
    ...request,
    requirementsLock: [
      `colorama==0.4.6 --hash=sha256:${HASH_A}`,
      `Colorama==0.4.6 --hash=sha256:${HASH_B}`,
      "",
    ].join("\n"),
  }), (error) => error.code === "invalid_python_lock");
});
