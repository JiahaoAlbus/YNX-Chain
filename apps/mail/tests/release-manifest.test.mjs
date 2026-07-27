import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const release = JSON.parse(
  readFileSync(new URL("../product-release.json", import.meta.url), "utf8"),
);
const publicMetadata = JSON.parse(
  readFileSync(new URL("../public-product-metadata.json", import.meta.url), "utf8"),
);
const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const androidBuild = readFileSync(
  new URL("../native/android/app/build.gradle", import.meta.url),
  "utf8",
);
const iosProject = readFileSync(
  new URL("../native/ios/YNXMail.xcodeproj/project.pbxproj", import.meta.url),
  "utf8",
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

test("Mail release identity stays aligned across every build surface", () => {
  const expectedVersion = `${packageManifest.version}-testnet-preview-source`;
  assert.equal(release.version, expectedVersion);
  assert.match(
    packageManifest.scripts.build,
    /main\.buildRelease=ynx-mail-\$\{npm_package_version\}-testnet-preview-source/,
  );
  assert.match(androidBuild, /versionCode 2/);
  assert.match(androidBuild, /versionName '0\.3\.0-test'/);
  assert.equal((iosProject.match(/CURRENT_PROJECT_VERSION = 2;/g) ?? []).length, 2);
  assert.equal((iosProject.match(/MARKETING_VERSION = 0\.3\.0;/g) ?? []).length, 2);
});

test("Mail public metadata is complete without overstating release status", () => {
  assert.equal(publicMetadata.productId, release.productId);
  assert.equal(publicMetadata.runtimeSourceCommit, release.commit);
  assert.equal(publicMetadata.canonicalRoute, "/mail");
  assert.equal(publicMetadata.canonicalUrl, null);
  assert.equal(publicMetadata.publicStatus.implementedLocal, true);
  assert.equal(publicMetadata.publicStatus.testedLocal, true);
  for (const key of ["websitePublished", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"])
    assert.equal(publicMetadata.publicStatus[key], false, `${key} must remain false without direct evidence`);
  assert.deepEqual(publicMetadata.assets.screenshots, []);
  assert.deepEqual(publicMetadata.assets.artifactManifest, []);
  for (const key of ["supportUrl", "privacyUrl", "securityUrl", "statusUrl"])
    assert.equal(publicMetadata.links[key], null, `${key} must remain null without a public URL`);
  assert.ok(publicMetadata.faq.length >= 4);
  const serialized = JSON.stringify(publicMetadata);
  assert.doesNotMatch(serialized, /\/Users\//);
  assert.doesNotMatch(serialized, /codex\//);
  assert.doesNotMatch(serialized, /example\.com/i);
});
