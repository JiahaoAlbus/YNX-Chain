import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root=path.resolve(import.meta.dirname,"../..");const release=path.join(root,"release/dex");const sha256=data=>createHash("sha256").update(data).digest("hex");const manifest=JSON.parse(await readFile(path.join(release,"artifact-manifest.json"),"utf8"));
assert.equal(manifest.productId,"ynx-dex");assert.equal(manifest.mainnet,false);assert.equal(manifest.audited,false);assert.equal(manifest.productionLiquidity,false);for(const value of Object.values(manifest.claims))assert.equal(value,false,"unproven artifact claim must remain false");
for(const artifact of manifest.artifacts){if(artifact.file){const data=await readFile(path.join(release,artifact.file));assert.equal(data.length,artifact.sizeBytes,`${artifact.file} size`);assert.equal(sha256(data),artifact.sha256,`${artifact.file} digest`)}if(artifact.files)for(const file of artifact.files){const data=await readFile(path.join(root,file.path));assert.equal(data.length,file.sizeBytes,`${file.path} size`);assert.equal(sha256(data),file.sha256,`${file.path} digest`)}}
const web=JSON.parse(await readFile(path.join(release,"web-pwa-artifact.json"),"utf8"));const webData=await readFile(path.join(release,web.file));assert.equal(sha256(webData),web.sha256);for(const key of ["installedLocal","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased"])assert.equal(web[key],false,key);
console.log("YNX DEX artifacts: PASS");
