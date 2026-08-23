import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const videoRoot = resolve(import.meta.dirname);
const takeover = join(videoRoot, "scripts/video-runtime-controlled-takeover.sh");

function executable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function sha(body) {
  return execFileSync("shasum", ["-a", "256"], {input: body, encoding: "utf8"}).split(/\s+/)[0];
}

function fixture(failure = "none") {
  const dir = mkdtempSync(join(tmpdir(), "ynx-video-takeover-"));
  const control = join(dir, "control");
  mkdirSync(control);
  const oldViewer = "legacy-viewer-exact\n";
  const bodies = {
    "api-root": "api-root-exact\n",
    "api-health": "api-health-exact\n",
    "api-version": "api-version-exact\n",
    "creator-root": "creator-root-exact\n",
    "creator-manifest": "creator-manifest-exact\n",
    "creator-catalog": "creator-catalog-exact\n"
  };
  writeFileSync(join(control, "legacy-active"), "yes\n");
  writeFileSync(join(control, "failure"), failure);
  for (const [name, body] of Object.entries(bodies)) writeFileSync(join(control, name), body);
  writeFileSync(join(control, "old-viewer"), oldViewer);
  writeFileSync(join(control, "caddy"), "caddy-exact");
  const legacyUnit = join(dir, "ynx-video-viewer.service");
  const sharedCurrent = join(dir, "shared-current");
  writeFileSync(legacyUnit, "legacy unit exact\n");
  writeFileSync(sharedCurrent, "shared current exact\n");
  const baseline = join(dir, "legacy-baseline.txt");
  const stable = [
    "load_state=loaded",
    "active_state=active",
    "sub_state=running",
    `fragment_path=${legacyUnit}`,
    "exec_start=/usr/bin/node /opt/ynx-video/current/apps/video/server.mjs",
    "main_pid=789902",
    "nrestarts=0",
    "unit_file_state=enabled",
    "pid_exe=/usr/bin/node",
    "pid_cwd=/opt/ynx-video/current",
    `pid_cmdline_sha256=${"a".repeat(64)}`,
    "pid_starttime=123456",
    "legacy_unit_tuple=64770:161341:0:0:600:1:337:regular file",
    `legacy_unit_sha256=${sha("legacy unit exact\n")}`,
    "shared_current_target=/opt/ynx-video/releases/legacy",
    "shared_current_lstat=64770:1324617:0:0:777:1:53:symbolic link"
  ].join("\n") + "\n";
  writeFileSync(baseline, stable);
  executable(join(control, "legacy-snapshot"), `#!/bin/sh
test -f '${join(control, "legacy-active")}' || exit 1
pid=789902; start=123456
if test -f '${join(control, "legacy-restarted")}'; then pid=789903; start=123999; fi
sed -e "s/^main_pid=.*/main_pid=$pid/" -e "s/^pid_starttime=.*/pid_starttime=$start/" '${baseline}'
`);
  executable(join(control, "systemctl"), `#!/bin/sh
printf '%s\n' "$*" >> '${join(control, "systemctl.log")}'
failure=$(cat '${join(control, "failure")}')
case "$1:$2" in
  stop:ynx-video-viewer.service)
    test "$failure" = stop && exit 1
    rm -f '${join(control, "legacy-active")}' ;;
  start:ynx-video-viewer.service)
    touch '${join(control, "legacy-active")}' '${join(control, "legacy-restarted")}' ;;
  is-active:--quiet)
    unit=$3
    if test "$unit" = ynx-video-viewer.service; then test -f '${join(control, "legacy-active")}'; else test -f '${join(control, "dedicated-active")}'; fi ;;
esac
`);
  executable(join(control, "port-6494-free"), `#!/bin/sh
test "$(cat '${join(control, "failure")}')" != port || exit 1
test ! -f '${join(control, "legacy-active")}' && test ! -f '${join(control, "dedicated-active")}'
`);
  for (const name of Object.keys(bodies)) executable(join(control, `probe-${name}`), `#!/bin/sh
cat '${join(control, name)}'
`);
  executable(join(control, "probe-viewer"), `#!/bin/sh
test -f '${join(control, "legacy-active")}' -o -f '${join(control, "dedicated-active")}' || exit 1
if test -f '${join(control, "dedicated-active")}' && test "$(cat '${join(control, "failure")}')" = post; then printf 'wrong-viewer\n'; else cat '${join(control, "old-viewer")}'; fi
`);
  executable(join(control, "caddy-snapshot"), `#!/bin/sh
cat '${join(control, "caddy")}'
`);
  const bootstrap = join(dir, "bootstrap.sh");
  const bootstrapReceipt = join(dir, "bootstrap-receipt.txt");
  const dedicatedRoot = join(dir, "dedicated-root");
  const dedicatedUnitPath = join(dir, "dedicated-unit.service");
  executable(bootstrap, `#!/bin/sh
printf '%s\n' "$1" >> '${join(control, "bootstrap.log")}'
case "$1" in
  bootstrap)
    test "$(cat '${join(control, "failure")}')" != bootstrap || exit 1
    mkdir '${dedicatedRoot}'
    touch '${dedicatedUnitPath}' '${bootstrapReceipt}' '${join(control, "dedicated-active")}' ;;
  rollback-bootstrap) rm -f '${join(control, "dedicated-active")}' '${dedicatedUnitPath}' '${bootstrapReceipt}'; rmdir '${dedicatedRoot}' ;;
esac
`);
  const receipt = join(dir, "takeover-receipt.txt");
  const env = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_FIXTURE_CONTROL: control,
    YNX_VIDEO_LEGACY_UNIT: "ynx-video-viewer.service",
    YNX_VIDEO_VIEWER_UNIT: "ynx-video-viewer-wallet.service",
    YNX_VIDEO_LEGACY_SNAPSHOT_EXPECTED: baseline,
    YNX_VIDEO_LEGACY_UNIT_PATH: legacyUnit,
    YNX_VIDEO_SHARED_CURRENT: sharedCurrent,
    YNX_VIDEO_LEGACY_VIEWER_SHA256: sha(oldViewer),
    YNX_VIDEO_LEGACY_VIEWER_BYTES: String(Buffer.byteLength(oldViewer)),
    ...Object.fromEntries(Object.entries(bodies).flatMap(([name, body]) => {
      const upper = name.toUpperCase().replaceAll("-", "_");
      return [[`YNX_VIDEO_${upper}_SHA256`, sha(body)], [`YNX_VIDEO_${upper}_BYTES`, String(Buffer.byteLength(body))]];
    })),
    YNX_VIDEO_CADDY_SHA256: "caddy-exact",
    YNX_VIDEO_TAKEOVER_RECEIPT: receipt,
    YNX_VIDEO_BOOTSTRAP_SCRIPT: bootstrap,
    YNX_VIDEO_BOOTSTRAP_RECEIPT: bootstrapReceipt,
    YNX_VIDEO_VIEWER_ROOT: dedicatedRoot,
    YNX_VIDEO_VIEWER_UNIT_PATH: dedicatedUnitPath,
    YNX_VIDEO_TAKEOVER_LOCK: join(dir, "takeover.lock")
  };
  return {dir, control, baseline, receipt, env};
}

test("controlled takeover freezes predecessor, switches once, and restores a verified legacy successor", () => {
  const f = fixture();
  execFileSync("bash", [takeover, "takeover"], {env: f.env});
  assert.equal(existsSync(join(f.control, "legacy-active")), false);
  assert.equal(existsSync(join(f.control, "dedicated-active")), true);
  assert.match(readFileSync(`${f.receipt}.complete`, "utf8"), /controlled_takeover_complete=true/);
  execFileSync("bash", [takeover, "restore-legacy"], {env: f.env});
  assert.equal(existsSync(join(f.control, "legacy-active")), true);
  assert.equal(existsSync(join(f.control, "dedicated-active")), false);
  assert.match(readFileSync(`${f.receipt}.complete`, "utf8"), /restored_legacy=true/);
  assert.match(readFileSync(join(f.control, "systemctl.log"), "utf8"), /stop ynx-video-viewer\.service/);
  assert.match(readFileSync(join(f.control, "systemctl.log"), "utf8"), /start ynx-video-viewer\.service/);
});

for (const stage of ["stop", "port", "bootstrap", "post"]) {
  test(`controlled takeover failure at ${stage} preserves or restores exact legacy service`, () => {
    const f = fixture(stage);
    assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
    assert.equal(existsSync(join(f.control, "legacy-active")), true);
    assert.equal(existsSync(join(f.control, "dedicated-active")), false);
    if (stage !== "stop") assert.match(readFileSync(f.receipt, "utf8"), /failure_recovered_legacy=true/);
  });
}

test("controlled takeover lock rejects a concurrent executor before service mutation", () => {
  const f = fixture();
  mkdirSync(`${f.env.YNX_VIDEO_TAKEOVER_LOCK}.d`);
  assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
  assert.equal(existsSync(join(f.control, "legacy-active")), true);
  assert.equal(existsSync(join(f.control, "dedicated-active")), false);
  assert.equal(existsSync(f.receipt), false);
});
