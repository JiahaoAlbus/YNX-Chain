import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readReleaseFiles } from "./release-files.mjs";

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), "ynx-dex-release-files-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const dist = path.join(base, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<main>DEX</main>");
  await writeFile(path.join(dist, "assets", "app.js"), "export const chain=6423;");
  await writeFile(path.join(base, "outside.txt"), "must not be packaged");
  await mkdir(path.join(base, "outside-dir"));
  await writeFile(path.join(base, "outside-dir", "private.txt"), "must not be packaged");
  return { base, dist };
}

test("ordinary nested build files retain deterministic paths and exact bytes", async t => {
  const { dist } = await fixture(t);
  const files = await readReleaseFiles(dist);
  assert.deepEqual(files.map(f => [f.relative, f.data.toString()]), [
    ["assets/app.js", "export const chain=6423;"], ["index.html", "<main>DEX</main>"]
  ]);
});

for (const [name, target] of [
  ["internal file", "index.html"], ["external file", "../outside.txt"],
  ["internal directory", "assets"], ["external directory", "../outside-dir"],
  ["broken link", "missing"], ["directory loop", "."]
]) test(`reject ${name} symlink before returning any package contents`, async t => {
  const { dist } = await fixture(t);
  await symlink(target, path.join(dist, "linked"));
  await assert.rejects(readReleaseFiles(dist), /symlink forbidden/);
});

test("reject a symlinked dist root", async t => {
  const { base, dist } = await fixture(t);
  const alias = path.join(base, "dist-link");
  await symlink(dist, alias);
  await assert.rejects(readReleaseFiles(alias), /real directory/);
});
