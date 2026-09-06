import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const phase = process.argv[2], env = process.env;
assert(["prepare", "run"].includes(phase));
assert.equal(env.GITHUB_ACTIONS, "true", "Use only an isolated macOS CI runner");
assert.equal(process.platform, "darwin");
const qaSource = env.YNX_IOS_QA_SOURCE_COMMIT, appSource = env.YNX_IOS_APP_SOURCE_COMMIT, artifactRun = env.YNX_IOS_ARTIFACT_RUN;
assert.match(qaSource ?? "", /^[0-9a-f]{40}$/); assert.match(appSource ?? "", /^[0-9a-f]{40}$/); assert.match(artifactRun ?? "", /^[1-9][0-9]*$/);
const runnerTemp = realpathSync(env.RUNNER_TEMP), qa = env.YNX_IOS_UI_QA_DIR;
assert(qa && isAbsolute(qa) && dirname(qa) === runnerTemp && /^ynx-wallet-ios-ui-[0-9]+-[0-9]+$/.test(relative(runnerTemp, qa)));
const proof = join(qa, "proof"), incoming = join(qa, "incoming"), commands = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) => writeFileSync(join(proof, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
function command(binary, args, timeout = 120_000, allowFailure = false) {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ binary, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null });
  if (existsSync(proof)) save(`${phase}-commands.json`, commands);
  if (binary === "xcodebuild" && result.status !== 0) console.error(result.stdout?.slice(-16_000) ?? "");
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${binary} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout?.trim() ?? "";
}
const json = path => JSON.parse(readFileSync(path, "utf8"));
const plist = path => JSON.parse(command("/usr/bin/plutil", ["-convert", "json", "-o", "-", path]));
function fileGraph(directory) {
  const records = [];
  function visit(current) {
    const stat = lstatSync(current), path = relative(directory, current);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(current);
      assert(!isAbsolute(target) && !relative(directory, resolve(dirname(current), target)).startsWith(".."));
      records.push({ path, type: "symlink", target });
    } else if (stat.isDirectory()) for (const child of readdirSync(current).sort()) visit(join(current, child));
    else { assert(stat.isFile()); const bytes = readFileSync(current); records.push({ path, type: "file", bytes: bytes.length, sha256: hash(bytes) }); }
  }
  visit(directory); return records;
}
function assertSource() { assert.equal(command("git", ["rev-parse", "HEAD"]), qaSource); }

if (phase === "prepare") {
  mkdirSync(qa, { mode: 0o700 }); mkdirSync(proof, { mode: 0o700 }); assertSource();
  assert.equal(command("git", ["status", "--porcelain", "--untracked-files=no"]), "");
  const run = JSON.parse(command("gh", ["api", `repos/JiahaoAlbus/YNX-Chain/actions/runs/${artifactRun}`]));
  assert.equal(run.head_sha, appSource); assert.equal(run.path, ".github/workflows/wallet-ios.yml"); assert.equal(run.status, "completed");
  assert.equal(run.repository?.full_name, "JiahaoAlbus/YNX-Chain");
  const jobs = JSON.parse(command("gh", ["api", `repos/JiahaoAlbus/YNX-Chain/actions/runs/${artifactRun}/jobs?per_page=100`]));
  const buildNames = ["Build unsigned iOS Simulator app", "Build locally signed iOS Simulator app"];
  assert(jobs.jobs.some(job => job.steps.some(step => buildNames.includes(step.name) && step.conclusion === "success") && job.steps.some(step => step.name === "Freeze the actual Simulator app and installable ZIP" && step.conclusion === "success")));
  // A build with failed launch QA is deliberately eligible for further diagnosis.
  // Require its source-bound packaging step to have succeeded; never promote the
  // previous launch result or call the whole prior run successful.
  const inventory = JSON.parse(command("gh", ["api", `repos/JiahaoAlbus/YNX-Chain/actions/runs/${artifactRun}/artifacts?per_page=100`]));
  const matches = inventory.artifacts.filter(item => item.name === `ynx-wallet-ios-simulator-${appSource}` && !item.expired);
  assert.equal(matches.length, 1); const artifact = matches[0];
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/); assert(artifact.size_in_bytes > 0 && artifact.size_in_bytes < 100 * 1024 * 1024);
  const paths = command("git", ["ls-files", "-z", "apps/wallet/qa/ios", "apps/wallet/scripts/ios-installed-ui-qa.mjs", ".github/workflows/wallet-ios-installed-ui.yml"]).split("\0").filter(Boolean);
  save("input.json", { qaSource, appSource, artifactRun, previousRunConclusion: run.conclusion, githubArtifact: { id: artifact.id, name: artifact.name, digest: artifact.digest, bytes: artifact.size_in_bytes }, qaFiles: paths.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) })), xcode: command("xcodebuild", ["-version"]), sourceOnly: false });
} else {
  assert.equal(realpathSync(qa), qa); assertSource();
  const input = json(join(proof, "input.json")); assert.equal(input.qaSource, qaSource); assert.equal(input.appSource, appSource); assert.equal(input.artifactRun, artifactRun);
  const original = json(join(incoming, "proof/source.json")), artifact = json(join(incoming, "proof/artifact.json"));
  assert.equal(original.sourceCommit, appSource); assert.equal(artifact.sourceCommit, appSource);
  assert.equal(artifact.filename, `YNXWallet-iOS-Simulator-${appSource.slice(0, 12)}.zip`); assert.equal(artifact.simulatorOnly, true);
  assert.equal(artifact.bundleIdentifier, "com.ynxweb4.wallet");
  const zip = join(incoming, artifact.filename), bytes = readFileSync(zip);
  assert.equal(bytes.length, artifact.bytes); assert.equal(hash(bytes), artifact.sha256);
  assert(Array.isArray(artifact.files) && artifact.files.length > 0 && artifact.files.length < 10_000);
  assert.equal(new Set(artifact.files.map(file => file.path)).size, artifact.files.length);
  for (const file of artifact.files) {
    assert(typeof file.path === "string" && !isAbsolute(file.path) && !file.path.split("/").includes(".."));
    assert(["file", "symlink"].includes(file.type));
    if (file.type === "symlink") {
      assert(typeof file.target === "string" && !isAbsolute(file.target));
      const target = resolve("/app", dirname(file.path), file.target);
      assert(target === "/app" || target.startsWith("/app/"));
    }
  }
  const entries = command("/usr/bin/unzip", ["-Z1", zip]).split("\n");
  assert.equal(new Set(entries).size, entries.length);
  for (const entry of entries) assert(!entry.startsWith("/") && !entry.split("/").includes("..") && (entry.startsWith("YNXWallet.app/") || entry.startsWith("__MACOSX/")));
  const extracted = join(qa, "extracted"); mkdirSync(extracted, { mode: 0o700 });
  command("/usr/bin/ditto", ["-x", "-k", zip, extracted]);
  const app = join(extracted, "YNXWallet.app"); assert.deepEqual(fileGraph(app), artifact.files);
  const info = plist(join(app, "Info.plist")); assert.equal(info.CFBundleIdentifier, "com.ynxweb4.wallet"); assert.equal(info.DTPlatformName, "iphonesimulator"); assert.equal(info.CFBundleVersion, artifact.build); assert.equal(info.CFBundleShortVersionString, artifact.version); assert.equal(info.UIUserInterfaceStyle, "Light");
  save("package.json", { appSource, artifactRun, filename: artifact.filename, sha256: artifact.sha256, bytes: bytes.length, fileCount: artifact.files.length, version: artifact.version, build: artifact.build, originalPackageUnchanged: true });
  console.log(JSON.stringify({ originalAppSource: appSource, originalZipSha256: artifact.sha256, originalZipBytes: bytes.length }));
  const runtimes = JSON.parse(command("xcrun", ["simctl", "list", "runtimes", "-j"]));
  const inventory = JSON.parse(command("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  let template;
  for (const runtime of runtimes.runtimes.filter(item => item.isAvailable && item.identifier.includes(".iOS-")).reverse()) {
    const device = inventory.devices[runtime.identifier]?.find(item => item.isAvailable && item.name.startsWith("iPhone") && typeof item.deviceTypeIdentifier === "string");
    if (device) { template = { runtime: runtime.identifier, type: device.deviceTypeIdentifier }; break; }
  }
  assert(template, "No available iPhone Simulator runtime");
  const name = `YNX Wallet UI ${qaSource.slice(0, 8)} CI ${env.GITHUB_RUN_ID}`;
  const device = command("xcrun", ["simctl", "create", name, template.type, template.runtime]); assert.match(device, /^[0-9A-F-]{36}$/i);
  save("owned-simulator.json", { device, name, ...template });
  const result = { qaSource, appSource, artifactRun, device, simulatorOnly: true, installed: false, uiTestsPassed: false, emptyWalletOnly: true, authenticatedUnlockVerified: false, biometricEnrollmentVerified: false, singleProtectedPromptVerified: false, originalApprovedRequestRetryVerified: false, validCallbackVerified: false, physicalDeviceVerified: false, attachmentsExported: false, cleanedUp: false };
  try {
    command("xcrun", ["simctl", "boot", device]); command("xcrun", ["simctl", "bootstatus", device, "-b"], 300_000);
    command("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", device]);
    command("xcrun", ["simctl", "ui", device, "appearance", "light"]);
    command("xcrun", ["simctl", "install", device, app]);
    const installed = command("xcrun", ["simctl", "get_app_container", device, "com.ynxweb4.wallet", "app"]);
    for (const file of artifact.files.filter(item => item.type === "file")) assert.equal(hash(readFileSync(join(installed, file.path))), file.sha256);
    result.installed = true;
    command("xcodebuild", ["-project", "apps/wallet/qa/ios/YNXWalletInstalledQA.xcodeproj", "-scheme", "YNXWalletInstalledQA", "-configuration", "Release", "-sdk", "iphonesimulator", "-destination", `platform=iOS Simulator,id=${device}`, "-derivedDataPath", join(qa, "UITestDerivedData"), "-resultBundlePath", join(proof, "InstalledUI.xcresult"), "-parallel-testing-enabled", "NO", "CODE_SIGNING_ALLOWED=NO", "test"], 900_000);
    result.uiTestsPassed = true;
    command("xcrun", ["simctl", "io", device, "screenshot", join(proof, "installed-ui-final.png")]);
    assert.deepEqual(fileGraph(app), artifact.files, "UI QA must not rebuild or modify the original package");
  } catch (error) {
    result.error = error.message;
    command("xcrun", ["simctl", "io", device, "screenshot", join(proof, "installed-ui-failure.png")], 30_000, true);
    throw error;
  }
  finally {
    try {
      // Export the test's existing empty-wallet screenshots for independent
      // visual review. This reads its result bundle; it does not alter the app
      // or disable capture protection. Export failure never changes the UI result.
      try {
        const bundle = join(proof, "InstalledUI.xcresult"), output = join(proof, "ui-attachments");
        assert(existsSync(bundle), "No XCTest result bundle was produced");
        command("xcrun", ["xcresulttool", "export", "attachments", "--path", bundle, "--output-path", output], 60_000);
        const exported = fileGraph(output);
        assert(exported.some(file => file.type === "file" && file.path === "manifest.json"));
        assert(exported.some(file => file.type === "file" && file.path.endsWith(".png") && file.bytes > 0));
        result.attachmentFiles = exported; result.attachmentsExported = true;
      } catch (error) { result.attachmentExportError = error.message; }
      // Only an empty Wallet on this newly created Simulator is exercised. Limit
      // diagnostics to its Wallet/SpringBoard processes, not other profiles.
      save("wallet-springboard.log", command("xcrun", ["simctl", "spawn", device, "log", "show", "--last", "5m", "--style", "compact", "--predicate", 'process == "YNXWallet" OR process == "SpringBoard"'], 30_000, true));
      const current = JSON.parse(command("xcrun", ["simctl", "list", "devices", "-j"]));
      assert.equal(Object.values(current.devices).flat().find(item => item.udid === device)?.name, name);
      command("xcrun", ["simctl", "shutdown", device], 60_000, true); command("xcrun", ["simctl", "delete", device]); result.cleanedUp = true;
    } finally { save("ui-result.json", result); console.log(JSON.stringify(result)); }
  }
}
