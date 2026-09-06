import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// CI-only engineering app QA. No application test hooks, secret injection,
// Apple account access, distribution signing, store release or public requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const phase = process.argv[2], expected = process.env.YNX_IOS_EXPECTED_SOURCE_COMMIT;
assert(["prepare", "artifact", "run"].includes(phase), "Use prepare, artifact or run");
assert.equal(process.env.GITHUB_ACTIONS, "true", "This runner must not operate a developer's Simulator profile");
assert.equal(process.platform, "darwin", "A macOS Xcode runner is required");
assert.match(expected ?? "", /^[0-9a-f]{40}$/, "Require an exact lowercase source commit");
const runnerTemp = realpathSync(process.env.RUNNER_TEMP);
const qa = process.env.YNX_IOS_QA_DIR;
assert(qa && isAbsolute(qa) && dirname(qa) === runnerTemp && /^ynx-wallet-ios-[0-9]+-[0-9]+$/.test(relative(runnerTemp, qa)), "Use this run's isolated runner-temp directory");
const proof = join(qa, "proof"), app = join(qa, "DerivedData/Build/Products/Release-iphonesimulator/YNXWallet.app");
const bundle = "com.ynxweb4.wallet", commands = [];
const sha = value => createHash("sha256").update(value).digest("hex");
function save(name, value) { writeFileSync(join(proof, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); }
function command(binary, args, timeout = 120_000, allowFailure = false) {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  commands.push({ binary, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null });
  if (existsSync(proof)) save(`${phase}-commands.json`, commands);
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${binary} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout?.trim() ?? "";
}
function plist(path) { return JSON.parse(command("/usr/bin/plutil", ["-convert", "json", "-o", "-", path])); }
function files(directory) {
  const records = [];
  function visit(path) {
    const stat = lstatSync(path), name = relative(directory, path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path), resolved = resolve(dirname(path), target);
      assert(!isAbsolute(target) && !relative(directory, resolved).startsWith(".."), "App symlinks must remain inside the bundle");
      records.push({ path: name, type: "symlink", target });
    } else if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
    else { assert(stat.isFile(), "App bundle contains an unsupported filesystem object"); const bytes = readFileSync(path); records.push({ path: name, type: "file", bytes: bytes.length, sha256: sha(bytes) }); }
  }
  visit(directory); return records;
}
function sourceCommit() { assert.equal(command("git", ["rev-parse", "HEAD"]), expected, "Checkout differs from the requested immutable source"); }
function assertOwnedDirectory() { assert.equal(realpathSync(qa), qa); assert(!lstatSync(qa).isSymbolicLink()); assert(existsSync(join(proof, "source.json"))); sourceCommit(); }
// The Simulator consumes its identity from the actual Mach-O entitlement
// section. A generated .xcent beside the app or linker-only signature is not
// proof that the installed executable carries that identity.
function simulatorEntitlementSection(executable, architecture) {
  const bytes = readFileSync(executable), cpu = { arm64: 0x100000c, x86_64: 0x1000007 }[architecture];
  assert(cpu && bytes.length >= 32);
  let macho = bytes;
  const magic = bytes.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const wide = magic === 0xcafebabf, count = bytes.readUInt32BE(4), stride = wide ? 32 : 20;
    assert(count > 0 && count <= 8 && 8 + count * stride <= bytes.length);
    const matches = [];
    for (let index = 0; index < count; index++) {
      const at = 8 + index * stride;
      if (bytes.readUInt32BE(at) !== cpu) continue;
      const offset = wide ? Number(bytes.readBigUInt64BE(at + 8)) : bytes.readUInt32BE(at + 8);
      const size = wide ? Number(bytes.readBigUInt64BE(at + 16)) : bytes.readUInt32BE(at + 12);
      assert(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 8 + count * stride && size >= 32 && offset + size <= bytes.length);
      matches.push(bytes.subarray(offset, offset + size));
    }
    assert.equal(matches.length, 1, "Require exactly one requested Simulator architecture"); macho = matches[0];
  }
  assert.equal(macho.readUInt32LE(0), 0xfeedfacf); assert.equal(macho.readUInt32LE(4), cpu);
  const count = macho.readUInt32LE(16), end = 32 + macho.readUInt32LE(20), sections = [];
  assert(count > 0 && count <= 1024 && end <= macho.length);
  const name = (at) => macho.subarray(at, at + 16).toString("ascii").replace(/\0.*$/s, "");
  let at = 32;
  for (let index = 0; index < count; index++) {
    assert(at + 8 <= end); const cmd = macho.readUInt32LE(at), size = macho.readUInt32LE(at + 4);
    assert(size >= 8 && at + size <= end);
    if (cmd === 0x19) {
      assert(size >= 72); const nsects = macho.readUInt32LE(at + 64); assert(72 + nsects * 80 <= size);
      for (let i = 0; i < nsects; i++) {
        const section = at + 72 + i * 80;
        if (name(section) !== "__entitlements" || name(section + 16) !== "__TEXT") continue;
        const length = Number(macho.readBigUInt64LE(section + 40)), offset = macho.readUInt32LE(section + 48);
        assert(Number.isSafeInteger(length) && length > 0 && length <= 65536 && offset >= end && offset + length <= macho.length);
        sections.push(macho.subarray(offset, offset + length));
      }
    }
    at += size;
  }
  assert.equal(at, end); assert.equal(sections.length, 1, `Missing or duplicate embedded Simulator identity for ${architecture}`);
  const xml = sections[0].toString("utf8").replace(/\0+$/, ""); assert(xml.startsWith("<?xml") || xml.startsWith("<plist"));
  return xml;
}

if (phase === "prepare") {
  mkdirSync(qa, { mode: 0o700 }); mkdirSync(proof, { mode: 0o700 }); sourceCommit();
  assert.equal(command("git", ["status", "--porcelain", "--untracked-files=no"]), "", "Build must start from a clean committed checkout");
  const config = JSON.parse(readFileSync(join(root, "apps/wallet/app.json"))).expo;
  const info = plist(join(root, "apps/wallet/ios/YNXWallet/Info.plist"));
  assert.equal(info.CFBundleShortVersionString, config.version, "Committed iOS and Expo versions disagree");
  assert.match(info.CFBundleVersion, /^[1-9][0-9]*$/);
  assert.equal(info.UIUserInterfaceStyle, "Light");
  const tracked = command("git", ["ls-files", "-z", "apps/wallet", "packages/wallet-auth", ".github/workflows/wallet-ios.yml"]).split("\0").filter(Boolean);
  save("source.json", { sourceCommit: expected, sourceTree: command("git", ["rev-parse", "HEAD^{tree}"]), sourceFiles: tracked.map(path => ({ path, sha256: sha(readFileSync(join(root, path))) })), xcode: command("xcodebuild", ["-version"]), sdks: command("xcodebuild", ["-showsdks"]), version: info.CFBundleShortVersionString, build: info.CFBundleVersion, simulatorOnly: true });
} else if (phase === "artifact") {
  assertOwnedDirectory();
  const source = JSON.parse(readFileSync(join(proof, "source.json"))), info = plist(join(app, "Info.plist"));
  assert.equal(info.CFBundleIdentifier, bundle); assert.equal(info.CFBundleShortVersionString, source.version); assert.equal(info.CFBundleVersion, source.build);
  assert.deepEqual(info.CFBundleSupportedPlatforms, ["iPhoneSimulator"]); assert.equal(info.DTPlatformName, "iphonesimulator");
  assert.equal(info.UIUserInterfaceStyle, "Light"); assert(info.NSFaceIDUsageDescription?.length > 0);
  assert(info.CFBundleURLTypes?.some(value => value.CFBundleURLSchemes?.includes("ynxwallet")));
  const executable = join(app, info.CFBundleExecutable), architectures = command("/usr/bin/lipo", ["-archs", executable]).split(/\s+/);
  assert.deepEqual([...architectures].sort(), ["arm64", "x86_64"]);
  command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const simulatorIdentity = [];
  for (const architecture of architectures) {
    const xml = simulatorEntitlementSection(executable, architecture), path = join(proof, `simulator-entitlements-${architecture}.plist`);
    writeFileSync(path, xml); const entitlements = plist(path);
    assert.equal(entitlements["application-identifier"], bundle, "Simulator requires its own exact application identity");
    if (entitlements["keychain-access-groups"] !== undefined) assert.deepEqual(entitlements["keychain-access-groups"], [bundle]);
    simulatorIdentity.push({ architecture, applicationIdentifier: bundle, entitlementsSha256: sha(xml) });
  }
  // CocoaPods may add generated build integration to the Xcode project. Capture
  // that exact diff and lockfile; all other committed application/SDK bytes stay fixed.
  const changed = command("git", ["diff", "--name-only", "--", "apps/wallet", "packages/wallet-auth"]).split("\n").filter(Boolean);
  save("generated-source.diff", command("git", ["diff", "--", "apps/wallet", "packages/wallet-auth"]));
  assert(changed.every(path => path === "apps/wallet/ios/YNXWallet.xcodeproj/project.pbxproj"), `Unexpected source mutation before packaging: ${changed.join(", ")}`);
  save("pods-project.diff", command("git", ["diff", "--", "apps/wallet/ios/YNXWallet.xcodeproj/project.pbxproj"]));
  save("Podfile.lock", readFileSync(join(root, "apps/wallet/ios/Podfile.lock"), "utf8"));
  const artifactFiles = files(app), zip = join(qa, `YNXWallet-iOS-Simulator-${expected.slice(0, 12)}.zip`);
  command("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const bytes = readFileSync(zip);
  save("artifact.json", { sourceCommit: expected, filename: relative(qa, zip), sha256: sha(bytes), bytes: bytes.length, bundleIdentifier: bundle, version: info.CFBundleShortVersionString, build: info.CFBundleVersion, architectures: architectures.join(" "), files: artifactFiles, simulatorIdentity, localSignatureVerified: true, simulatorOnly: true, iphoneInstallable: false, distributionSigned: false, testFlight: false, appStore: false });
} else {
  assertOwnedDirectory();
  const artifact = JSON.parse(readFileSync(join(proof, "artifact.json")));
  assert.equal(artifact.sourceCommit, expected); assert.deepEqual(files(app), artifact.files);
  const runtimes = JSON.parse(command("xcrun", ["simctl", "list", "runtimes", "-j"]));
  const inventory = JSON.parse(command("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  save("runtimes.json", runtimes);
  let template;
  for (const runtime of runtimes.runtimes.filter(value => value.isAvailable && value.identifier.includes(".iOS-")).reverse()) {
    const device = inventory.devices[runtime.identifier]?.find(value => value.isAvailable && value.name.startsWith("iPhone") && typeof value.deviceTypeIdentifier === "string");
    if (device) { template = { runtime: runtime.identifier, type: device.deviceTypeIdentifier }; break; }
  }
  assert(template, "No available iPhone Simulator runtime/device type exists");
  const name = `YNX Wallet ${expected.slice(0, 12)} CI ${process.env.GITHUB_RUN_ID}`;
  const device = command("xcrun", ["simctl", "create", name, template.type, template.runtime]);
  assert.match(device, /^[0-9A-F-]{36}$/i, "simctl must return the newly created device UUID");
  save("owned-simulator.json", { device, name, ...template, sourceCommit: expected });
  const result = { sourceCommit: expected, device, name, simulatorOnly: true, installed: false, coldLaunch: false, secondColdLaunch: false, screenshots: [], invalidDeepLinkDelivered: false, visuallyReviewed: false, biometricEnrollmentVerified: false, authenticatedKeyAccessVerified: false, singlePromptVerified: false, originalRequestRetryVerified: false, validCallbackVerified: false, physicalDeviceVerified: false, cleanedUp: false };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const screenshot = label => { const path = `${label}.png`; command("xcrun", ["simctl", "io", device, "screenshot", join(proof, path)]); result.screenshots.push(path); };
  async function coldLaunch() {
    const launch = command("xcrun", ["simctl", "launch", "--terminate-running-process", device, bundle]);
    const pid = Number(new RegExp(`^${bundle.replaceAll(".", "\\.")}: ([0-9]+)$`).exec(launch)?.[1]);
    assert(Number.isSafeInteger(pid) && pid > 0, "Simulator launch did not identify a live app PID");
    await wait(3000); process.kill(pid, 0); return pid;
  }
  try {
    command("xcrun", ["simctl", "boot", device]); command("xcrun", ["simctl", "bootstatus", device, "-b"], 300_000);
    command("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", device]);
    command("xcrun", ["simctl", "ui", device, "appearance", "light"]);
    command("xcrun", ["simctl", "install", device, app]);
    const installed = command("xcrun", ["simctl", "get_app_container", device, bundle, "app"]);
    for (const entry of artifact.files.filter(value => value.type === "file")) assert.equal(sha(readFileSync(join(installed, entry.path))), entry.sha256, `Installed file changed: ${entry.path}`);
    result.installed = true; result.firstPID = await coldLaunch(); result.coldLaunch = true; screenshot("01-cold-launch-light");
    command("xcrun", ["simctl", "ui", device, "appearance", "dark"]); await wait(2000); screenshot("02-system-dark-app-light");
    command("xcrun", ["simctl", "ui", device, "appearance", "light"]);
    command("xcrun", ["simctl", "openurl", device, "ynxwallet://authorize?request=invalid"]); result.invalidDeepLinkDelivered = true;
    await wait(2000); screenshot("03-invalid-deep-link");
    result.secondPID = await coldLaunch(); result.secondColdLaunch = true; screenshot("04-second-cold-launch-light");
  } catch (error) { result.error = error.message; throw error; }
  finally {
    try {
      const current = JSON.parse(command("xcrun", ["simctl", "list", "devices", "-j"]));
      const owned = Object.values(current.devices).flat().find(value => value.udid === device);
      assert.equal(owned?.name, name, "Cleanup must match this run's created simulator");
      command("xcrun", ["simctl", "shutdown", device], 60_000, true);
      command("xcrun", ["simctl", "delete", device]); result.cleanedUp = true;
    } finally { save("qa-result.json", result); }
  }
}
