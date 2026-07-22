import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const appRoot=new URL("../",import.meta.url);
const repoRoot=new URL("../../",appRoot);
const sha=value=>createHash("sha256").update(value).digest("hex");

test("backend SBOM is standard, path-free and bound to Go inputs",async()=>{
  const raw=await readFile(new URL("artifacts/sbom/backend.cdx.json",appRoot));
  const bom=JSON.parse(raw);
  assert.equal(bom.bomFormat,"CycloneDX");
  assert.equal(bom.specVersion,"1.5");
  assert.ok(bom.components.length>0);
  assert.equal(raw.includes(Buffer.from("/Users/")),false);
  const refs=new Set([bom.metadata.component["bom-ref"],...bom.components.map(v=>v["bom-ref"])]);
  assert.equal(refs.size,bom.components.length+1);
  for(const dependency of bom.dependencies){assert.ok(refs.has(dependency.ref));for(const target of dependency.dependsOn)assert.ok(refs.has(target))}
  const properties=Object.fromEntries(bom.metadata.properties.map(v=>[v.name,v.value]));
  assert.equal(properties["ynx:go.mod:sha256"],sha(await readFile(new URL("go.mod",repoRoot))));
  assert.equal(properties["ynx:go.sum:sha256"],sha(await readFile(new URL("go.sum",repoRoot))));
});

test("vendored Wallet Auth manifest is exact and does not invent provenance or license",async()=>{
  const evidence=JSON.parse(await readFile(new URL("artifacts/vendor/wallet-auth-verification.json",appRoot),"utf8"));
  const archive=await readFile(new URL("vendor/ynx-chain-wallet-auth-1.0.0.tgz",appRoot));
  assert.equal(evidence.archive.sha256,sha(archive));
  assert.equal(evidence.archive.bytes,archive.byteLength);
  assert.equal(evidence.package.name,"@ynx-chain/wallet-auth");
  assert.equal(evidence.package.version,"1.0.0");
  assert.equal(evidence.contents.fileCount,evidence.contents.files.length);
  assert.equal(evidence.provenance.status,"unverified");
  assert.equal(evidence.license.status,"NOASSERTION");
  assert.equal(evidence.license.inArchive,false);
});
