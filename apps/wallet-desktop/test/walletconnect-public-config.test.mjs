import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {runInNewContext} from 'node:vm';
import {desktopReleaseIdentity} from '../scripts/release-provenance.mjs';
import { buildPublicWalletConnectConfig, loadPublicWalletConnectConfig, parsePublicWalletConnectConfig, WALLETCONNECT_PUBLIC_CONFIG_FILE } from "../src/walletconnect-public-config.mjs";
import { createWalletConnectCore } from "../src/walletconnect-transport.mjs";

test("the pinned real Node SDK constructs its default storage before any Relay connection", () => {
  const core = createWalletConnectCore({projectId:buildPublicWalletConnectConfig({}).projectId,logger:"silent"});
  assert.equal(typeof core.storage.getItem,"function");
  assert.equal(core.relayer.connected,false);
});
const projectId = "a".repeat(32);
test("final package loads public Pair config with an empty user environment", async () => {
  const shipped = buildPublicWalletConnectConfig({ YNX_WALLETCONNECT_PROJECT_ID: projectId, API_SECRET: "must-never-be-packaged" });
  assert.deepEqual(Object.keys(shipped).sort(), ["chainId", "projectId", "schemaVersion"]);
  const loaded = await loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async file => { assert.equal(file, path.join("/qa/resources", WALLETCONNECT_PUBLIC_CONFIG_FILE)); return Buffer.from(JSON.stringify(shipped)); } });
  assert.deepEqual(loaded, shipped);
});

test("actual packaging hook writes public config with a controlled archive assembler and empty user environment", async t => {
  // This test covers public config/normal hook ordering, not canonical ASAR
  // acceptance. The real archive path is covered by release-provenance tests.
  const hook=(await readFile(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8')).replace(/^import .*;$/mg,'').replace('export default async function afterPack','async function afterPack').replace(/^export /mg,'');
  const assemblies=[],integrity={algorithm:'SHA256',hash:'b'.repeat(64)},context={execFileSync,path,writeFile,desktopReleaseIdentity,assembleCanonicalDesktopPackage:(...args)=>assemblies.push(args),desktopAsarHeaderIntegrity:()=>integrity,buildPublicWalletConnectConfig,WALLETCONNECT_PUBLIC_CONFIG_FILE};
  runInNewContext(hook+'\nthis.afterPack=afterPack;',context);
  const root = await mkdtemp(path.join(tmpdir(), "ynx-pair-public-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "apps/wallet-desktop");
  for (const [name, text] of Object.entries({ "apps/wallet-desktop/package.json": '{"version":"0.6.11"}', "apps/wallet-desktop/src/main.mjs": "// isolated packaging fixture\n", "packages/wallet-auth/src/index.js": "// isolated SDK fixture\n" })) {
    const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text);
  }
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init"]); git(["add", "."]); git(["-c", "user.name=YNX QA fixture", "-c", "user.email=qa@example.invalid", "commit", "-m", "isolated packaging fixture"]);
  const oldId = process.env.YNX_WALLETCONNECT_PROJECT_ID, oldSha = process.env.GITHUB_SHA;
  process.env.YNX_WALLETCONNECT_PROJECT_ID = projectId; process.env.GITHUB_SHA = git(["rev-parse", "HEAD"]).toString().trim();
  try {
    for (const platform of ["win32", "linux", ...(process.platform === "darwin" ? ["darwin"] : [])]) {
      const out = path.join(root, platform), resources = platform === "darwin" ? path.join(out, "YNX Wallet.app/Contents/Resources") : path.join(out, "resources");
      await mkdir(resources, { recursive: true });
      if (platform === "darwin") await writeFile(path.join(out, "YNX Wallet.app/Contents/Info.plist"), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>fixture</string><key>CFBundleShortVersionString</key><string>0.0.0</string><key>LSMinimumSystemVersion</key><string>1.0</string><key>CFBundleURLTypes</key><array/><key>NSAppTransportSecurity</key><dict/><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>'+integrity.hash+'</string></dict></dict></dict></plist>');
      const count=assemblies.length;
      await context.afterPack({ electronPlatformName: platform, appOutDir: out, packager: { projectDir: project, appInfo: { version: "0.6.11", productFilename: "YNX Wallet" } } });
      assert.equal(assemblies.length,count+1);assert.deepEqual(assemblies.at(-1),[resources,project]);
      assert.equal((await loadPublicWalletConnectConfig({ resourcesPath: resources, environment: {} })).projectId, projectId);
    }
  } finally {
    if (oldId === undefined) delete process.env.YNX_WALLETCONNECT_PROJECT_ID; else process.env.YNX_WALLETCONNECT_PROJECT_ID = oldId;
    if (oldSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = oldSha;
  }
});
test("missing genuine Project ID remains unconfigured; malformed config never downgrades silently", async () => {
  assert.equal(buildPublicWalletConnectConfig({}).projectId, "41857128a14a593ca4e4a7cb7c838d71");
  assert.equal(buildPublicWalletConnectConfig({ YNX_WALLETCONNECT_PROJECT_ID: "" }).projectId, null);
  const missing = await loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } });
  assert.equal(missing.projectId, null);
  for (const change of [{ chainId: "eip155:1" }, { projectId: "wc:secret@2?secret=value" }, { secret: "hidden" }, { schemaVersion: 2 }]) assert.throws(() => parsePublicWalletConnectConfig({ ...buildPublicWalletConnectConfig({}), ...change }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
  await assert.rejects(() => loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: {}, read: async () => Buffer.alloc(2049) }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
  await assert.rejects(() => loadPublicWalletConnectConfig({ resourcesPath: "/qa/resources", environment: { YNX_WALLETCONNECT_PROJECT_ID: "invalid" }, read: async () => Buffer.from(JSON.stringify(buildPublicWalletConnectConfig({ YNX_WALLETCONNECT_PROJECT_ID: projectId }))) }), error => error.code === "WALLETCONNECT_CONFIG_INVALID");
});
