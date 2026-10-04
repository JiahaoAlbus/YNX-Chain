import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, symlink, lstat, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inventoryContainedTree, stageContainedSdk } from "../scripts/stage-contained-sdk.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "ynx-contained-stage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDirectory = path.join(root, "package"), softwareDirectory = path.join(root, "software"), outputParent = path.join(root, "output"), manifestPath = path.join(root, "manifest.json");
  await Promise.all([packageDirectory, softwareDirectory, outputParent].map(p => mkdir(p)));
  await writeFile(path.join(packageDirectory, "package.json"), '{"name":"@ynx-chain/wallet-auth","type":"module"}');
  await writeFile(path.join(packageDirectory, "index.js"), 'throw Error("SDK MUST NOT EXECUTE");');
  await mkdir(path.join(softwareDirectory, "tool")); await mkdir(path.join(softwareDirectory, ".bin"));
  await writeFile(path.join(softwareDirectory, "tool/run.js"), 'throw Error("SOFTWARE MUST NOT EXECUTE");');
  await chmod(path.join(softwareDirectory, "tool/run.js"), 0o755);
  await symlink("../tool/run.js", path.join(softwareDirectory, ".bin/run"));
  const manifest = { sources: await inventoryContainedTree(packageDirectory, false), software: await inventoryContainedTree(softwareDirectory) };
  const bytes = JSON.stringify(manifest); await writeFile(manifestPath, bytes);
  return { root, manifest, packageDirectory, softwareDirectory, outputParent, manifestPath, manifestSha256: createHash("sha256").update(bytes).digest("hex") };
}

test("stages exact package and contained locked software without executing or replacing inputs", async t => {
  const f = await fixture(t), result = await stageContainedSdk(f);
  assert.equal(result.byteExact, true); assert.equal(result.sdkEvaluated, false); assert.equal(result.applicationLinkChanged, false);
  assert.equal(result.sourceFiles, 2); assert.equal(result.softwareRecords, 2);
  assert.ok((await lstat(result.packageDirectory)).isDirectory());
  assert.equal((await lstat(path.join(result.packageDirectory, "node_modules/tool/run.js"))).mode & 0o777, 0o755);
  assert.deepEqual(await inventoryContainedTree(path.join(result.packageDirectory, "node_modules")), f.manifest.software);
  assert.match(await readFile(path.join(f.packageDirectory, "index.js"), "utf8"), /MUST NOT EXECUTE/);
  const again = await stageContainedSdk(f); assert.notEqual(again.packageDirectory, result.packageDirectory);
});

test("requires the explicit frozen manifest digest", async t => {
  const f = await fixture(t);
  await assert.rejects(stageContainedSdk({ ...f, manifestSha256: undefined }), /Explicit frozen/);
  await assert.rejects(stageContainedSdk({ ...f, manifestSha256: "0".repeat(64) }), /SHA256 mismatch/);
});

for (const tree of ["packageDirectory", "softwareDirectory"]) test(`rejects additional ${tree} files`, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f[tree], "extra.js"), "unexpected");
  await assert.rejects(stageContainedSdk(f), /differs from frozen/);
});

test("rejects external and package-source links", async t => {
  const f = await fixture(t);
  await symlink("../package/index.js", path.join(f.softwareDirectory, "escape"));
  await assert.rejects(inventoryContainedTree(f.softwareDirectory), /External/);
  await symlink(path.join(f.packageDirectory, "index.js"), path.join(f.packageDirectory, "absolute"));
  await assert.rejects(inventoryContainedTree(f.packageDirectory, false), /forbidden/);
});

for (const target of ["missing.js", "/no-such-ynx-package-file"]) test(`rejects unsafe software link ${target}`, async t => {
  const f = await fixture(t);
  await symlink(target, path.join(f.softwareDirectory, "unsafe"));
  await assert.rejects(inventoryContainedTree(f.softwareDirectory));
});

for (const [tree, file] of [["packageDirectory", "index.js"], ["softwareDirectory", "tool/run.js"]]) test(`rejects changed bytes in ${tree}`, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f[tree], file), "changed bytes");
  await assert.rejects(stageContainedSdk(f), /differs from frozen/);
});

test("rejects overlapping output without modifying original trees", async t => {
  const f = await fixture(t);
  await assert.rejects(stageContainedSdk({ ...f, outputParent: f.packageDirectory }), /must not overlap/);
  assert.deepEqual(await inventoryContainedTree(f.packageDirectory, false), f.manifest.sources);
});

test("rejects traversal and duplicate manifest records even with a matching digest", async t => {
  const f = await fixture(t);
  for (const sources of [[{ ...f.manifest.sources[0], path: "../escape" }], [f.manifest.sources[0], f.manifest.sources[0]]]) {
    const bytes = JSON.stringify({ ...f.manifest, sources }); await writeFile(f.manifestPath, bytes);
    await assert.rejects(stageContainedSdk({ ...f, manifestSha256: createHash("sha256").update(bytes).digest("hex") }), /Invalid or duplicate/);
  }
});
