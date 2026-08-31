import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const videoRoot = resolve(import.meta.dirname);
const takeover = join(videoRoot, "scripts/video-runtime-controlled-takeover.sh");
const retainedGuard = join(videoRoot, "scripts/video-retained-evidence-guard.mjs");
const retainedNames = [
  "video-legacy-viewer-emergency-recovery.receipt",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.expected",
  "video-viewer-wallet-controlled-takeover-3b1a062b.receipt.legacy.successor.stable"
];

function executable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function sha(body) {
  return execFileSync("shasum", ["-a", "256"], {input: body, encoding: "utf8"}).split(/\s+/)[0];
}

function statTuple(path) {
  const value = statSync(path);
  return `${value.dev}:${value.ino}:${value.uid}:${value.gid}:${(value.mode & 0o777).toString(8)}:${value.nlink}`;
}

function inventoryObject(path, includeSha = false) {
  const value = lstatSync(path);
  const kind = value.isDirectory() ? "directory" : value.isFile() ? "regular file" : value.isSymbolicLink() ? "symbolic link" : "unsupported";
  const object = {path, tuple: `${value.dev}:${value.ino}:${value.uid}:${value.gid}:${(value.mode & 0o777).toString(8)}:${value.nlink}:${value.size}:${kind}`};
  if (includeSha) object.sha256 = execFileSync("shasum", ["-a", "256", path], {encoding: "utf8"}).split(/\s+/)[0];
  return object;
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
  executable(join(control, "curl"), `#!/bin/sh
url=$1
printf '%s\n' "$url" >> '${join(control, "curl.log")}'
case "$url" in
  http://127.0.0.1:6494/)
    test -f '${join(control, "legacy-active")}' -o -f '${join(control, "dedicated-active")}' || exit 1
    if test -f '${join(control, "dedicated-active")}' && test "$(cat '${join(control, "failure")}')" = post; then printf 'wrong-viewer\n'; else cat '${join(control, "old-viewer")}'; fi ;;
  http://127.0.0.1:6493/) cat '${join(control, "api-root")}' ;;
  http://127.0.0.1:6493/health) cat '${join(control, "api-health")}' ;;
  http://127.0.0.1:6493/version) cat '${join(control, "api-version")}' ;;
  http://127.0.0.1:6495/) cat '${join(control, "creator-root")}' ;;
  http://127.0.0.1:6495/creator-studio.manifest.json) cat '${join(control, "creator-manifest")}' ;;
  http://127.0.0.1:6495/i18n/catalog.json) cat '${join(control, "creator-catalog")}' ;;
  *) echo "unexpected production probe URL: $url" >&2; exit 64 ;;
esac
`);
  executable(join(control, "caddy-snapshot"), `#!/bin/sh
cat '${join(control, "caddy")}'
`);
  const bootstrap = join(dir, "bootstrap.sh");
  const receiptContainer = join(dir, "var-lib");
  const retainedParent = join(receiptContainer, "ynx-video-viewer-wallet-evidence");
  const retainedIdentity = `${retainedParent}.identity`;
  const receiptParent = join(receiptContainer, "ynx-video-viewer-wallet-evidence-560c467d");
  mkdirSync(receiptContainer);
  writeFileSync(join(receiptContainer, "unrelated-sibling"), "preserve me\n");
  mkdirSync(retainedParent);
  writeFileSync(retainedIdentity, "retained-parent-identity\n");
  retainedNames.forEach((name, index) => writeFileSync(join(retainedParent, name), `retained-${index}\n`));
  const retainedInventory = join(dir, "retained-inventory.json");
  writeFileSync(retainedInventory, `${JSON.stringify({
    schemaVersion: "ynx-video-retained-evidence-inventory/1",
    parent: inventoryObject(retainedParent),
    identity: inventoryObject(retainedIdentity, true),
    children: retainedNames.map((name) => ({name, ...inventoryObject(join(retainedParent, name), true)}))
  }, null, 2)}\n`);
  const bootstrapReceipt = join(receiptParent, "bootstrap-receipt.txt");
  const dedicatedRoot = join(dir, "dedicated-root");
  const dedicatedUnitPath = join(dir, "dedicated-unit.service");
  executable(bootstrap, `#!/bin/sh
printf '%s:%s\n' "$YNX_VIDEO_LEASE_AUTHORIZED" "$1" >> '${join(control, "bootstrap.log")}'
test "$YNX_VIDEO_LEASE_AUTHORIZED" = P0_VIDEO_BOOTSTRAP_SINGLE_USE || exit 77
case "$1" in
  bootstrap)
    test "$(cat '${join(control, "failure")}')" != bootstrap || exit 1
    mkdir '${dedicatedRoot}'
    touch '${dedicatedUnitPath}' '${bootstrapReceipt}' '${join(control, "dedicated-active")}' ;;
  rollback-bootstrap) rm -f '${join(control, "dedicated-active")}' '${dedicatedUnitPath}' '${bootstrapReceipt}'; rmdir '${dedicatedRoot}' ;;
esac
`);
  const receipt = join(receiptParent, "takeover-receipt.txt");
  const env = {
    ...process.env,
    YNX_VIDEO_EXECUTION_MODE: "fixture",
    YNX_VIDEO_LEASE_AUTHORIZED: "P0_VIDEO_CONTROLLED_TAKEOVER_SINGLE_USE",
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
    YNX_VIDEO_RECEIPT_PARENT: receiptParent,
    YNX_VIDEO_RECEIPT_CONTAINER: receiptContainer,
    YNX_VIDEO_RECEIPT_CONTAINER_EXPECTED: statTuple(receiptContainer),
    YNX_VIDEO_RECEIPT_UID: String(process.getuid()),
    YNX_VIDEO_RECEIPT_GID: String(process.getgid()),
    YNX_VIDEO_RECEIPT_MODE: "755",
    YNX_VIDEO_RETAINED_EVIDENCE_PARENT: retainedParent,
    YNX_VIDEO_RETAINED_EVIDENCE_IDENTITY: retainedIdentity,
    YNX_VIDEO_RETAINED_EVIDENCE_INVENTORY: retainedInventory,
    YNX_VIDEO_RETAINED_EVIDENCE_INVENTORY_SHA256: execFileSync("shasum", ["-a", "256", retainedInventory], {encoding: "utf8"}).split(/\s+/)[0],
    YNX_VIDEO_RETAINED_EVIDENCE_GUARD: retainedGuard,
    YNX_VIDEO_RETAINED_EVIDENCE_GUARD_SHA256: execFileSync("shasum", ["-a", "256", retainedGuard], {encoding: "utf8"}).split(/\s+/)[0],
    YNX_VIDEO_BOOTSTRAP_SCRIPT: bootstrap,
    YNX_VIDEO_BOOTSTRAP_RECEIPT: bootstrapReceipt,
    YNX_VIDEO_VIEWER_ROOT: dedicatedRoot,
    YNX_VIDEO_VIEWER_UNIT_PATH: dedicatedUnitPath,
    YNX_VIDEO_TAKEOVER_LOCK: join(dir, "takeover.lock")
  };
  return {dir, control, baseline, receipt, receiptContainer, receiptParent, retainedParent, retainedIdentity, retainedInventory, env};
}

function assertRetainedPresent(f) {
  assert.equal(existsSync(f.retainedParent), true);
  assert.equal(existsSync(f.retainedIdentity), true);
  for (const name of retainedNames) assert.equal(existsSync(join(f.retainedParent, name)), true, `${name} must remain present`);
}

test("controlled takeover freezes predecessor, switches once, and restores a verified legacy successor", () => {
  const f = fixture();
  execFileSync("bash", [takeover, "takeover"], {env: f.env});
  assert.equal(existsSync(join(f.control, "legacy-active")), false);
  assert.equal(existsSync(join(f.control, "dedicated-active")), true);
  assert.match(readFileSync(`${f.receipt}.complete`, "utf8"), /controlled_takeover_complete=true/);
  assert.equal(existsSync(f.receiptParent), true);
  execFileSync("bash", [takeover, "restore-legacy"], {env: f.env});
  assert.equal(existsSync(join(f.control, "legacy-active")), true);
  assert.equal(existsSync(join(f.control, "dedicated-active")), false);
  assert.equal(existsSync(f.receiptParent), false);
  assert.equal(existsSync(`${f.receiptParent}.identity`), false);
  assertRetainedPresent(f);
  assert.equal(readFileSync(join(f.receiptContainer, "unrelated-sibling"), "utf8"), "preserve me\n");
  assert.match(readFileSync(join(f.control, "systemctl.log"), "utf8"), /stop ynx-video-viewer\.service/);
  assert.match(readFileSync(join(f.control, "systemctl.log"), "utf8"), /start ynx-video-viewer\.service/);
  assert.equal(
    readFileSync(join(f.control, "bootstrap.log"), "utf8"),
    "P0_VIDEO_BOOTSTRAP_SINGLE_USE:bootstrap\nP0_VIDEO_BOOTSTRAP_SINGLE_USE:rollback-bootstrap\n"
  );
  const urls = readFileSync(join(f.control, "curl.log"), "utf8");
  assert.match(urls, /^http:\/\/127\.0\.0\.1:6495\/creator-studio\.manifest\.json$/m);
  assert.doesNotMatch(urls, /\/release-manifest\.json/);
});

for (const stage of ["stop", "port", "bootstrap", "post"]) {
  test(`controlled takeover failure at ${stage} preserves or restores exact legacy service`, () => {
    const f = fixture(stage);
    assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
    assert.equal(existsSync(join(f.control, "legacy-active")), true);
    assert.equal(existsSync(join(f.control, "dedicated-active")), false);
    assert.equal(existsSync(f.receiptParent), false);
    assert.equal(existsSync(`${f.receiptParent}.identity`), false);
    assertRetainedPresent(f);
    assert.equal(readFileSync(join(f.receiptContainer, "unrelated-sibling"), "utf8"), "preserve me\n");
  });
}

test("controlled takeover lock rejects a concurrent executor before service mutation", () => {
  const f = fixture();
  mkdirSync(`${f.env.YNX_VIDEO_TAKEOVER_LOCK}.d`);
  assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
  assert.equal(existsSync(join(f.control, "legacy-active")), true);
  assert.equal(existsSync(join(f.control, "dedicated-active")), false);
  assert.equal(existsSync(f.receipt), false);
  assert.equal(existsSync(f.receiptParent), false);
  rmSync(`${f.env.YNX_VIDEO_TAKEOVER_LOCK}.d`, {recursive: true});

  mkdirSync(f.receiptParent);
  writeFileSync(`${f.receiptParent}.identity`, "substituted\n");
  assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
  assert.equal(existsSync(join(f.control, "legacy-active")), true);
  assert.equal(existsSync(f.receiptParent), true);
  assert.equal(readFileSync(join(f.receiptContainer, "unrelated-sibling"), "utf8"), "preserve me\n");
});

const retainedMutations = {
  "foreign sibling": (f) => writeFileSync(join(f.retainedParent, "foreign"), "foreign\n"),
  "same-byte replacement": (f) => {
    const target = join(f.retainedParent, retainedNames[1]);
    const body = readFileSync(target);
    rmSync(target); writeFileSync(target, body);
  },
  "symlink replacement": (f) => {
    const target = join(f.retainedParent, retainedNames[2]);
    rmSync(target); symlinkSync(join(f.retainedParent, retainedNames[0]), target);
  },
  "hardlink replacement": (f) => {
    const target = join(f.retainedParent, retainedNames[3]);
    rmSync(target); linkSync(join(f.retainedParent, retainedNames[0]), target);
  },
  "directory-only sibling": (f) => mkdirSync(join(f.retainedParent, "foreign-directory"))
};

for (const [label, mutate] of Object.entries(retainedMutations)) {
  test(`controlled takeover rejects retained evidence ${label} before lifecycle or deletion`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env: f.env, stdio: "pipe"}));
    assert.equal(existsSync(join(f.control, "systemctl.log")), false);
    assert.equal(existsSync(f.receiptParent), false);
    assertRetainedPresent(f);
  });
}

test("controlled takeover rejects a post-validation retained evidence race before lifecycle or receipt creation", () => {
  const f = fixture();
  const hook = join(f.dir, "retained-race-hook.sh");
  executable(hook, `#!/bin/sh\nprintf 'race\\n' > '${join(f.retainedParent, "post-validation-race")}'\n`);
  const env = {...f.env, YNX_VIDEO_FIXTURE_POST_RETAINED_VALIDATION_HOOK: hook};
  assert.throws(() => execFileSync("bash", [takeover, "takeover"], {env, stdio: "pipe"}));
  assert.equal(existsSync(join(f.control, "systemctl.log")), false);
  assert.equal(existsSync(f.receiptParent), false);
  assertRetainedPresent(f);
});
