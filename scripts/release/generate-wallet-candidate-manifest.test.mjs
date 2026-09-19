import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {generateWalletCandidateManifest} from "./generate-wallet-candidate-manifest.mjs";

test("candidate manifest binds exact bytes and keeps release claims false", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"ynx-wallet-candidate-"));
  execFileSync("git",["init","-q"],{cwd:root});
  execFileSync("git",["config","user.email","test@ynx.invalid"],{cwd:root});
  execFileSync("git",["config","user.name","YNX Test"],{cwd:root});
  for (const directory of ["apps/wallet","apps/wallet-web","apps/wallet-desktop","packages/wallet-auth","out"]) { await mkdir(path.join(root,directory),{recursive:true}); await writeFile(path.join(root,directory,"identity"),directory); }
  await writeFile(path.join(root,"out","wallet.apk"),"real artifact bytes");
  await writeFile(path.join(root,"out","sbom.json"),"{\"bomFormat\":\"CycloneDX\"}\n");
  execFileSync("git",["add","."],{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
  const sourcecommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), output=path.join(root,"candidate");
  const {manifest,rollback}=await generateWalletCandidateManifest({root,output,sourcecommit,sbom:"out/sbom.json",artifacts:["android-apk|unsigned-android-release|out/wallet.apk"]});
  assert.equal(manifest.artifacts[0].bytes,19); assert.match(manifest.artifacts[0].sha256,/^[0-9a-f]{64}$/u);
  assert.equal(manifest.currentSourceDeployedPublic,false); assert.equal(manifest.productionSigned,false); assert.equal(rollback.ready,false);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,"release-manifest.json"),"utf8")),manifest);
});

test("candidate manifest rejects path escape and source drift", async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),"ynx-wallet-candidate-reject-"));
  execFileSync("git",["init","-q"],{cwd:root}); execFileSync("git",["config","user.email","test@ynx.invalid"],{cwd:root}); execFileSync("git",["config","user.name","YNX Test"],{cwd:root});
  for (const directory of ["apps/wallet","apps/wallet-web","apps/wallet-desktop","packages/wallet-auth"]) { await mkdir(path.join(root,directory),{recursive:true}); await writeFile(path.join(root,directory,"identity"),directory); }
  await writeFile(path.join(root,"sbom.json"),"{}"); execFileSync("git",["add","."],{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
  const sourcecommit=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  await assert.rejects(generateWalletCandidateManifest({root,output:path.join(root,"out"),sourcecommit,sbom:"sbom.json",artifacts:["pwa|unsigned-web-bundle|../outside.zip"]}),/stay under root/u);
  await writeFile(path.join(root,"apps/wallet","identity"),"dirty");
  await assert.rejects(generateWalletCandidateManifest({root,output:path.join(root,"out"),sourcecommit,sbom:"sbom.json",artifacts:["pwa|unsigned-web-bundle|sbom.json"]}));
});
