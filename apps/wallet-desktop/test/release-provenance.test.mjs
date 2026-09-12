import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { desktopReleaseIdentity, verifyDesktopPackage } from "../scripts/release-provenance.mjs";

const actualProject = fileURLToPath(new URL("..", import.meta.url));
const asarCLI = createRequire(path.join(actualProject, "package.json")).resolve("@electron/asar/bin/asar.js");

async function fixture(t, { includeRegistry = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "ynx-desktop-provenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "apps/wallet-desktop"), stage = path.join(root, "package"), resources = path.join(root, "resources");
  const files = { "apps/wallet-desktop/package.json": '{"name":"fixture","version":"0.6.4"}',
    "apps/wallet-desktop/src/main.mjs": "export const fixture = true;\n",
    "packages/wallet-auth/package.json": '{"name":"@ynx-chain/wallet-auth","version":"1.1.0"}',
    "packages/wallet-auth/src/index.js": "export const fixture = 1;\n",
    "packages/wallet-auth/product-session-registry.json": '{"fixture":"registered-products"}\n',
    "packages/wallet-auth/src/runtime.json": '{"fixture":true}\n',
    "packages/wallet-auth/src/index.d.ts": "export declare const fixture: number;\n" };
  if (!includeRegistry) delete files["packages/wallet-auth/product-session-registry.json"];
  for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), content); }
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init"]); git(["add", "apps", "packages"]); git(["-c", "user.name=YNX synthetic test", "-c", "user.email=fixture@example.invalid", "commit", "-m", "synthetic fixture"]);
  await symlink(path.join(actualProject, "node_modules"), path.join(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(resources);
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith(".d.ts")) continue; // Match electron-builder's actual package filter.
    const packed = name.startsWith("apps/wallet-desktop/") ? name.slice("apps/wallet-desktop/".length) : `node_modules/@ynx-chain/wallet-auth/${name.slice("packages/wallet-auth/".length)}`;
    await mkdir(path.dirname(path.join(stage, packed)), { recursive: true }); await writeFile(path.join(stage, packed), content);
  }
  const savedSHA = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = git(["rev-parse", "HEAD"]).toString().trim();
  t.after(() => { if (savedSHA === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = savedSHA; });
  const identity = desktopReleaseIdentity(project, "0.6.4");
  await writeFile(path.join(resources, "ynx-wallet-build-identity.json"), JSON.stringify(identity));
  // This pinned ASAR version resolves createPackage before its write stream's
  // final flush. Waiting for the packaging process to exit matches release use
  // and prevents a concurrent test from reading a half-written archive.
  const pack = () => execFileSync(process.execPath, [asarCLI, "pack", stage, path.join(resources, "app.asar")], { stdio: "pipe" });
  await pack(); return { root, project, stage, resources, identity, pack };
}

test("every runtime Wallet and SDK byte matches the exact commit, with excluded declarations explicit", async t => {
  const f = await fixture(t), result = verifyDesktopPackage(f.resources, f.project);
  assert.equal(result.files.length, 5); assert.equal(result.packagedSourceVerified, true);
  assert.deepEqual(result.excludedTypeDeclarations, ["packages/wallet-auth/src/index.d.ts"]);
  assert.equal(result.sourceVerificationScope, "every runtime Wallet and SDK source");
  assert.equal(result.sourceCommit, f.identity.sourceCommit); assert.equal(result.installedRuntimeVerified, false);
  assert.equal(result.productionSigned, false); assert.equal(result.storeReleased, false);
  assert.equal(desktopReleaseIdentity(f.project, "0.0.9").sourceVersion, "0.6.4"); // Existing upgrade-preflight stays truthful.
});

test("a missing runtime JSON remains a hard verification failure", async t => {
  const f = await fixture(t);
  await rm(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/src/runtime.json")); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /was not found in this archive/);
});

test("changed packaged SDK or forged identity fails verification", async t => {
  const f = await fixture(t), file = path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/src/index.js"), original = await readFile(file);
  await writeFile(file, "export const fixture = 'altered';\n"); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Packaged source differs/);
  await writeFile(file, original); await f.pack();
  await writeFile(path.join(f.resources, "ynx-wallet-build-identity.json"), JSON.stringify({ ...f.identity, sourceCommit: "a".repeat(40) }));
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Embedded build identity/);
});

test("dirty tracked source and a different CI commit cannot acquire release identity", async t => {
  const f = await fixture(t);
  process.env.GITHUB_SHA = "a".repeat(40);
  assert.throws(() => desktopReleaseIdentity(f.project, "0.6.4"), /CI source and checkout differ/);
  process.env.GITHUB_SHA = f.identity.sourceCommit;
  await writeFile(path.join(f.project, "src/main.mjs"), "export const changed = true;\n");
  assert.throws(() => desktopReleaseIdentity(f.project, "0.6.4"));
});


test("SDK root registry is mandatory in the packaged archive", async t => {
  const f = await fixture(t);
  await rm(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/product-session-registry.json")); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /was not found in this archive/);
});

test("SDK root registry tampering is rejected even when src bytes match", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.stage, "node_modules/@ynx-chain/wallet-auth/product-session-registry.json"), '{"fixture":"other-products"}\n'); await f.pack();
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Packaged source differs: packages\/wallet-auth\/product-session-registry\.json/);
});

test("SDK root registry must exist in the selected source commit", async t => {
  const f = await fixture(t, { includeRegistry: false });
  assert.throws(() => verifyDesktopPackage(f.resources, f.project), /Required runtime asset is missing from the selected commit: packages\/wallet-auth\/product-session-registry\.json/);
});
