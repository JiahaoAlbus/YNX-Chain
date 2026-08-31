import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync, readlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";
import {once} from "node:events";
import {spawn} from "node:child_process";

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

test("post-P0-239 recovery baseline freezes exact legacy rollback and isolated successor topology", () => {
  const baseline = JSON.parse(readFileSync(join(videoRoot, "runtime/post-p0239-recovery-baseline.json"), "utf8"));
  assert.equal(baseline.centralRecovery.commit, "d257e91941542ed83a67d253cdb85fec8711a001");
  assert.equal(baseline.centralRecovery.nonReusable, true);
  assert.equal(baseline.legacyViewer.sourceCommit, "e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833");
  assert.equal(baseline.legacyViewer.carrierSha256, "6771deb82ccc62a9c14d62ed40e7bda961806ffe3c14681b9cf53ec27afef2df");
  assert.equal(baseline.legacyViewer.sharedCurrentTarget, "/opt/ynx-video/releases/p0205-creator-studio-0e1a53c5");
  assert.equal(baseline.isolatedSuccessor.root, "/opt/ynx-video-viewer-wallet");
  assert.equal(baseline.isolatedSuccessor.viewerPort, 6494);
  assert.equal(baseline.isolatedSuccessor.apiPortPreserved, 6493);
  assert.equal(baseline.isolatedSuccessor.creatorPortPreserved, 6495);
  assert.equal(baseline.isolatedSuccessor.sharedCurrentMutationAllowed, false);
  assert.equal(baseline.isolatedSuccessor.caddyMutationAllowed, false);
  assert.deepEqual(baseline.legacyRecoveryRemoteArgv.slice(-2), ["/var/tmp/ynx-video-legacy-viewer-emergency-recovery.sh", "recover"]);
  assert.equal(baseline.truthBoundary.sourceArtifactFixtureOnly, true);
});

test("self-contained server serves the public /video path without a shared release symlink", async () => {
  const port = 16000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [join(videoRoot, "server.mjs")], {
    cwd: videoRoot,
    env: {...process.env, PORT: String(port)},
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("server readiness timeout")), 3000))
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/video/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /YNX Video/);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});

test("runtime carrier rebuild is byte-identical and normalized", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).trim();
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-build-"));
  const first = join(temp, "first.tar.gz");
  const second = join(temp, "second.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, first], {cwd: repoRoot});
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, second], {cwd: repoRoot});
  assert.deepEqual(readFileSync(first), readFileSync(second));
  const listing = execFileSync("gtar", ["-tvzf", first, "--numeric-owner", "--full-time"], {
    encoding: "utf8",
    env: {...process.env, TZ: "UTC"}
  });
  for (const line of listing.trim().split("\n")) {
    assert.match(line, / 0\/0 /);
    assert.match(line, /1970-01-01 00:00:00/);
  }
  const names = execFileSync("gtar", ["-tzf", first], {encoding: "utf8"}).trim().split("\n");
  const secondNames = execFileSync("gtar", ["-tzf", second], {encoding: "utf8"}).trim().split("\n");
  assert.deepEqual(names, secondNames);
  assert.ok(names.includes("runtime/server.mjs"));
  assert.ok(names.includes("runtime/runtime-manifest.json"));
  assert.ok(names.includes("runtime/runtime/post-p0239-recovery-baseline.json"));

  const walletSource = execFileSync("gtar", ["-xOzf", first, "runtime/wallet-connection.js"], {encoding: "utf8"});
  const appSource = execFileSync("gtar", ["-xOzf", first, "runtime/app.js"], {encoding: "utf8"});
  assert.match(walletSource, /com\.ynx\.wallet/);
  assert.match(walletSource, /io\.metamask/);
  assert.match(walletSource, /\[250, 750, 1500\]/);
  assert.match(appSource, /accountsChanged/);
  assert.match(appSource, /chainChanged/);
  assert.match(appSource, /disconnect/);
  assert.match(appSource, /user-requested/);
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

test("post-switch Viewer failure automatically restores the exact predecessor and preserves API and Creator", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).trim();
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-auto-rollback-"));
  const root = join(temp, "viewer-root");
  const fixture = join(root, "fixture");
  const releases = join(root, "releases");
  const predecessor = join(releases, "p0239-e5ce-predecessor");
  mkdirSync(fixture, {recursive: true});
  mkdirSync(predecessor, {recursive: true});
  writeFileSync(join(predecessor, "index.html"), "p0239 legacy viewer\n");
  symlinkSync(predecessor, join(root, "current"));
  writeFileSync(join(fixture, "api-state"), "api-6493-stable\n");
  writeFileSync(join(fixture, "creator-state"), "creator-6495-stable\n");
  writeExecutable(join(fixture, "probe-api"), `#!/bin/sh\ncat '${join(fixture, "api-state")}'\n`);
  writeExecutable(join(fixture, "probe-creator"), `#!/bin/sh\ncat '${join(fixture, "creator-state")}'\n`);
  writeExecutable(join(fixture, "probe-viewer"), `#!/bin/sh\ncase "$(readlink '${join(root, "current")}')" in *ynx-video-${source}) exit 1;; esac\ncat '${join(root, "current", "index.html")}'\n`);
  writeExecutable(join(fixture, "restart-viewer"), `#!/bin/sh\nprintf 'restart-viewer-only\\n' >> '${join(fixture, "restart-log")}'\n`);

  const carrier = join(temp, "candidate.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, carrier], {cwd: repoRoot});
  const carrierSha = execFileSync("shasum", ["-a", "256", carrier], {encoding: "utf8"}).split(/\s+/)[0];
  const receipt = join(temp, "receipt.txt");
  const env = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_VIEWER_ROOT: root,
    YNX_VIDEO_RELEASE_ID: `ynx-video-${source}`,
    YNX_VIDEO_CARRIER: carrier,
    YNX_VIDEO_CARRIER_SHA256: carrierSha,
    YNX_VIDEO_SOURCE_COMMIT: source,
    YNX_VIDEO_RECEIPT: receipt,
    YNX_VIDEO_FIXTURE_CONTROL: fixture,
    YNX_VIDEO_VIEWER_PORT: "6494",
    YNX_VIDEO_API_PORT: "6493",
    YNX_VIDEO_CREATOR_PORT: "6495"
  };
  assert.throws(() => execFileSync("bash", [join(videoRoot, "scripts/video-runtime-executor.sh"), "deploy"], {env, stdio: "pipe"}));
  assert.equal(readlinkSync(join(root, "current")), predecessor);
  assert.equal(readFileSync(join(root, "current", "index.html"), "utf8"), "p0239 legacy viewer\n");
  assert.equal(readFileSync(join(fixture, "api-state"), "utf8"), "api-6493-stable\n");
  assert.equal(readFileSync(join(fixture, "creator-state"), "utf8"), "creator-6495-stable\n");
  assert.equal(existsSync(receipt), false);
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

function writeExecutable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

test("actual shell bootstrap creates an absent dedicated predecessor, supports switch rollback, and removes only its own state", () => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoRoot, encoding: "utf8"}).trim();
  const predecessor = "e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833";
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-bootstrap-"));
  const root = join(temp, "opt", "ynx-video-viewer-wallet");
  const shared = join(temp, "opt", "ynx-video", "current");
  const unitPath = join(temp, "etc", "systemd", "system", "ynx-video-viewer-wallet.service");
  const legacyUnit = join(temp, "etc", "systemd", "system", "ynx-video-viewer.service");
  const control = join(temp, "control");
  mkdirSync(shared, {recursive: true});
  mkdirSync(resolve(unitPath, ".."), {recursive: true});
  mkdirSync(control, {recursive: true});
  writeFileSync(join(shared, "sentinel"), "shared-current-untouched\n");
  writeFileSync(legacyUnit, "legacy-unit-untouched\n");
  writeFileSync(join(control, "api-state"), "api-6493-stable\n");
  writeFileSync(join(control, "creator-state"), "creator-6495-stable\n");
  writeExecutable(join(control, "probe-api"), `#!/bin/sh\ncat '${join(control, "api-state")}'\n`);
  writeExecutable(join(control, "probe-creator"), `#!/bin/sh\ncat '${join(control, "creator-state")}'\n`);
  writeExecutable(join(control, "probe-viewer"), `#!/bin/sh
count=0
test ! -f '${join(control, "viewer-probe-count")}' || count=$(cat '${join(control, "viewer-probe-count")}')
count=$((count + 1))
printf '%s\n' "$count" > '${join(control, "viewer-probe-count")}'
test "$count" -ge 3 || exit 1
test -f '${join(root, "current", "index.html")}'
cat '${join(root, "current", "index.html")}'
`);
  writeExecutable(join(control, "restart-viewer"), `#!/bin/sh\nprintf 'restart %s\\n' 'ynx-video-viewer-wallet.service' >> '${join(control, "systemctl.log")}'\n`);
  writeExecutable(join(control, "systemctl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(control, "systemctl.log")}'\nif test -f '${join(control, "fail-enable")}' && test "$1" = enable; then exit 1; fi\n`);

  const predecessorCarrier = join(temp, "predecessor.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-predecessor-runtime.sh"), predecessorCarrier], {cwd: repoRoot});
  const predecessorSha = execFileSync("shasum", ["-a", "256", predecessorCarrier], {encoding: "utf8"}).split(/\s+/)[0];
  const receipt = join(temp, "bootstrap-receipt.txt");
  const unitTemplate = join(videoRoot, "runtime", "ynx-video-viewer-wallet.service");
  const unitTemplateSha = execFileSync("shasum", ["-a", "256", unitTemplate], {encoding: "utf8"}).split(/\s+/)[0];
  const bootstrapEnv = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_VIEWER_ROOT: root,
    YNX_VIDEO_VIEWER_UNIT: "ynx-video-viewer-wallet.service",
    YNX_VIDEO_VIEWER_UNIT_PATH: unitPath,
    YNX_VIDEO_PREDECESSOR_RELEASE_ID: `ynx-video-predecessor-${predecessor}`,
    YNX_VIDEO_PREDECESSOR_CARRIER: predecessorCarrier,
    YNX_VIDEO_PREDECESSOR_CARRIER_SHA256: predecessorSha,
    YNX_VIDEO_PREDECESSOR_SOURCE_COMMIT: predecessor,
    YNX_VIDEO_BOOTSTRAP_RECEIPT: receipt,
    YNX_VIDEO_UNIT_TEMPLATE: unitTemplate,
    YNX_VIDEO_UNIT_TEMPLATE_SHA256: unitTemplateSha,
    YNX_VIDEO_FIXTURE_CONTROL: control,
    YNX_VIDEO_VIEWER_PROBE_ATTEMPTS: "5",
    YNX_VIDEO_VIEWER_PROBE_DELAY_SECONDS: "0.01"
  };
  const bootstrap = join(videoRoot, "scripts/video-runtime-bootstrap.sh");
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(unitPath), false);
  execFileSync("bash", [bootstrap, "bootstrap"], {env: bootstrapEnv});
  assert.equal(readFileSync(join(control, "viewer-probe-count"), "utf8"), "3\n");
  const predecessorRelease = join(root, "releases", `ynx-video-predecessor-${predecessor}`);
  assert.equal(readlinkSync(join(root, "current")), predecessorRelease);
  assert.equal(execFileSync("shasum", ["-a", "256", join(root, "current", "index.html")], {encoding: "utf8"}).split(/\s+/)[0], "5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a");
  assert.match(readFileSync(unitPath, "utf8"), /ynx-video-viewer-wallet\/current\/server\.mjs/);

  const candidateCarrier = join(temp, "candidate.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-runtime.sh"), source, candidateCarrier], {cwd: repoRoot});
  const candidateSha = execFileSync("shasum", ["-a", "256", candidateCarrier], {encoding: "utf8"}).split(/\s+/)[0];
  const deployReceipt = join(temp, "deploy-receipt.txt");
  const deployEnv = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_VIEWER_ROOT: root,
    YNX_VIDEO_RELEASE_ID: `ynx-video-${source}`,
    YNX_VIDEO_CARRIER: candidateCarrier,
    YNX_VIDEO_CARRIER_SHA256: candidateSha,
    YNX_VIDEO_SOURCE_COMMIT: source,
    YNX_VIDEO_RECEIPT: deployReceipt,
    YNX_VIDEO_FIXTURE_CONTROL: control,
    YNX_VIDEO_VIEWER_PORT: "6494",
    YNX_VIDEO_API_PORT: "6493",
    YNX_VIDEO_CREATOR_PORT: "6495"
  };
  const executor = join(videoRoot, "scripts/video-runtime-executor.sh");
  execFileSync("bash", [executor, "deploy"], {env: deployEnv});
  assert.equal(readlinkSync(join(root, "current")), join(root, "releases", `ynx-video-${source}`));
  execFileSync("bash", [executor, "rollback"], {env: deployEnv});
  assert.equal(readlinkSync(join(root, "current")), predecessorRelease);
  assert.equal(execFileSync("shasum", ["-a", "256", join(root, "current", "index.html")], {encoding: "utf8"}).split(/\s+/)[0], "5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a");

  // The candidate is deliberately retained by the deploy executor. Remove only that fixture release
  // before exercising bootstrap rollback, matching the production bootstrap lease boundary.
  execFileSync("find", [join(root, "releases", `ynx-video-${source}`), "-depth", "-delete"]);
  execFileSync("bash", [bootstrap, "rollback-bootstrap"], {env: bootstrapEnv});
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(unitPath), false);
  assert.equal(readFileSync(join(shared, "sentinel"), "utf8"), "shared-current-untouched\n");
  assert.equal(readFileSync(legacyUnit, "utf8"), "legacy-unit-untouched\n");
  assert.equal(readFileSync(join(control, "api-state"), "utf8"), "api-6493-stable\n");
  assert.equal(readFileSync(join(control, "creator-state"), "utf8"), "creator-6495-stable\n");
  assert.doesNotMatch(readFileSync(join(control, "systemctl.log"), "utf8"), /(^|\s)ynx-video-viewer\.service(\s|$)/m);
});

test("failed first bootstrap returns dedicated root and unit to exact absence", () => {
  const predecessor = "e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833";
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-bootstrap-failure-"));
  const root = join(temp, "viewer-root");
  const unitPath = join(temp, "systemd", "ynx-video-viewer-wallet.service");
  const control = join(temp, "control");
  mkdirSync(resolve(unitPath, ".."), {recursive: true});
  mkdirSync(control, {recursive: true});
  for (const role of ["api", "creator"]) writeExecutable(join(control, `probe-${role}`), `#!/bin/sh\nprintf '${role}-stable\\n'\n`);
  writeExecutable(join(control, "probe-viewer"), "#!/bin/sh\nexit 1\n");
  writeFileSync(join(control, "fail-enable"), "true\n");
  writeExecutable(join(control, "systemctl"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${join(control, "systemctl.log")}'\nif test "$1" = enable; then exit 1; fi\n`);
  const carrier = join(temp, "predecessor.tar.gz");
  execFileSync("bash", [join(videoRoot, "scripts/build-predecessor-runtime.sh"), carrier], {cwd: repoRoot});
  const sha = execFileSync("shasum", ["-a", "256", carrier], {encoding: "utf8"}).split(/\s+/)[0];
  const unitTemplate = join(videoRoot, "runtime", "ynx-video-viewer-wallet.service");
  const unitTemplateSha = execFileSync("shasum", ["-a", "256", unitTemplate], {encoding: "utf8"}).split(/\s+/)[0];
  const env = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_VIEWER_ROOT: root,
    YNX_VIDEO_VIEWER_UNIT: "ynx-video-viewer-wallet.service",
    YNX_VIDEO_VIEWER_UNIT_PATH: unitPath,
    YNX_VIDEO_PREDECESSOR_RELEASE_ID: `ynx-video-predecessor-${predecessor}`,
    YNX_VIDEO_PREDECESSOR_CARRIER: carrier,
    YNX_VIDEO_PREDECESSOR_CARRIER_SHA256: sha,
    YNX_VIDEO_PREDECESSOR_SOURCE_COMMIT: predecessor,
    YNX_VIDEO_BOOTSTRAP_RECEIPT: join(temp, "receipt"),
    YNX_VIDEO_UNIT_TEMPLATE: unitTemplate,
    YNX_VIDEO_UNIT_TEMPLATE_SHA256: unitTemplateSha,
    YNX_VIDEO_FIXTURE_CONTROL: control
  };
  assert.throws(() => execFileSync("bash", [join(videoRoot, "scripts/video-runtime-bootstrap.sh"), "bootstrap"], {env, stdio: "pipe"}));
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(unitPath), false);
  const log = readFileSync(join(control, "systemctl.log"), "utf8");
  assert.match(log, /enable --now ynx-video-viewer-wallet\.service/);
  assert.match(log, /stop ynx-video-viewer-wallet\.service/);
  assert.match(log, /disable ynx-video-viewer-wallet\.service/);
  assert.doesNotMatch(log, /(^|\s)ynx-video-viewer\.service(\s|$)/m);
});
