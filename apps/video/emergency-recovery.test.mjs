import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const video = resolve(import.meta.dirname);
function executable(path, body) { writeFileSync(path, body); chmodSync(path, 0o755); }

function fixture(failViewer = false) {
  const temp = mkdtempSync(join(tmpdir(), "ynx-video-emergency-"));
  const target = join(temp, "releases", "p0205-creator-studio-0e1a53c5");
  const current = join(temp, "current");
  const control = join(temp, "control");
  mkdirSync(join(target, "apps"), {recursive: true}); mkdirSync(control);
  symlinkSync(target, current);
  const carrier = join(temp, "predecessor.tar.gz");
  execFileSync("bash", [join(video, "scripts/build-predecessor-runtime.sh"), carrier], {cwd: root});
  const sha = execFileSync("shasum", ["-a", "256", carrier], {encoding: "utf8"}).split(/\s+/)[0];
  const unit = join(temp, "viewer.service"); const caddy = join(temp, "Caddyfile");
  writeFileSync(unit, "unit\n"); writeFileSync(caddy, "caddy\n");
  executable(join(control, "stat-tuple"), "#!/bin/sh\nprintf 'fixed\\n'\n");
  executable(join(control, "systemctl"), `#!/bin/sh
printf '%s\n' "$*" >> '${join(control, "systemctl.log")}'
test "$1" != show || { test "$4" = MainPID && printf '4242\n' || printf '0\n'; }
`);
  executable(join(control, "probe"), `#!/bin/sh
case "$1" in api) printf api-stable;; creator) printf creator-stable;; viewer) ${failViewer ? "exit 1" : `cat '${join(target, "apps/video/index.html")}'`};; esac
`);
  return {temp, target, current, control, carrier, env: {...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture", YNX_VIDEO_SHARED_CURRENT: current, YNX_VIDEO_SHARED_TARGET: target,
    YNX_VIDEO_SHARED_LINK_TUPLE: "fixed", YNX_VIDEO_SHARED_TARGET_TUPLE: "fixed", YNX_VIDEO_SHARED_APPS_TUPLE: "fixed",
    YNX_VIDEO_PREDECESSOR_CARRIER: carrier, YNX_VIDEO_PREDECESSOR_CARRIER_SHA256: sha,
    YNX_VIDEO_LEGACY_UNIT: "ynx-video-viewer.service", YNX_VIDEO_LEGACY_UNIT_PATH: unit,
    YNX_VIDEO_LEGACY_UNIT_SHA256: execFileSync("shasum", ["-a", "256", unit], {encoding:"utf8"}).split(/\s+/)[0],
    YNX_VIDEO_CADDY_PATH: caddy, YNX_VIDEO_CADDY_SHA256: execFileSync("shasum", ["-a", "256", caddy], {encoding:"utf8"}).split(/\s+/)[0],
    YNX_VIDEO_RECOVERY_RECEIPT: join(temp, "receipt"), YNX_VIDEO_FIXTURE_CONTROL: control
  }};
}

test("emergency recovery atomically restores only legacy apps/video", () => {
  const f = fixture();
  execFileSync("bash", [join(video, "scripts/video-legacy-viewer-emergency-recovery.sh"), "recover"], {env:f.env});
  assert.equal(existsSync(join(f.target, "apps/video/server.mjs")), true);
  assert.match(readFileSync(join(f.temp, "receipt"), "utf8"), /recovered=true/);
  assert.match(readFileSync(join(f.control, "systemctl.log"), "utf8"), /reset-failed ynx-video-viewer\.service\nstart ynx-video-viewer\.service/);
});

test("failed emergency recovery removes only the exact new subtree", () => {
  const f = fixture(true);
  assert.throws(() => execFileSync("bash", [join(video, "scripts/video-legacy-viewer-emergency-recovery.sh"), "recover"], {env:f.env, stdio:"pipe"}));
  assert.equal(existsSync(join(f.target, "apps/video")), false);
  assert.equal(existsSync(join(f.temp, "receipt")), false);
});
