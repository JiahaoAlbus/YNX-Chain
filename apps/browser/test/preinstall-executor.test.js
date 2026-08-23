import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";

const browserRoot = resolve(import.meta.dirname, "..");
const executor = join(browserRoot, "scripts/browser-preinstall-executor.sh");
const emergencyRecovery = join(browserRoot, "scripts/browser-preinstall-emergency-recovery.sh");
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
  executable(join(controls, "lsregister"), `#!/bin/sh\nset -eu\nprintf '%s|%s\\n' "$1" "$2" >> '${join(controls, "operations")}'\nif [ "$1" = '-f' ]; then printf '%s' "$2" > '${join(controls, "handler")}'; fi\nif [ "$1" = '-u' ] && [ "$(cat '${join(controls, "handler")}')" = "$2" ]; then : > '${join(controls, "handler")}'; fi\n`);
  executable(join(controls, "set-default-handler"), `#!/bin/sh\nset -eu\nprintf 'set-default|%s|%s\\n' "$1" "$2" >> '${join(controls, "operations")}'\nprintf '%s' "$1" > '${join(controls, "handler")}'; printf '%s\\n' "$1"\n`);
  executable(join(controls, "resolve-handler"), `#!/bin/sh\ncat '${join(controls, "handler")}'\n`);
  executable(join(controls, "process-absent"), "#!/bin/sh\nexit 0\n");
  const carrier = join(temp, "candidate.zip");
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", candidateSource, carrier]);
  const receipt = join(temp, "receipt.txt");
  const journal = join(temp, "preinstall.diagnostic");
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
    YNX_BROWSER_RECEIPT: receipt,
    YNX_BROWSER_DIAGNOSTIC_JOURNAL: journal,
    YNX_BROWSER_DIAGNOSTIC_JOURNAL_TEMP: `${journal}.tmp`
  };
  return {temp, controls, oldCopies, oldHandler, isolatedParent, isolatedRoot, target, receipt, journal, env};
}

function journal(state) {
  return Object.fromEntries(readFileSync(state.journal, "utf8").trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
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

function emergencyFixture() {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  rmSync(state.receipt);
  writeFileSync(join(state.controls, "handler"), state.oldHandler);
  writeFileSync(state.journal, [
    "schema=ynx-browser-preinstall-diagnostic/1",
    "action=forward",
    "stage=SET_DEFAULT_HANDLER_CANDIDATE",
    "status=RUNNING",
    "exit_code=0",
    "failure_stage=",
    "cleanup_status=NOT_STARTED",
    `applications_parent_tuple=${inode(state.isolatedParent)}:${statSync(state.isolatedParent).uid}:${statSync(state.isolatedParent).gid}:${(statSync(state.isolatedParent).mode & 0o777).toString(8)}:${statSync(state.isolatedParent).nlink}:${statSync(state.isolatedParent).size}:Directory`,
    `isolated_root_tuple=${inode(state.isolatedRoot)}:${statSync(state.isolatedRoot).uid}:${statSync(state.isolatedRoot).gid}:${(statSync(state.isolatedRoot).mode & 0o777).toString(8)}:${statSync(state.isolatedRoot).nlink}:${statSync(state.isolatedRoot).size}:Directory`,
    `candidate_target_tuple=${inode(state.target)}:${statSync(state.target).uid}:${statSync(state.target).gid}:${(statSync(state.target).mode & 0o777).toString(8)}:${statSync(state.target).nlink}:${statSync(state.target).size}:Directory`,
    `old_handler_tuple=${inode(state.oldHandler)}`,
    "resolved_handler=",
    "registered=true",
    "registration_attempted=true",
    "root_created=true",
    "copied=true",
    ""
  ].join("\n"));
  writeFileSync(join(state.controls, "operations"), "");
  const p0232 = join(state.temp, "p0232.diagnostic");
  writeFileSync(p0232, "immutable-p0232\n");
  const recoveryReceipt = join(state.temp, "p0234-recovery.receipt");
  const recoveryJournal = join(state.temp, "p0234-recovery.diagnostic");
  const targetStat = statSync(state.target);
  const rootStat = statSync(state.isolatedRoot);
  const parentStat = statSync(state.isolatedParent);
  const env = {
    ...state.env,
    YNX_BROWSER_RECOVERY_PARENT_DEV_INODE: inode(state.isolatedParent),
    YNX_BROWSER_RECOVERY_PARENT_UID: String(parentStat.uid),
    YNX_BROWSER_RECOVERY_PARENT_GID: String(parentStat.gid),
    YNX_BROWSER_RECOVERY_PARENT_MODE: (parentStat.mode & 0o777).toString(8),
    YNX_BROWSER_RECOVERY_PARENT_NLINK: String(parentStat.nlink),
    YNX_BROWSER_RECOVERY_ROOT_DEV_INODE: inode(state.isolatedRoot),
    YNX_BROWSER_RECOVERY_ROOT_UID: String(rootStat.uid),
    YNX_BROWSER_RECOVERY_ROOT_GID: String(rootStat.gid),
    YNX_BROWSER_RECOVERY_ROOT_MODE: (rootStat.mode & 0o777).toString(8),
    YNX_BROWSER_RECOVERY_ROOT_NLINK: String(rootStat.nlink),
    YNX_BROWSER_RECOVERY_TARGET_DEV_INODE: inode(state.target),
    YNX_BROWSER_RECOVERY_TARGET_UID: String(targetStat.uid),
    YNX_BROWSER_RECOVERY_TARGET_GID: String(targetStat.gid),
    YNX_BROWSER_RECOVERY_TARGET_MODE: (targetStat.mode & 0o777).toString(8),
    YNX_BROWSER_RECOVERY_TARGET_NLINK: String(targetStat.nlink),
    YNX_BROWSER_OLD_PID: "93119",
    YNX_BROWSER_OLD_PROCESS_PATH: state.oldHandler,
    YNX_BROWSER_FAILED_DIAGNOSTIC_JOURNAL: state.journal,
    YNX_BROWSER_FAILED_DIAGNOSTIC_SHA256: sha(state.journal),
    YNX_BROWSER_P0232_DIAGNOSTIC_JOURNAL: p0232,
    YNX_BROWSER_P0232_DIAGNOSTIC_SHA256: sha(p0232),
    YNX_BROWSER_RECOVERY_RECEIPT: recoveryReceipt,
    YNX_BROWSER_RECOVERY_DIAGNOSTIC_JOURNAL: recoveryJournal,
    YNX_BROWSER_RECOVERY_DIAGNOSTIC_TEMP: `${recoveryJournal}.tmp`
  };
  return {...state, legacy, p0232, recoveryReceipt, recoveryJournal, env};
}

test("emergency recovery uses frozen failed journal without a forward receipt", () => {
  const state = emergencyFixture();
  const failedJournal = readFileSync(state.journal);
  const p0232 = readFileSync(state.p0232);
  execFileSync("bash", [emergencyRecovery, "recover"], {env: state.env});
  assert.equal(existsSync(state.target), false);
  assert.equal(existsSync(state.isolatedRoot), false);
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.oldHandler);
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-u|${state.target}\n`);
  assert.match(readFileSync(state.recoveryReceipt, "utf8"), /status=RECOVERED/);
  assert.match(readFileSync(state.recoveryJournal, "utf8"), /stage=RECOVERY_COMPLETE\nstatus=SUCCESS/);
  assert.deepEqual(readFileSync(state.journal), failedJournal);
  assert.deepEqual(readFileSync(state.p0232), p0232);
  assertLegacyUnchanged(state, state.legacy);
});

test("emergency recovery rejects root substitution before unregister", () => {
  const state = emergencyFixture();
  const originalRoot = `${state.isolatedRoot}.original`;
  renameSync(state.isolatedRoot, originalRoot);
  mkdirSync(state.isolatedRoot, {mode: 0o700});
  renameSync(join(originalRoot, "YNX Browser Testnet Preview-ad890f0a2fe5-aaed312ef608.app"), state.target);
  assert.throws(() => execFileSync("bash", [emergencyRecovery, "recover"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), "");
  assertLegacyUnchanged(state, state.legacy);
});

test("emergency recovery rejects concurrent root contents before unregister", () => {
  const state = emergencyFixture();
  writeFileSync(join(state.isolatedRoot, "concurrent.txt"), "preserve\n");
  assert.throws(() => execFileSync("bash", [emergencyRecovery, "recover"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), "");
  assert.ok(existsSync(join(state.isolatedRoot, "concurrent.txt")));
  assertLegacyUnchanged(state, state.legacy);
});

test("emergency recovery refuses a running candidate before unregister", () => {
  const state = emergencyFixture();
  executable(join(state.controls, "process-absent"), "#!/bin/sh\nexit 1\n");
  assert.throws(() => execFileSync("bash", [emergencyRecovery, "recover"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), "");
  assertLegacyUnchanged(state, state.legacy);
});

test("emergency recovery partial-cleanup stages retain exact diagnostics and legacy state", async (context) => {
  for (const stage of ["UNREGISTER_CANDIDATE", "VERIFY_OLD_HANDLER_AFTER_UNREGISTER", "DELETE_EXACT_CANDIDATE", "DELETE_EXACT_EMPTY_ROOT", "VERIFY_TERMINAL_BASELINE"]) {
    await context.test(stage, () => {
      const state = emergencyFixture();
      assert.throws(() => execFileSync("bash", [emergencyRecovery, "recover"], {env: {...state.env, YNX_BROWSER_FIXTURE_RECOVERY_FAIL_STAGE: stage}, stdio: "pipe"}));
      const evidence = readFileSync(state.recoveryJournal, "utf8");
      assert.match(evidence, new RegExp(`stage=${stage}\\nstatus=FAILED_CLOSED\\nexit_code=97`));
      assertLegacyUnchanged(state, state.legacy);
      assert.deepEqual(readFileSync(state.p0232), Buffer.from("immutable-p0232\n"));
      if (["DELETE_EXACT_EMPTY_ROOT", "VERIFY_TERMINAL_BASELINE"].includes(stage)) {
        assert.equal(existsSync(state.target), false);
      }
    });
  }
});

test("forward and rollback only register candidate and restore exact old handler", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  assert.deepEqual({...journal(state)}, {
    schema: "ynx-browser-preinstall-diagnostic/1",
    action: "forward",
    stage: "FORWARD_COMPLETE",
    status: "SUCCESS",
    exit_code: "0",
    failure_stage: "",
    cleanup_status: "NOT_REQUIRED",
    applications_parent_tuple: journal(state).applications_parent_tuple,
    isolated_root_tuple: journal(state).isolated_root_tuple,
    candidate_target_tuple: journal(state).candidate_target_tuple,
    old_handler_tuple: journal(state).old_handler_tuple,
    resolved_handler: state.target,
    registered: "true",
    registration_attempted: "true",
    root_created: "true",
    copied: "true"
  });
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.target);
  assert.ok(existsSync(state.target));
  execFileSync("bash", [executor, "rollback"], {env: state.env});
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.oldHandler);
  assert.equal(existsSync(state.target), false);
  assert.equal(existsSync(state.isolatedRoot), false);
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\nset-default|${state.target}|ynxbrowser\n-u|${state.target}\n-f|${state.oldHandler}\nset-default|${state.oldHandler}|ynxbrowser\n`);
  assertLegacyUnchanged(state, legacy);
});

test("every pre-receipt stage preserves an exact diagnostic journal and complete cleanup", async (context) => {
  const stages = [
    "VERIFY_OLD_HANDLER",
    "VERIFY_ROOT_PARENT",
    "VERIFY_PREWRITE_ABSENCE",
    "VERIFY_CARRIER",
    "CREATE_TEMP_DIRECTORY",
    "EXTRACT_CARRIER",
    "VERIFY_EXTRACTED_APP",
    "CREATE_ISOLATED_ROOT",
    "COPY_CANDIDATE",
    "VERIFY_CANDIDATE",
    "REGISTER_CANDIDATE",
    "SET_DEFAULT_HANDLER_CANDIDATE",
    "RESOLVE_CANDIDATE_HANDLER",
    "VERIFY_OLD_HANDLER_POSTREGISTER",
    "VERIFY_ROOT_EXCLUSIVE",
    "WRITE_SUCCESS_RECEIPT"
  ];
  for (const stage of stages) {
    await context.test(stage, () => {
      const state = fixture();
      const legacy = legacySnapshot(state);
      assert.throws(() => execFileSync("bash", [executor, "forward"], {
        env: {...state.env, YNX_BROWSER_FIXTURE_FAIL_STAGE: stage},
        stdio: "pipe"
      }));
      const evidence = journal(state);
      assert.equal(evidence.stage, stage);
      assert.equal(evidence.status, "FAILED_CLEANED");
      assert.equal(evidence.exit_code, "97");
      assert.equal(evidence.failure_stage, stage);
      assert.equal(evidence.cleanup_status, "COMPLETE");
      assert.equal(evidence.isolated_root_tuple, "ABSENT");
      assert.equal(evidence.candidate_target_tuple, "ABSENT");
      assert.equal(existsSync(`${state.journal}.tmp`), false);
      assert.equal(existsSync(state.receipt), false);
      assert.equal(existsSync(state.isolatedRoot), false);
      assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.oldHandler);
      assertLegacyUnchanged(state, legacy);
      const registrationReached = stages.indexOf(stage) > stages.indexOf("REGISTER_CANDIDATE");
      const defaultReached = stages.indexOf(stage) > stages.indexOf("SET_DEFAULT_HANDLER_CANDIDATE");
      const operations = existsSync(join(state.controls, "operations")) ? readFileSync(join(state.controls, "operations"), "utf8") : "";
      assert.equal(operations, registrationReached
        ? `-f|${state.target}\n${defaultReached ? `set-default|${state.target}|ynxbrowser\n` : ""}-u|${state.target}\n-f|${state.oldHandler}\nset-default|${state.oldHandler}|ynxbrowser\n`
        : "");
    });
  }
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
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\nset-default|${state.target}|ynxbrowser\n`);
  assert.equal(readFileSync(join(state.controls, "handler"), "utf8"), state.target);
  assertLegacyUnchanged(state, legacy);
});

test("rollback rejects an unexpected root entry before LaunchServices mutation", () => {
  const state = fixture();
  const legacy = legacySnapshot(state);
  execFileSync("bash", [executor, "forward"], {env: state.env});
  writeFileSync(join(state.isolatedRoot, "unexpected.txt"), "do-not-delete\n");
  assert.throws(() => execFileSync("bash", [executor, "rollback"], {env: state.env, stdio: "pipe"}));
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\nset-default|${state.target}|ynxbrowser\n`);
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
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\nset-default|${state.target}|ynxbrowser\n-u|${state.target}\n-f|${state.oldHandler}\nset-default|${state.oldHandler}|ynxbrowser\n`);
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
  assert.equal(readFileSync(join(state.controls, "operations"), "utf8"), `-f|${state.target}\nset-default|${state.target}|ynxbrowser\n`);
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
      YNX_BROWSER_RECEIPT: "/tmp/absent.txt",
      YNX_BROWSER_DIAGNOSTIC_JOURNAL: "/private/tmp/ynx-browser-preinstall-no-lease.diagnostic",
      YNX_BROWSER_DIAGNOSTIC_JOURNAL_TEMP: "/private/tmp/ynx-browser-preinstall-no-lease.diagnostic.tmp"
    },
    stdio: "pipe"
  }));
});
