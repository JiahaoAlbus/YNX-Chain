import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { compareVersions, parseLoadCommands, inspectBinary, validateCompatibility } from "../scripts/verify-macos-compatibility.mjs";

const slice = (minimumOS = "13.5", architecture = "arm64") => ({ architecture, minimumOS, sdk: "27.0", platform: "1", dependencies: [] });
function inventory() { return { declaredMinimumOS: "13.5", binaries: [
  { path: "Contents/MacOS/YNXDeveloper", slices: [slice()] },
  { path: "Contents/Resources/runtime/node", slices: [slice()] },
  { path: "Contents/Resources/addon.node", slices: [slice("10.15", "x86_64"), slice("11.0")] },
] }; }

test("minimum OS comparisons are numeric across minor and patch versions", () => {
  assert.equal(compareVersions("13.10", "13.5"), 1);
  assert.equal(compareVersions("13.5.0", "13.5"), 0);
  assert.equal(compareVersions("13.5.1", "14.0"), -1);
  assert.throws(() => compareVersions("13.bad", "13.5"), /Invalid/);
});

test("Mach-O parser distinguishes a Rust module install name from real load dependencies", () => {
  const parsed = parseLoadCommands(`fixture:\nLoad command 0\n cmd LC_ID_DYLIB\n cmdsize 128\n name /Users/runner/build/libexample.dylib (offset 24)\nLoad command 1\n cmd LC_BUILD_VERSION\n cmdsize 32\n platform 1\n minos 11.0\n sdk 27.0\nLoad command 2\n cmd LC_LOAD_DYLIB\n cmdsize 56\n name /usr/lib/libSystem.B.dylib (offset 24)\nLoad command 3\n cmd LC_LOAD_WEAK_DYLIB\n cmdsize 56\n name /usr/lib/libobjc.A.dylib (offset 24)\n`);
  assert.equal(parsed.minimumOS, "11.0");
  assert.equal(parsed.platform, "1");
  assert.deepEqual(parsed.dependencies.map(d => d.path), ["/usr/lib/libSystem.B.dylib", "/usr/lib/libobjc.A.dylib"]);
  const legacy = parseLoadCommands("fixture:\nLoad command 0\n cmd LC_VERSION_MIN_MACOSX\n cmdsize 16\n version 10.15\n sdk 13.1\n");
  assert.equal(legacy.minimumOS, "10.15"); assert.equal(legacy.platform, "1");
});

test("every architecture's real target must fit the bundle declaration", () => {
  const value = inventory();
  assert.deepEqual(validateCompatibility(value, "13.5", "arm64"), []);
  value.binaries[0].slices[0].minimumOS = "27.0";
  assert.match(validateCompatibility(value, "13.5", "arm64").join("\n"), /requires 27.0/);
  value.binaries[0].slices[0].minimumOS = "13.5";
  value.binaries[2].slices[0].minimumOS = "14.0";
  assert.match(validateCompatibility(value, "13.5", "arm64").join("\n"), /addon.node \(x86_64\) requires 14.0/);
});

test("Node floor, native exact target, missing platform and mismatched declaration fail the package gate", () => {
  const node = inventory(); node.binaries[1].slices[0].minimumOS = "14.0";
  assert.match(validateCompatibility(node, "13.5", "arm64").join("\n"), /runtime\/node.*requires 14.0/);
  const native = inventory(); native.binaries[0].slices[0].minimumOS = "13.0";
  assert.match(validateCompatibility(native, "13.5", "arm64").join("\n"), /must equal declared/);
  const unknown = inventory(); unknown.binaries[2].slices[0].platform = "2";
  assert.match(validateCompatibility(unknown, "13.5", "arm64").join("\n"), /Missing macOS/);
  const declared = inventory(); declared.declaredMinimumOS = "13.0";
  assert.match(validateCompatibility(declared, "13.5", "arm64").join("\n"), /Info.plist/);
  assert.match(validateCompatibility(inventory(), "13.5", "x86_64").join("\n"), /Missing x86_64 slice/);
});

test("unbundled dynamic libraries cannot pass merely because their minimum OS is low", () => {
  const value = inventory(); value.binaries[2].slices[0].dependencies.push({ command: "LC_LOAD_DYLIB", path: "/opt/homebrew/lib/libexample.dylib" });
  assert.match(validateCompatibility(value, "13.5", "arm64").join("\n"), /Non-system load dependency/);
});

test("packaging derives clang target from plist and seals the independently replayable inventory", async () => {
  const [plist, build, verify] = await Promise.all(["../desktop/macos/Info.plist", "../scripts/package-local-macos.sh", "../scripts/verify-local-macos-package.sh"].map(p => readFile(new URL(p, import.meta.url), "utf8")));
  assert.match(plist, /LSMinimumSystemVersion<\/key><string>13\.5<\/string>/);
  assert.match(build, /macos_min_version=.*PlistBuddy/);
  assert.match(build, /-mmacosx-version-min="\$macos_min_version" -Werror=unguarded-availability -Werror=unguarded-availability-new/);
  assert.match(build, /node scripts\/verify-macos-compatibility\.mjs/);
  assert.match(build, /macosCompatibilitySha256/);
  assert.match(verify, /node scripts\/verify-macos-compatibility\.mjs/);
  assert.match(verify, /cmp "\$app\/Contents\/Resources\/macos-compatibility\.json"/);
});

test("production native shell compiles with 13.5 availability errors and records that exact Mach-O target", { skip: process.platform !== "darwin", timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-macos-target-")); t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "YNXDeveloper"), exec = promisify(execFile);
  await exec("/usr/bin/clang", ["-fobjc-arc", "-mmacosx-version-min=13.5", "-Werror=unguarded-availability", "-Werror=unguarded-availability-new", `-fmodules-cache-path=${root}/module-cache`, fileURLToPath(new URL("../desktop/macos/main.m", import.meta.url)), "-o", binary, "-framework", "Cocoa", "-framework", "Security", "-framework", "WebKit"], { timeout: 45000 });
  const slices = inspectBinary(binary);
  assert.ok(slices.length > 0);
  for (const slice of slices) { assert.equal(compareVersions(slice.minimumOS, "13.5"), 0); assert.equal(slice.platform, "1"); }
});
