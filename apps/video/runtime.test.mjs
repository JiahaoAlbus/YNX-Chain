import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync, readlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const videoRoot = resolve(import.meta.dirname);
const repoRoot = resolve(videoRoot, "../..");
const topology = JSON.parse(readFileSync(join(videoRoot, "runtime/topology.json"), "utf8"));

test("runtime topology isolates Viewer 6494 from API 6493 and Creator 6495", () => {
  assert.equal(topology.viewer.port, 6494);
  assert.equal(topology.api.port, 6493);
  assert.equal(topology.creator.port, 6495);
  assert.equal(topology.api.mutationAllowed, false);
  assert.equal(topology.creator.mutationAllowed, false);
  assert.equal(topology.viewer.currentLink, "/opt/ynx-video-viewer-wallet/current");
  assert.ok(topology.forbiddenPaths.includes("/opt/ynx-video/current"));
});

test("runtime carrier rebuild is byte-identical and normalized", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).trim();
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-build-"));
  const first = join(temp, "first.tar.gz");
  const second = join(temp, "second.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, first], {cwd: repoRoot});
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, second], {cwd: repoRoot});
  assert.deepEqual(readFileSync(first), readFileSync(second));
  const listing = execFileSync("gtar", ["-tvzf", first, "--numeric-owner", "--full-time"], {encoding: "utf8"});
  for (const line of listing.trim().split("\n")) {
    assert.match(line, / 0\/0 /);
    assert.match(line, /1970-01-01 00:00:00/);
  }
  const names = execFileSync("gtar", ["-tzf", first], {encoding: "utf8"}).trim().split("\n");
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.includes("runtime/server.mjs"));
  assert.ok(names.includes("runtime/runtime-manifest.json"));
});

test("actual shell deploy and rollback touch only isolated Viewer binding", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).trim();
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-executor-"));
  const root = join(temp, "viewer-root");
  const fixture = join(root, "fixture");
  const releases = join(root, "releases");
  mkdirSync(fixture, {recursive: true});
  mkdirSync(join(releases, "old-release"), {recursive: true});
  symlinkSync(join(releases, "old-release"), join(root, "current"));
  writeFileSync(join(releases, "old-release", "index.html"), "old viewer\n");
  writeFileSync(join(fixture, "api-state"), "api-6493-stable\n");
  writeFileSync(join(fixture, "creator-state"), "creator-6495-stable\n");
  for (const [name, body] of [
    ["probe-api", `#!/bin/sh\ncat '${join(fixture, "api-state")}'\n`],
    ["probe-creator", `#!/bin/sh\ncat '${join(fixture, "creator-state")}'\n`],
    ["probe-viewer", `#!/bin/sh\ntest -f '${join(root, "current", "index.html")}'\ncat '${join(root, "current", "index.html")}'\n`],
    ["restart-viewer", `#!/bin/sh\nprintf 'restart-viewer-only\\n' >> '${join(fixture, "restart-log")}'\n`]
  ]) {
    const path = join(fixture, name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  const apiBefore = readFileSync(join(fixture, "api-state"));
  const creatorBefore = readFileSync(join(fixture, "creator-state"));
  const carrier = join(temp, "candidate.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, carrier], {cwd: repoRoot});
  const sha = execFileSync("shasum", ["-a", "256", carrier], {encoding: "utf8"}).split(/\s+/)[0];
  const receipt = join(temp, "receipt.txt");
  const env = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_VIEWER_ROOT: root,
    YNX_VIDEO_RELEASE_ID: `ynx-video-${source}`,
    YNX_VIDEO_CARRIER: carrier,
    YNX_VIDEO_CARRIER_SHA256: sha,
    YNX_VIDEO_SOURCE_COMMIT: source,
    YNX_VIDEO_RECEIPT: receipt,
    YNX_VIDEO_VIEWER_PORT: "6494",
    YNX_VIDEO_API_PORT: "6493",
    YNX_VIDEO_CREATOR_PORT: "6495"
  };
  const executor = join(videoRoot, "scripts/video-runtime-executor.sh");
  execFileSync("bash", [executor, "deploy"], {env});
  assert.equal(readlinkSync(join(root, "current")), join(releases, `ynx-video-${source}`));
  assert.deepEqual(readFileSync(join(fixture, "api-state")), apiBefore);
  assert.deepEqual(readFileSync(join(fixture, "creator-state")), creatorBefore);
  execFileSync("bash", [executor, "rollback"], {env});
  assert.equal(readlinkSync(join(root, "current")), join(releases, "old-release"));
  assert.deepEqual(readFileSync(join(fixture, "api-state")), apiBefore);
  assert.deepEqual(readFileSync(join(fixture, "creator-state")), creatorBefore);
  assert.equal(readFileSync(join(fixture, "restart-log"), "utf8"), "restart-viewer-only\nrestart-viewer-only\n");
});

test("executor refuses the shared Video current path", () => {
  assert.throws(() => execFileSync("bash", [join(videoRoot, "scripts/video-runtime-executor.sh"), "deploy"], {
    env: {
      ...process.env,
      YNX_VIDEO_EXECUTION_MODE: "fixture",
      YNX_VIDEO_VIEWER_ROOT: "/opt/ynx-video/current",
      YNX_VIDEO_RELEASE_ID: `ynx-video-${"a".repeat(40)}`,
      YNX_VIDEO_CARRIER: "/tmp/absent",
      YNX_VIDEO_CARRIER_SHA256: "b".repeat(64),
      YNX_VIDEO_SOURCE_COMMIT: "a".repeat(40),
      YNX_VIDEO_RECEIPT: "/tmp/absent-receipt"
    },
    stdio: "pipe"
  }));
});
