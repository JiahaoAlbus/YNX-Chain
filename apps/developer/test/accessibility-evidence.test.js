import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("browser accessibility audit uses a real local Chrome CDP session without production dependencies", async () => {
  const script = await read("scripts/browser-accessibility-audit.mjs");
  const packageJSON = JSON.parse(await read("package.json"));
  assert.equal(packageJSON.scripts["accessibility:audit"], "node scripts/browser-accessibility-audit.mjs");
  assert.match(script, /Chrome DevTools Protocol/);
  assert.match(script, /Page\.captureScreenshot/);
  assert.match(script, /Accessibility\.getFullAXTree/);
  assert.match(script, /Input\.dispatchKeyEvent/);
  assert.match(script, /Emulation\.setEmulatedMedia/);
  assert.match(script, /Emulation\.setPageScaleFactor/);
  assert.match(script, /sourceDirtyAtStart/);
  assert.doesNotMatch(JSON.stringify(packageJSON), /playwright|puppeteer/i);
});

test("browser audit covers keyboard, screen-reader, RTL, reduced-motion, dark, zoom and 390px gates", async () => {
  const script = await read("scripts/browser-accessibility-audit.mjs");
  for (const gate of [
    "keyboard-first-focus-skip-link",
    "skip-link-focuses-editor",
    "panel-tabs-roving-keyboard",
    "screen-reader-accessibility-tree",
    "visible-focus-indicator",
    "desktop-dark-theme",
    "reduced-motion-disables-animation",
    "mobile-390-no-page-overflow",
    "mobile-closed-drawers-inert",
    "arabic-rtl-with-code-ltr",
    "dynamic-large-text-390",
    "page-scale-200-percent",
  ]) assert.match(script, new RegExp(gate));
});

test("committed accessibility evidence and public metadata preserve exact hashes and release boundaries", async () => {
  const evidence = JSON.parse(await read("evidence/ui/current-accessibility/accessibility-audit.json"));
  const metadata = JSON.parse(await read("public-product-metadata.json"));
  const release = JSON.parse(await read("product-release.json"));
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.sourceDirtyAtStart, false);
  assert.equal(evidence.checks.filter((item) => item.status === "passed").length, 15);
  assert.equal(evidence.screenshots.length, 6);
  for (const screenshot of evidence.screenshots) {
    const bytes = await readFile(`${repositoryRoot}/${screenshot.path}`);
    assert.equal(bytes.length, screenshot.bytes, screenshot.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), screenshot.sha256, screenshot.path);
  }
  assert.equal(metadata.officialDomain, "https://ynxweb4.com");
  assert.equal(metadata.canonicalUrl, "https://ynxweb4.com/developer");
  assert.equal(metadata.deployedPublic, true);
  assert.equal(metadata.publicRouteVerified, true);
  assert.equal(metadata.publicEvidence.immutableArtifactUrls.length, 0);
  assert.equal(metadata.publicEvidence.downloadHosted, false);
  assert.equal(release.browserAccessibilityEvidence.status, "passed");
  assert.equal(release.browserAccessibilityEvidence.independentCertification, false);
  assert.equal(release.deployedPublic, true);
  assert.equal(release.productionSigned, false);
});

test("release manifests, provenance and website metadata agree on current unsigned artifacts", async () => {
  const artifactManifest = JSON.parse(await read("docs/ARTIFACT_MANIFEST.json"));
  const provenance = JSON.parse(await read("release/PROVENANCE.json"));
  const sums = new Map((await read("release/SHA256SUMS.txt")).trim().split("\n").map((line) => {
    const [sha256, name] = line.trim().split(/\s+/, 2);
    return [name, sha256];
  }));
  const metadata = JSON.parse(await read("public-product-metadata.json"));
  const release = JSON.parse(await read("product-release.json"));
  const contract = JSON.parse(await read("../../release/integration/developer-contract.json"));
  const manifestByPlatform = new Map(artifactManifest.artifacts.map((artifact) => [artifact.surface, artifact]));
  const provenanceByPlatform = new Map(provenance.artifacts.map((artifact) => [artifact.platform, artifact]));
  const macManifest = manifestByPlatform.get("macOS arm64");
  const windowsManifest = manifestByPlatform.get("Windows x64");
  const macProvenance = provenanceByPlatform.get("macos-arm64");
  const windowsProvenance = provenanceByPlatform.get("windows-x64");
  assert.equal(macManifest.sha256, sums.get(macManifest.name));
  assert.equal(windowsManifest.sha256, sums.get(windowsManifest.name));
  assert.equal(macManifest.sha256, macProvenance.sha256);
  assert.equal(windowsManifest.sha256, windowsProvenance.sha256);
  assert.equal(macManifest.sha256, release.sha256.macosArm64UnsignedZip);
  assert.equal(windowsManifest.sha256, release.sha256.windowsX64UnsignedZip);
  assert.equal(macManifest.sha256, metadata.localEvidence.macosArm64.sha256);
  assert.equal(windowsManifest.sha256, metadata.localEvidence.windowsX64.sha256);
  assert.equal(macManifest.sourceCommit, macProvenance.sourceCommit);
  assert.equal(windowsManifest.sourceCommit, windowsProvenance.sourceCommit);
  assert.equal(windowsManifest.ciRunId, windowsProvenance.ci.runId);
  assert.equal(windowsManifest.ciArtifactId, windowsProvenance.ci.artifactId);
  assert.equal(contract.source.releaseCandidateCommit, provenance.sourceCommit);
  assert.equal(contract.apiStudio.macosArtifactSha256, macManifest.sha256);
  assert.equal(contract.apiStudio.windowsArtifactSha256, windowsManifest.sha256);
  assert.equal(contract.apiStudio.windowsWorkflowRunId, windowsManifest.ciRunId);
  assert.equal(contract.apiStudio.windowsWorkflowArtifactId, windowsManifest.ciArtifactId);
  assert.equal(contract.releaseStatus.releasePublished, true);
  assert.equal(contract.releaseStatus.downloadHosted, true, "Central historical contract is retained as a historical record");
  assert.equal(contract.releaseStatus.productionSigned, false);
  assert.equal(release.releasePublished, true);
  assert.equal(release.downloadHosted, false);
  assert.equal(metadata.publicEvidence.downloadHosted, false);
  assert.equal(metadata.release.prerelease, true);
  assert.equal(metadata.release.targetCommit, "fc7e9b5146d514aaae02bb01e4e20c62ff32867a");
  assert.equal(metadata.localEvidence.macosArm64.hosted, true);
  assert.equal(metadata.localEvidence.windowsX64.hosted, true);
  assert.equal(metadata.routeStatus, "source-bound-public-runtime-readback; browser-visible-proof-pending");
  assert.equal(metadata.fullPlatformPublicEvidence.nineRuntimes, true);
  assert.equal(metadata.fullPlatformPublicEvidence.sevenLanguageServers, true);
  assert.equal(metadata.fullPlatformPublicEvidence.independentBrowserVisible, false);
  assert.equal(metadata.fullPlatformPublicEvidence.concurrentTenantsVerified, 12);
  assert.equal(metadata.fullPlatformPublicEvidence.restartPersistence, true);
  assert.equal(metadata.fullPlatformPublicEvidence.walletPublicDeploymentReady, false);
  assert.equal(metadata.fullPlatformPublicEvidence.bftIdeActionPublicReady, false);
  assert.equal(provenance.truthBoundaries.productionSigned, false);
  assert.equal(provenance.truthBoundaries.deployedPublic, true);
});
