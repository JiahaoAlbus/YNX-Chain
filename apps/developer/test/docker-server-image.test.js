import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Docker server image is source-bound and requires an unprivileged real compile proof", async () => {
  const [dockerfile, verifier, workflow] = await Promise.all([
    read("Dockerfile"),
    read("scripts/verify-docker-server-image.sh"),
    read("../../.github/workflows/developer-docker-server.yml"),
  ]);
  for (const value of ["bubblewrap", "util-linux", "npm rebuild node-pty --build-from-source", "USER 10001:10001", "org.opencontainers.image.revision", "io.ynx.runtime-checkpoint"]) assert.match(dockerfile, new RegExp(value));
  for (const value of ["--read-only", "--cap-drop=ALL", "no-new-privileges", "seccomp=unconfined", "apparmor=unconfined", "uid=10001,gid=10001,mode=0700", "YNX_CODE_WORKSPACE_SESSION_KEY", "/runtime/health", "--cookie-jar", "sandboxReady", "YNX-DOCKER-CPP", "realCppCompile", "outerContainerSeccomp", "outerContainerAppArmor", "registryPublished:false"]) assert.match(verifier, new RegExp(value));
  assert.doesNotMatch(verifier, /--privileged/);
  for (const value of ["docker build", "runtime_checkpoint=", "verify-docker-server-image.sh", "docker save", "upload-artifact@v4"]) assert.match(workflow, new RegExp(value));
  assert.doesNotMatch(workflow, /node -p \\\"require/);
});
