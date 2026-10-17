import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ensureSecureStorePatch, readPatchSpecification, sha256 } from "./secure-store-native-patch.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = await readPatchSpecification();
const require = createRequire(import.meta.url);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "ynx-secure-store-patch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const packageRoot = path.join(dir, "node_modules", spec.package);
  const source = path.join(packageRoot, spec.file), helper = path.join(packageRoot, spec.helper.destination);
  await mkdir(path.dirname(source), { recursive: true });
  let upstream = await readFile(path.join(root, "node_modules", spec.package, spec.file), "utf8");
  if (sha256(upstream) === spec.patchedSha256) {
    for (const { before, after } of [...spec.edits].reverse()) {
      assert.equal(upstream.split(after).length, 2);
      upstream = upstream.replace(after, before);
    }
  }
  assert.equal(sha256(upstream), spec.upstreamSha256, "Fixture must reconstruct exact published upstream bytes");
  await writeFile(source, upstream);
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: spec.version }));
  for (const name of ["package.json", "package-lock.json"]) await writeFile(path.join(dir, name), await readFile(path.join(root, name)));
  return { dir, source, helper, upstream, packageRoot };
}

test("pristine reviewed package applies, re-applies identically and verifies without mutation", async t => {
  const f = await fixture(t);
  await assert.rejects(ensureSecureStorePatch({ root: f.dir, check: true }), /patch missing/);
  const receipt = await ensureSecureStorePatch({ root: f.dir });
  assert.equal(receipt.sourceSha256, spec.patchedSha256);
  const first = await readFile(f.source);
  await ensureSecureStorePatch({ root: f.dir });
  await ensureSecureStorePatch({ root: f.dir, check: true });
  assert.deepEqual(await readFile(f.source), first);
  assert.equal(sha256(await readFile(f.helper)), spec.helper.sha256);
});

test("unreviewed Kotlin is refused before installing a helper or overwriting source", async t => {
  const f = await fixture(t), changed = f.upstream + "\n// unreviewed\n";
  await writeFile(f.source, changed);
  await assert.rejects(ensureSecureStorePatch({ root: f.dir }), /Unreviewed SecureStore Kotlin/);
  assert.equal(await readFile(f.source, "utf8"), changed);
  await assert.rejects(readFile(f.helper), { code: "ENOENT" });
});

test("helper tampering is refused before patching pristine module", async t => {
  const f = await fixture(t); await writeFile(f.helper, "unreviewed helper");
  await assert.rejects(ensureSecureStorePatch({ root: f.dir }), /Unreviewed SecureStore barrier/);
  assert.equal(await readFile(f.source, "utf8"), f.upstream);
});

test("partial helper-only installation can resume; incomplete module-only build cannot pass", async t => {
  const f = await fixture(t);
  await writeFile(f.helper, await readFile(path.join(root, "native-patches", spec.helper.source)));
  await ensureSecureStorePatch({ root: f.dir });
  await rm(f.helper);
  await assert.rejects(ensureSecureStorePatch({ root: f.dir, check: true }), /write barrier missing/);
  await ensureSecureStorePatch({ root: f.dir });
  await ensureSecureStorePatch({ root: f.dir, check: true });
});

for (const drift of ["version", "integrity", "registry", "prebuilt-aar", "installed-version"]) {
  test(`${drift} cannot silently substitute an unpatched native dependency`, async t => {
    const f = await fixture(t);
    if (drift === "installed-version") await writeFile(path.join(f.packageRoot, "package.json"), JSON.stringify({ version: "57.0.0" }));
    else {
      const file = path.join(f.dir, ["integrity", "registry"].includes(drift) ? "package-lock.json" : "package.json");
      const value = JSON.parse(await readFile(file, "utf8"));
      if (drift === "version") value.dependencies[spec.package] = "~57.0.3";
      if (drift === "integrity") value.packages[`node_modules/${spec.package}`].integrity = "sha512-unreviewed";
      if (drift === "registry") value.packages[`node_modules/${spec.package}`].resolved = "https://mirror.example/unreviewed.tgz";
      if (drift === "prebuilt-aar") value.expo.autolinking.android.buildFromSource = [];
      await writeFile(file, JSON.stringify(value));
    }
    await assert.rejects(ensureSecureStorePatch({ root: f.dir }));
    assert.equal(await readFile(f.source, "utf8"), f.upstream);
  });
}

test("source symlink cannot redirect patch writes", async t => {
  const f = await fixture(t), target = path.join(f.dir, "other-source.kt");
  await writeFile(target, f.upstream); await rm(f.source); await symlink(target, f.source);
  await assert.rejects(ensureSecureStorePatch({ root: f.dir }), /Expected regular file/);
  assert.equal(await readFile(target, "utf8"), f.upstream);
});

test("checked-in and generated Android build gates use the same fail-closed source verification", async () => {
  const plugin = require("../plugins/withYnxSecureStoreWriteBarrier.js"), { block } = plugin;
  const gradle = await readFile(path.join(root, "android/build.gradle"), "utf8");
  assert.equal(gradle.split(block).length, 2);
  const config = JSON.parse(await readFile(path.join(root, "app.json"), "utf8"));
  assert.ok(config.expo.plugins.includes("./plugins/withYnxSecureStoreWriteBarrier"));
  assert.match(block, /findProject\(":expo-secure-store"\)/);
  assert.match(block, /"scripts\/secure-store-native-patch\.mjs", "--check"/);
  const applyMod = async contents => {
    const config = plugin({ name: "Synthetic", slug: "synthetic" });
    return config.mods.android.projectBuildGradle({ ...config,
      modResults: { language: "groovy", contents },
      modRequest: { projectRoot: root, platform: "android", modName: "projectBuildGradle", introspect: false },
    });
  };
  const generated = await applyMod("// Synthetic generated Android project\n");
  assert.equal(generated.modResults.contents.split(block).length, 2);
  assert.equal((await applyMod(generated.modResults.contents)).modResults.contents, generated.modResults.contents);
  await assert.rejects(applyMod(generated.modResults.contents.replace('"--check"', '"--unchecked"')), /Unrecognized/);
});
