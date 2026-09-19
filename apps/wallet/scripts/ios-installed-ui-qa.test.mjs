import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCommandRunner, readInstalledAppContainer, runIOSInstalledUIQA } from "./ios-installed-ui-qa.mjs";

const device = "11111111-2222-4333-8444-555555555555", bundle = "com.ynxweb4.wallet";
const success = stdout => ({ status: 0, signal: null, stdout, stderr: "" });
const timeout = () => ({ status: null, signal: "SIGTERM", stdout: "/partial/container", stderr: "CoreSimulator did not reply", error: Object.assign(new Error("spawnSync xcrun ETIMEDOUT"), { code: "ETIMEDOUT" }) });
const sha = value => createHash("sha256").update(value).digest("hex");

test("one timed-out read is retried with the same identity and both command outcomes are retained", () => {
  const commands = [], attempts = [];
  const command = createCommandRunner({ record: record => commands.push(record), run(binary, args, options) {
    assert.equal(binary, "xcrun"); assert.deepEqual(args, ["simctl", "get_app_container", device, bundle, "app"]);
    assert.equal(options.timeout, 120_000);
    return commands.length === 0 ? timeout() : success("/fixture/installed/YNXWallet.app\n");
  } });
  assert.equal(readInstalledAppContainer(command, device, bundle, attempt => attempts.push(attempt)), "/fixture/installed/YNXWallet.app");
  assert.equal(commands.length, 2); assert.equal(attempts.length, 2);
  assert.equal(commands[0].errorCode, "ETIMEDOUT"); assert.equal(commands[0].signal, "SIGTERM");
  assert.equal(commands[0].stdout, "/partial/container"); assert.equal(commands[0].stderr, "CoreSimulator did not reply");
  assert.equal(commands[0].timeoutMs, 120_000); assert.ok(commands[0].elapsedMs >= 0);
  assert.deepEqual(attempts.map(({ status, willRetry }) => ({ status, willRetry })), [{ status: "failed", willRetry: true }, { status: "success", willRetry: false }]);
});

test("exhausted timeouts throw after two reads and keep the original failure diagnostics", () => {
  const commands = [], attempts = [];
  const command = createCommandRunner({ run: timeout, record: record => commands.push(record) });
  assert.throws(() => readInstalledAppContainer(command, device, bundle, attempt => attempts.push(attempt)), { code: "ETIMEDOUT" });
  assert.equal(commands.length, 2); assert.equal(attempts.length, 2);
  assert.equal(attempts[1].status, "failed"); assert.equal(attempts[1].willRetry, false);
  assert.equal(commands.every(record => record.errorCode === "ETIMEDOUT" && record.timeoutMs === 120_000), true);
});

test("non-timeout errors and malformed successful output are not retried", () => {
  for (const result of [
    { status: 1, signal: null, stdout: "", stderr: "Application is not installed" },
    { status: null, signal: null, stdout: "", stderr: "", error: Object.assign(new Error("xcrun unavailable"), { code: "ENOENT" }) },
    success(""), success("relative/container"), success("/container\n/diagnostic"),
  ]) {
    const commands = [], attempts = [];
    const command = createCommandRunner({ run: () => result, record: record => commands.push(record) });
    assert.throws(() => readInstalledAppContainer(command, device, bundle, attempt => attempts.push(attempt)));
    assert.equal(commands.length, 1); assert.equal(attempts.length, 1); assert.equal(attempts[0].willRetry, false);
  }
});

// Exercise the actual run-phase control flow with an inert process substitute.
// The ZIP, plist, Simulator, test result and PNG below are deliberate fixtures;
// no child process, simctl, Xcode, device, install, or network is ever invoked.
function mainFixture(t, { lookupResults, corruptInstalled = false } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "ynx-ios-ui-command-fixture-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  const qa = join(directory, "ynx-wallet-ios-ui-101-1"), proof = join(qa, "proof"), incoming = join(qa, "incoming");
  mkdirSync(proof, { recursive: true }); mkdirSync(join(incoming, "proof"), { recursive: true });
  const qaSource = "a".repeat(40), appSource = "b".repeat(40), artifactRun = "99";
  const infoBytes = Buffer.from("synthetic plist bytes"), zipBytes = Buffer.from("synthetic zip bytes");
  const artifact = { sourceCommit: appSource, filename: `YNXWallet-iOS-Simulator-${appSource.slice(0, 12)}.zip`, simulatorOnly: true, bundleIdentifier: bundle, bytes: zipBytes.length, sha256: sha(zipBytes), build: "7", version: "1.0.0", files: [{ path: "Info.plist", type: "file", bytes: infoBytes.length, sha256: sha(infoBytes) }] };
  const save = (path, value) => writeFileSync(path, JSON.stringify(value));
  save(join(proof, "input.json"), { qaSource, appSource, artifactRun });
  save(join(incoming, "proof/source.json"), { sourceCommit: appSource });
  save(join(incoming, "proof/artifact.json"), artifact);
  writeFileSync(join(incoming, artifact.filename), zipBytes);
  const installed = join(qa, "installed", "YNXWallet.app"), runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-3", type = "com.apple.CoreSimulator.SimDeviceType.iPhone-17";
  const calls = []; let lookup = 0, createdName;
  function run(binary, args, options) {
    calls.push({ binary, args, timeout: options.timeout });
    if (binary === "git") { assert.deepEqual(args, ["rev-parse", "HEAD"]); return success(qaSource); }
    if (binary === "/usr/bin/unzip") return success("YNXWallet.app/\nYNXWallet.app/Info.plist\n");
    if (binary === "/usr/bin/ditto") { const app = join(qa, "extracted", "YNXWallet.app"); mkdirSync(app); writeFileSync(join(app, "Info.plist"), infoBytes); return success(""); }
    if (binary === "/usr/bin/plutil") return success(JSON.stringify({ CFBundleIdentifier: bundle, DTPlatformName: "iphonesimulator", CFBundleVersion: artifact.build, CFBundleShortVersionString: artifact.version, UIUserInterfaceStyle: "Light" }));
    if (binary === "/usr/bin/open") return success("");
    if (binary === "xcodebuild") { mkdirSync(join(proof, "InstalledUI.xcresult")); return success("synthetic XCTest success"); }
    assert.equal(binary, "xcrun");
    if (args[0] === "xcresulttool") { const output = args[args.indexOf("--output-path") + 1]; mkdirSync(output); save(join(output, "manifest.json"), []); writeFileSync(join(output, "fixture.png"), "synthetic screenshot"); return success(""); }
    assert.equal(args[0], "simctl");
    if (args[1] === "list" && args[2] === "runtimes") return success(JSON.stringify({ runtimes: [{ isAvailable: true, identifier: runtime }] }));
    if (args[1] === "list" && args[2] === "devices") return success(JSON.stringify({ devices: { [runtime]: createdName ? [{ udid: device, name: createdName, isAvailable: true, deviceTypeIdentifier: type }] : [{ udid: "preexisting-template", name: "iPhone 17", isAvailable: true, deviceTypeIdentifier: type }] } }));
    if (args[1] === "create") { assert.equal(createdName, undefined, "The actual run must create only one Simulator"); createdName = args[2]; return success(device); }
    assert.equal(args[2], device, "Every subsequent operation must remain on the owned Simulator");
    if (args[1] === "install") { mkdirSync(installed, { recursive: true }); writeFileSync(join(installed, "Info.plist"), corruptInstalled ? "substituted bytes" : infoBytes); return success(""); }
    if (args[1] === "get_app_container") return (lookupResults?.[lookup++] ?? (() => success(installed)))();
    if (["boot", "bootstatus", "ui", "io", "spawn", "shutdown", "delete"].includes(args[1])) return success("");
    assert.fail(`Unexpected fixture command: ${binary} ${args.join(" ")}`);
  }
  return {
    calls,
    execute: () => runIOSInstalledUIQA({ argv: ["node", "fixture", "run"], platform: "darwin", run, env: { GITHUB_ACTIONS: "true", YNX_IOS_QA_SOURCE_COMMIT: qaSource, YNX_IOS_APP_SOURCE_COMMIT: appSource, YNX_IOS_ARTIFACT_RUN: artifactRun, RUNNER_TEMP: directory, YNX_IOS_UI_QA_DIR: qa, GITHUB_RUN_ID: "101" } }),
    result: () => JSON.parse(readFileSync(join(proof, "ui-result.json"), "utf8")),
    commands: () => JSON.parse(readFileSync(join(proof, "run-commands.json"), "utf8")),
    attempts: () => JSON.parse(readFileSync(join(proof, "container-lookup.json"), "utf8")),
  };
}

test("actual run retries one read, never reinstalls or recreates, and retains failure evidence before synthetic XCTest", t => {
  const setup = mainFixture(t, { lookupResults: [timeout] }); setup.execute();
  assert.equal(setup.calls.filter(call => call.args[1] === "create").length, 1);
  assert.equal(setup.calls.filter(call => call.args[1] === "install").length, 1);
  assert.equal(setup.calls.filter(call => call.args[1] === "get_app_container").length, 2);
  assert.equal(setup.calls.filter(call => call.binary === "xcodebuild").length, 1);
  assert.equal(setup.calls.filter(call => call.args[1] === "delete").length, 1);
  const result = setup.result();
  assert.equal(result.installed, true); assert.equal(result.uiTestsPassed, true); assert.equal(result.cleanedUp, true);
  assert.equal(result.physicalDeviceVerified, false); assert.equal(result.validCallbackVerified, false);
  assert.deepEqual(result.containerLookupAttempts, setup.attempts());
  assert.equal(result.containerLookupAttempts[0].errorCode, "ETIMEDOUT");
  assert.equal(setup.commands().filter(record => record.errorCode === "ETIMEDOUT").length, 1);
});

test("actual run exhausted lookup stays failed, skips XCTest and still cleans the one owned Simulator", t => {
  const setup = mainFixture(t, { lookupResults: [timeout, timeout] });
  assert.throws(setup.execute, { code: "ETIMEDOUT" });
  assert.equal(setup.calls.filter(call => call.args[1] === "create").length, 1);
  assert.equal(setup.calls.filter(call => call.args[1] === "install").length, 1);
  assert.equal(setup.calls.some(call => call.binary === "xcodebuild"), false);
  const result = setup.result();
  assert.equal(result.installed, false); assert.equal(result.uiTestsPassed, false); assert.equal(result.cleanedUp, true);
  assert.equal(result.containerLookupAttempts.length, 2); assert.equal(result.containerLookupAttempts.every(attempt => attempt.status === "failed"), true);
  assert.equal(setup.commands().filter(record => record.errorCode === "ETIMEDOUT").length, 2);
});

test("a recovered container query cannot bypass installed-file identity verification", t => {
  const setup = mainFixture(t, { lookupResults: [timeout], corruptInstalled: true });
  assert.throws(setup.execute, { code: "ERR_ASSERTION" });
  assert.equal(setup.calls.some(call => call.binary === "xcodebuild"), false);
  const result = setup.result();
  assert.equal(result.installed, false); assert.equal(result.uiTestsPassed, false); assert.equal(result.cleanedUp, true);
  assert.deepEqual(result.containerLookupAttempts.map(attempt => attempt.status), ["failed", "success"]);
});
