import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const walletRoot = fileURLToPath(new URL("..", import.meta.url));
const specPath = path.join(walletRoot, "native-patches/expo-secure-store-57.0.3.json");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function readPatchSpecification() {
  return JSON.parse(await readFile(specPath, "utf8"));
}

async function regularFile(file, optional = false) {
  try { assert.ok((await lstat(file)).isFile(), `Expected regular file: ${file}`); return await readFile(file); }
  catch (error) { if (optional && error.code === "ENOENT") return null; throw error; }
}

async function atomicWrite(file, bytes) {
  const temp = `${file}.ynx-${randomUUID()}`;
  await writeFile(temp, bytes, { flag: "wx", mode: 0o644 });
  await rename(temp, file);
}

/** Exact upstream bytes only; drift is a build failure, never a fuzzy patch. */
export async function ensureSecureStorePatch({ check = false, root = walletRoot } = {}) {
  const spec = await readPatchSpecification();
  assert.equal(spec.package, "expo-secure-store");
  assert.equal(spec.version, "57.0.3");
  assert.equal(spec.file, "android/src/main/java/expo/modules/securestore/SecureStoreModule.kt");
  assert.equal(spec.helper.source, "YNXSecureStoreWriteBarrier.kt");
  assert.equal(spec.helper.destination, "android/src/main/java/expo/modules/securestore/YNXSecureStoreWriteBarrier.kt");
  const config = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(config.dependencies[spec.package], spec.version, "SecureStore must use the reviewed exact version");
  assert.ok(config.expo?.autolinking?.android?.buildFromSource?.includes("expo-secure-store"),
    "SecureStore must compile patched Kotlin instead of the unpatched prebuilt AAR");
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const locked = lock.packages[`node_modules/${spec.package}`];
  assert.equal(locked.version, spec.version);
  assert.equal(locked.resolved, `https://registry.npmjs.org/expo-secure-store/-/expo-secure-store-${spec.version}.tgz`, "SecureStore must use the reviewed official archive");
  assert.equal(locked.integrity, spec.integrity, "SecureStore lock integrity changed");
  const packageRoot = path.join(root, "node_modules", spec.package);
  assert.equal(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version, spec.version);
  const sourcePath = path.join(packageRoot, spec.file);
  const bytes = await regularFile(sourcePath);
  const digest = sha256(bytes);
  assert.ok([spec.upstreamSha256, spec.patchedSha256].includes(digest), "Unreviewed SecureStore Kotlin source; refusing to overwrite it");
  let patched = bytes.toString("utf8");
  if (digest === spec.upstreamSha256) {
    for (const { before, after } of spec.edits) {
      assert.equal(patched.split(before).length, 2, "Patch anchor must occur exactly once");
      patched = patched.replace(before, after);
    }
  }
  assert.equal(sha256(patched), spec.patchedSha256, "Patched SecureStore hash mismatch");
  const helper = await regularFile(path.join(walletRoot, "native-patches", spec.helper.source));
  assert.equal(sha256(helper), spec.helper.sha256);
  const destination = path.join(packageRoot, spec.helper.destination);
  const previousHelper = await regularFile(destination, true);
  assert.ok(previousHelper === null || sha256(previousHelper) === spec.helper.sha256, "Unreviewed SecureStore barrier; refusing to overwrite it");
  if (check) {
    assert.equal(digest, spec.patchedSha256, "Native SecureStore patch missing; run npm run native-patch:apply");
    assert.ok(previousHelper, "Native SecureStore write barrier missing");
  } else {
    // Both input files are checked before any mutation. Partial installation is
    // safely resumable; --check never accepts an absent helper or original module.
    if (!previousHelper) await atomicWrite(destination, helper);
    if (digest !== spec.patchedSha256) await atomicWrite(sourcePath, patched);
  }
  assert.equal(sha256(await regularFile(sourcePath)), spec.patchedSha256);
  assert.equal(sha256(await regularFile(destination)), spec.helper.sha256);
  return { package: spec.package, version: spec.version, sourceSha256: spec.patchedSha256, barrierSha256: spec.helper.sha256, androidBuildFromSource: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--check"), "Unknown native patch argument");
  console.log(JSON.stringify(await ensureSecureStorePatch({ check: args[0] === "--check" })));
}
