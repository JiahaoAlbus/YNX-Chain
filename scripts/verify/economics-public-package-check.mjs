import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJSON = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const metadata = readJSON("public-product-metadata.json");
const release = readJSON("product-release.json");

assert.equal(metadata.schemaVersion, 1);
assert.equal(release.schemaVersion, 1);
assert.equal(metadata.sourceCommit, release.sourceCommit);
assert.deepEqual(metadata.product.canonicalRoutes, ["/ynxt", "/economics"]);
assert.deepEqual(metadata.locales, ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]);
assert.equal(release.states.implementedLocal, true);
assert.equal(release.states.testedLocal, true);
for (const key of ["installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"]) {
  assert.equal(release.states[key], false, `${key} must remain false without direct evidence`);
}

const commit = spawnSync("git", ["cat-file", "-e", `${release.sourceCommit}^{commit}`], { cwd: root });
assert.equal(commit.status, 0, "sourceCommit must identify an existing commit");

for (const artifact of release.artifacts) {
  const bytes = fs.readFileSync(path.join(root, artifact.path));
  assert.equal(bytes.byteLength, artifact.bytes, `${artifact.path} byte count`);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `${artifact.path} digest`);
  assert.equal(artifact.downloadURL, null, `${artifact.path} must not claim hosting`);
}
const artifact = release.artifacts[0];
assert.equal(metadata.assets.socialPreview.sha256, artifact.sha256);
assert.equal(metadata.assets.socialPreview.bytes, artifact.bytes);

const publicText = JSON.stringify({ metadata, release });
for (const disallowed of ["Co" + "dex", "Work" + "tree", "example" + ".com", "local" + "host", "Coming" + " soon", "guaranteed" + " APY"]) {
  assert.equal(publicText.includes(disallowed), false, `public package contains disallowed text: ${disallowed}`);
}

console.log(`economics public package verified: source=${release.sourceCommit} artifact=${artifact.sha256} bytes=${artifact.bytes}`);
