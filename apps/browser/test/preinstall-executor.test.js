import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const browserRoot = resolve(import.meta.dirname, "..");
const executor = join(browserRoot, "scripts/browser-preinstall-executor.sh");
const executableRelative = "Contents/MacOS/YNXBrowserNative";
const sha = (path) => execFileSync("shasum", ["-a", "256", path], {encoding: "utf8"}).split(/\s+/)[0];
const inode = (path) => `${statSync(path).dev}:${statSync(path).ino}`;

function executable(path, body) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "ynx-browser-preinstall-"));
  const controls = join(temp, "controls");
  const oldCopies = join(temp, "old-copies");
  const oldHandler = join(oldCopies, "old-handler.app");
  const candidateSource = join(temp, "carrier-source", "YNX Browser Testnet Preview.app");
  const isolatedParent = join(temp, "applications");
  const isolatedRoot = join(isolatedParent, "YNX Browser Isolated");
  const target = join(isolatedRoot, "YNX Browser Testnet Preview-ad890f0a2fe5-aaed312ef608.app");
  mkdirSync(join(oldHandler, "Contents/MacOS"), {recursive: true});
  mkdirSync(join(candidateSource, "Contents/MacOS"), {recursive: true});
  mkdirSync(isolatedParent, {mode: 0o700});
  mkdirSync(controls, {recursive: true});
  writeFileSync(join(oldHandler, executableRelative), "old-handler-binary\n");
  writeFileSync(join(candidateSource, executableRelative), "reviewed-candidate-binary\n");
  for (let index = 0; index < 11; index += 1) {
    const copy = join(oldCopies, `old-copy-${index}.app`, "Contents/MacOS");
    mkdirSync(copy, {recursive: true});
    writeFileSync(join(copy, "YNXBrowserNative"), `old-copy-${index}\n`);
  }
  writeFileSync(join(controls, "handler"), oldHandler);
  writeFileSync(join(controls, "old-pid"), "93119\n");
  executable(join(controls, "lsregister"), `#!/bin/sh\nset -eu\nprintf '%s|%s\\n' "$1" "$2" >> '${join(controls, "operations")}'\nif [ "$1" = '-f' ]; then printf '%s' "$2" > '${join(controls, "handler")}'; fi\nif [ "$1" = '-u' ]; then : > '${join(controls, "handler")}'; fi\n`);
  executable(join(controls, "resolve-handler"), `#!/bin/sh\ncat '${join(controls, "handler")}'\n`);
  executable(join(controls, "process-absent"), "#!/bin/sh\nexit 0\n");
  const carrier = join(temp, "candidate.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", candidateSource, carrier]);
  const receipt = join(temp, "receipt.txt");
  const env = {
    ...process.env,
    YNX_BROWSER_EXECUTION_MODE: "fixture",
    YNX_BROWSER_FIXTURE_ROOT: controls,
    YNX_BROWSER_CARRIER: carrier,
    YNX_BROWSER_CARRIER_SHA256: sha(carrier),
    YNX_BROWSER_ISOLATED_TARGET: target,
    YNX_BROWSER_ISOLATED_ROOT: isolatedRoot,
    YNX_BROWSER_ISOLATED_ROOT_PREWRITE: "ABSENT_CREATE_ONE_DIRECTORY",
    YNX_BROWSER_ISOLATED_ROOT_PARENT: isolatedParent,
    YNX_BROWSER_ISOLATED_ROOT_PARENT_DEV_INODE: inode(isolatedParent),
    YNX_BROWSER_ISOLATED_ROOT_PARENT_UID: String(statSync(isolatedParent).uid),
    YNX_BROWSER_ISOLATED_ROOT_PARENT_GID: String(statSync(isolatedParent).gid),
    YNX_BROWSER_ISOLATED_ROOT_PARENT_MODE: (statSync(isolatedParent).mode & 0o777).toString(8),
    YNX_BROWSER_ISOLATED_ROOT_PARENT_NLINK: String(statSync(isolatedParent).nlink),
    YNX_BROWSER_ISOLATED_ROOT_UID: String(process.getuid()),
    YNX_BROWSER_ISOLATED_ROOT_GID: String(statSync(isolatedParent).gid),
    YNX_BROWSER_ISOLATED_ROOT_MODE: "700",
    YNX_BROWSER_ISOLATED_ROOT_NLINK: "2",
    YNX_BROWSER_CANDIDATE_BINARY_SHA256: sha(join(candidateSource, executableRelative)),
    YNX_BROWSER_OLD_HANDLER: oldHandler,
    YNX_BROWSER_OLD_HANDLER_DEV_INODE: inode(oldHandler),
    YNX_BROWSER_OLD_BINARY_SHA256: sha(join(oldHandler, executableRelative)),
    YNX_BROWSER_RECEIPT: receipt
  };
  return {temp, controls, oldCopies, oldHandler, isolatedParent, isolatedRoot, target, receipt, env};
}

function legacySnapshot(state) {
  const files = new Map([[join(state.oldHandler, executableRelative), readFileSync(join(state.oldHandler, executableRelative))]]);
  for (let index = 0; index < 11; index += 1) {
    const path = join(state.oldCopies, `old-copy-${index}.app`, executableRelative);
    files.set(path, readFileSync(path));
  }
  return {files, oldPid: readFileSync(join(state.controls, "old-pid"))};
}

function assertLegacyUnchanged(state, snapshot) {
  for (const [path, bytes] of snapshot.files) assert.deepEqual(readFileSync(path), bytes);
  assert.deepEqual(readFileSync(join(state.controls, "old-pid")), snapshot.oldPid);
}

test("forward and rollback only register candidate and restore exact old handler", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.target);
  assert.ok(existsSync(state.target));
  execFileSync("bash", [executor, "rollback"], {env: state.env});
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.oldHandler);
  assert.equal(existsSync(state.target), false);
  assert.equal(existsSync(state.isolatedRoot), false);
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\n-u|${state.target}\n-f|${state.oldHandler}\n`);
  assertLegacyUnchanged(state, legacy);
});

test("rollback rejects an isolated-root substitution before LaunchServices mutation", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  const originalRoot = `${state.isolatedRoot}.original`;
  renameSync(state.isolatedRoot, originalRoot);
  mkdirSync(state.isolatedRoot, {mode: 0o700});
  renameSync(join(originalRoot, "YNX Browser Testnet Preview-ad890f0a2fe5-aaed312ef608.app"), state.target);
  assert.throws(() => execFileSync("bash", [executor, "rollback"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\n`);
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.target);
  assertLegacyUnchanged(state, legacy);
});

test("rollback rejects an unexpected root entry before LaunchServices mutation", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  writeFileSync(join(state.isolatedRoot, "unexpected.txt"), "do-not-delete\n");
  assert.throws(() => execFileSync("bash", [executor, "rollback"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\n`);
  assert.ok(existsSync(join(state.isolatedRoot, "unexpected.txt")));
  assertLegacyUnchanged(state, legacy);
});

test("post-copy forward failure removes only the exact empty root it created", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  executable(join(state.controls, "resolve-handler"), `#!/bin/sh\nprintf '%s' '${state.oldHandler}'\n`);
  assert.throws(() => execFileSync("bash", [executor, "forward"], {env: state.env, stdio: "pipe"}));
  assert.equal(existsSync(state.target), false);
  assert.equal(existsSync(state.isolatedRoot), false);
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\n-u|${state.target}\n-f|${state.oldHandler}\n`);
  assertLegacyUnchanged(state, legacy);
});

test("rollback refuses deletion while a candidate process is reported", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  executable(join(state.controls, "process-absent"), "#!/bin/sh\nexit 1\n");
  assert.throws(() => execFileSync("bash", [executor, "rollback"], {env: state.env, stdio: "pipe"}));
  assert.ok(existsSync(state.target));
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.target);
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\n`);
  assertLegacyUnchanged(state, legacy);
});

test("production execution fails closed without a single-use lease", () => {
  assert.throws(() => execFileSync("bash", [executor, "forward"], {
    env: {
      ...process.env,
      YNX_BROWSER_EXECUTION_MODE: "production",
      YNX_BROWSER_CARRIER: "/tmp/absent.zip",
      YNX_BROWSER_CARRIER_SHA256: "a".repeat(64),
      YNX_BROWSER_ISOLATED_TARGET: `${process.env.HOME}/Applications/YNX Browser Isolated/candidate.app`,
      YNX_BROWSER_ISOLATED_ROOT: `${process.env.HOME}/Applications/YNX Browser Isolated`,
      YNX_BROWSER_ISOLATED_ROOT_PREWRITE: "ABSENT_CREATE_ONE_DIRECTORY",
      YNX_BROWSER_ISOLATED_ROOT_PARENT: `${process.env.HOME}/Applications`,
      YNX_BROWSER_ISOLATED_ROOT_PARENT_DEV_INODE: "1:2",
      YNX_BROWSER_ISOLATED_ROOT_PARENT_UID: "501",
      YNX_BROWSER_ISOLATED_ROOT_PARENT_GID: "20",
      YNX_BROWSER_ISOLATED_ROOT_PARENT_MODE: "700",
      YNX_BROWSER_ISOLATED_ROOT_PARENT_NLINK: "15",
      YNX_BROWSER_ISOLATED_ROOT_UID: "501",
      YNX_BROWSER_ISOLATED_ROOT_GID: "20",
      YNX_BROWSER_ISOLATED_ROOT_MODE: "700",
      YNX_BROWSER_ISOLATED_ROOT_NLINK: "2",
      YNX_BROWSER_CANDIDATE_BINARY_SHA256: "b".repeat(64),
      YNX_BROWSER_OLD_HANDLER: `${process.env.HOME}/Applications/old.app`,
      YNX_BROWSER_OLD_HANDLER_DEV_INODE: "1:2",
      YNX_BROWSER_OLD_BINARY_SHA256: "c".repeat(64),
      YNX_BROWSER_RECEIPT: "/tmp/absent.txt"
    },
    stdio: "pipe"
  }));
});
