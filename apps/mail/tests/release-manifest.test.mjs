import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const release = JSON.parse(
  readFileSync(new URL("../product-release.json", import.meta.url), "utf8"),
);

test("Mail release record exposes every acceptance state and evidence field", () => {
  for (const key of [
    "productId", "name", "branch", "commit", "version", "surfaces",
    "implementedLocal", "testedLocal", "installedLocal", "integratedCentral",
    "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned",
    "storeReleased", "publicUrls", "healthUrls", "artifactUrls", "sha256",
    "bytes", "signingClass", "minOS", "installEvidence", "centralIntegration",
    "knownLimitations", "generatedAt",
  ]) assert.ok(Object.hasOwn(release, key), `missing ${key}`);
  assert.equal(release.productId, "com.ynx.mail");
  assert.match(release.commit, /^[0-9a-f]{40}$/);
  for (const key of ["publicUrls", "healthUrls", "artifactUrls", "installEvidence", "knownLimitations"])
    assert.ok(Array.isArray(release[key]), `${key} must be an array`);
  for (const key of ["implementedLocal", "testedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"])
    assert.equal(typeof release[key], "boolean", `${key} must be boolean`);
  if (release.downloadHosted) {
    assert.ok(release.artifactUrls.length > 0);
    assert.ok(Object.keys(release.sha256).length > 0);
    assert.ok(Object.values(release.bytes).every((value) => Number.isInteger(value) && value > 0));
    for (const url of release.artifactUrls) {
      assert.match(url, /^https:\/\//);
      const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      assert.match(release.sha256[name], /^[0-9a-f]{64}$/, `missing digest for ${name}`);
      assert.ok(Number.isInteger(release.bytes[name]) && release.bytes[name] > 0, `missing size for ${name}`);
    }
  }
  if (!release.deployedStaging && !release.deployedPublic)
    assert.deepEqual(release.healthUrls, []);
});
