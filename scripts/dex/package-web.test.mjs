import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { packageDexWeb } from "./package-web.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ynx-dex-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  await mkdir(path.join(root, "apps/dex/dist"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), "apps/dex/dist/\nrelease/\n");
  await writeFile(path.join(root, "apps/dex/package.json"), JSON.stringify({ version: "0.1.0-testnet-preview.1" }));
  await writeFile(path.join(root, "apps/dex/source.js"), "export const chain=6423;");
  git("init", "--quiet"); git("add", ".");
  git("-c", "user.name=Package Test", "-c", "user.email=package-test@example.invalid", "commit", "--quiet", "-m", "fixture");
  const sourceCommit = git("rev-parse", "HEAD");
  for (const [name, data] of Object.entries({
    "index.html": "<main>DEX</main>", "sw.js": "self.addEventListener('fetch',()=>{});",
    "manifest.webmanifest": JSON.stringify({ id: "com.ynxweb4.dex.web", name: "YNX DEX Testnet Preview", icons: [{ src: "/a.png" }, { src: "/b.png" }] })
  })) await writeFile(path.join(root, "apps/dex/dist", name), data);
  return { root, sourceCommit, outputDir: path.join(root, "release/unique-run") };
}

test("explicit exact source packages an independent output with matching archive and file hashes", async t => {
  const f = await fixture(t);
  const artifact = await packageDexWeb({ rootDir: f.root, sourceCommit: f.sourceCommit, outputDir: f.outputDir });
  assert.equal(artifact.sourceBaseCommit, f.sourceCommit);
  const archive = await readFile(path.join(f.outputDir, artifact.file));
  assert.equal(createHash("sha256").update(archive).digest("hex"), artifact.sha256);
  assert.equal(archive.length, artifact.sizeBytes);
  const tar = gunzipSync(archive), members = [];
  for (let offset = 0; tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().split("\0")[0];
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().split("\0")[0], 8);
    const bytes = tar.subarray(offset + 512, offset + 512 + size);
    assert.deepEqual(bytes, await readFile(path.join(f.root, "apps/dex/dist", name)));
    members.push(name); offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(members, ["index.html", "manifest.webmanifest", "sw.js"]);
});

test("invalid source fails before creating output or reading build contents", async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, "apps/dex/dist"), { recursive: true });
  await assert.rejects(packageDexWeb({ rootDir: f.root, sourceCommit: "bad", outputDir: f.outputDir }), /exact lowercase/);
  await assert.rejects(readdir(path.dirname(f.outputDir)), { code: "ENOENT" });
});

test("changed product source cannot leave a failed release artifact", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "apps/dex/source.js"), "changed");
  await assert.rejects(packageDexWeb({ rootDir: f.root, sourceCommit: f.sourceCommit, outputDir: f.outputDir }), /source changed/);
  await assert.rejects(readdir(path.dirname(f.outputDir)), { code: "ENOENT" });
});

test("an existing release directory and its bytes are never replaced", async t => {
  const f = await fixture(t);
  await mkdir(f.outputDir, { recursive: true });
  await writeFile(path.join(f.outputDir, "previous-release"), "keep this");
  await assert.rejects(packageDexWeb({ rootDir: f.root, sourceCommit: f.sourceCommit, outputDir: f.outputDir }), { code: "EEXIST" });
  assert.deepEqual(await readdir(f.outputDir), ["previous-release"]);
  assert.equal(await readFile(path.join(f.outputDir, "previous-release"), "utf8"), "keep this");
});

test("a linked manifest is rejected before output creation", async t => {
  const f = await fixture(t), manifest = path.join(f.root, "apps/dex/dist/manifest.webmanifest");
  await writeFile(path.join(f.root, "outside.json"), await readFile(manifest));
  await rm(manifest);
  await symlink(path.join(f.root, "outside.json"), manifest);
  await assert.rejects(packageDexWeb({ rootDir: f.root, sourceCommit: f.sourceCommit, outputDir: f.outputDir }), /symlink forbidden/);
  await assert.rejects(readdir(path.dirname(f.outputDir)), { code: "ENOENT" });
});
