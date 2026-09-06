import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildAll, validateExtensionModuleGraph} from "../scripts/build.mjs";

test("actual extension artifacts have complete browser module and manifest graphs", async t => {
  const dist = await mkdtemp(join(tmpdir(), "ynx-extension-artifact-"));
  t.after(() => rm(dist, {recursive: true, force: true}));
  await buildAll({dist});
  for (const variant of ["chromium", "firefox"]) {
    const target = join(dist, variant);
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
