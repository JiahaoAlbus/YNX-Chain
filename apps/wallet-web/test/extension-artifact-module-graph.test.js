import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {buildAll, validateExtensionModuleGraph} from "../scripts/build.mjs";
import sharp from "sharp";

async function assertEqualTree(left,right,label){
  const entries=(await readdir(left,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual((await readdir(right)).sort(),entries.map(entry=>entry.name).sort(),label);
  for(const entry of entries){
    const path=join(left,entry.name),comparison=join(right,entry.name);
    if(entry.isDirectory())await assertEqualTree(path,comparison,`${label}/${entry.name}`);
    else assert.deepEqual(await readFile(comparison),await readFile(path),`${label}/${entry.name}`);
  }
}

test("actual extension artifacts have complete browser module and manifest graphs", async t => {
  const dist = await mkdtemp(join(tmpdir(), "ynx-extension-artifact-"));
  t.after(() => rm(dist, {recursive: true, force: true}));
  // The authority export sits outside dist because buildAll deliberately recreates dist.
  const authorityDirectory=await mkdtemp(join(tmpdir(),"ynx-artifact-authorities-"));
  t.after(()=>rm(authorityDirectory,{recursive:true,force:true}));
  const authorityFile=join(authorityDirectory,"build-authorities.json");
  const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:new URL("../../..",import.meta.url),encoding:"utf8"}).trim();
  await buildAll({dist,authorityOutput:authorityFile,sourceCommit});
  await t.test("explicit archive authority mode reproduces every Git-build output byte",async()=>{
    const replay=join(authorityDirectory,"replay");await buildAll({dist:replay,authorityFile,sourceCommit});
    for(const variant of ["chromium","firefox","pwa","hosted"])await assertEqualTree(join(dist,variant),join(replay,variant),variant);
    const tampered=JSON.parse(await readFile(authorityFile,"utf8"));tampered.records[0].commit="b".repeat(40);
    const bad=join(authorityDirectory,"wrong-authority.json");await writeFile(bad,JSON.stringify(tampered));
    await assert.rejects(buildAll({dist:join(authorityDirectory,"bad"),authorityFile:bad,sourceCommit}),/Immutable Wallet build authority archive changed|Missing or changed build authority/);
  });
  let firstIcon;
  for (const variant of ["chromium", "firefox"]) {
    const target = join(dist, variant);
    const shippedManifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8"));
    assert.equal(shippedManifest.incognito, "not_allowed");
    const icon = await readFile(join(target, shippedManifest.icons["128"]));
    const iconMetadata = await sharp(icon).metadata();
    assert.deepEqual([iconMetadata.width, iconMetadata.height, iconMetadata.format], [128,128,"png"]);
    if (firstIcon) assert.deepEqual(icon, firstIcon); else firstIcon = icon;
    if (variant === "firefox") {
      assert.equal(shippedManifest.browser_specific_settings.gecko.strict_min_version, "142.0");
      assert.deepEqual(shippedManifest.browser_specific_settings.gecko.data_collection_permissions,
        {required: ["authenticationInfo", "financialAndPaymentInfo", "websiteContent"]});
    } else assert.equal("browser_specific_settings" in shippedManifest, false);
    await t.test(`${variant}: all shipped JS, HTML and manifest references resolve`, async () => {
      const result = await validateExtensionModuleGraph(target);
      assert.ok(result.entryPoints > 20); assert.ok(result.modules >= result.entryPoints); assert.ok(result.references > 5);
    });
    await t.test(`${variant}: missing transitive import fails artifact verification`, async () => {
      const file = join(target, "extension-durability.js"), bytes = await readFile(file);
      await rm(file);
      try { await assert.rejects(validateExtensionModuleGraph(target), /extension-durability/); }
      finally { await writeFile(file, bytes); }
    });
    await t.test(`${variant}: missing manifest worker fails artifact verification`, async () => {
      const file = join(target, "manifest.json"), bytes = await readFile(file), manifest = JSON.parse(bytes);
      if (variant === "chromium") manifest.background.service_worker = "missing-worker.js";
      else manifest.background.scripts = ["missing-worker.js"];
      await writeFile(file, JSON.stringify(manifest));
      try { await assert.rejects(validateExtensionModuleGraph(target), /missing-worker/); }
      finally { await writeFile(file, bytes); }
    });
    await t.test(`${variant}: missing HTML entry, bare imports and escaping imports are rejected`, async () => {
      const page = join(target, "signer.html"), bytes = await readFile(page);
      await writeFile(page, '<script type="module" src="missing-review.js"></script>');
      try { await assert.rejects(validateExtensionModuleGraph(target), /missing-review/); }
      finally { await writeFile(page, bytes); }
      const script = join(target, "artifact-probe.js");
      for (const reference of ["ethers", "../outside.js"]) {
        await writeFile(script, `import ${JSON.stringify(reference)};`);
        await assert.rejects(validateExtensionModuleGraph(target), /must be relative|escapes package/);
      }
      await rm(script);
    });
  }
});
