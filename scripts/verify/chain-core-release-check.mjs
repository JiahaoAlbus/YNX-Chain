import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const releasePath = "release/chain-core/product-release.json";
const metadataPath = "release/chain-core/public-product-metadata.json";
const contractPath = "release/integration/chain-core-contract.json";
const artifactRegistryPath = "release/chain-core/artifact-registry.json";
for (const path of [releasePath, metadataPath, contractPath, artifactRegistryPath, "docs/integration/WEBSITE_HANDOFF.md"]) {
  expect(existsSync(path), `missing required Chain Core release artifact: ${path}`);
}

const release = readJSON(releasePath);
const metadata = readJSON(metadataPath);
const contract = readJSON(contractPath);
const artifactRegistry = readJSON(artifactRegistryPath);

expect(release.schema === "ynx-product-release/v1", "unexpected product release schema");
expect(metadata.schema === "ynx-public-product-metadata/v1", "unexpected public metadata schema");
expect(contract.schema === "ynx-integration-contract/v1", "unexpected integration contract schema");
expect(release.product?.id === "chain-core" && metadata.product?.id === "chain-core", "product ID mismatch");

const sourceCommit = release.source?.implementationCommit;
expect(/^[0-9a-f]{40}$/.test(sourceCommit ?? ""), "implementationCommit must be an exact 40-character Git SHA");
expect(metadata.sourceCommit === sourceCommit, "public metadata source SHA does not match product release");
expect(contract.sourceCommit === sourceCommit, "integration contract source SHA does not match product release");
execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], { stdio: "ignore" });

for (const record of [release.network, metadata.network, contract.networkIdentity]) {
  expect(record?.cosmosChainId === "ynx_6423-1", "Cosmos chain ID mismatch");
  expect(record?.evmChainIdDecimal === 6423, "EVM chain ID mismatch");
  expect(record?.evmChainIdHex === "0x1917", "hex EVM chain ID mismatch");
  expect(record?.nativeAsset === "YNXT", "native asset mismatch");
}

const releaseStatus = release.releaseStatus ?? {};
expect(releaseStatus.implementedLocal === true && releaseStatus.testedLocal === true, "local release evidence is incomplete");
for (const state of ["installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "productionSigned", "storeReleased"]) {
  expect(releaseStatus[state] === false, `unsupported release state must remain false: ${state}`);
}
expect(releaseStatus.downloadHosted === true, "hosted source prerelease evidence must remain true");
expect(metadata.release?.streamBftMode === "shadow", "StreamBFT public metadata must remain shadow");
for (const state of ["integratedCentral", "deployedStaging", "deployedPublic", "productionSigned", "independentPublicProof"]) {
  expect(metadata.release?.[state] === false, `unsupported public state must remain false: ${state}`);
}
expect(metadata.release?.downloadHosted === true, "public metadata must disclose the hosted source prerelease");

expect(artifactRegistry.schemaVersion === 2 && Array.isArray(artifactRegistry.artifacts), "unexpected artifact registry schema");
const sourceArtifact = artifactRegistry.artifacts.find((artifact) => artifact.releaseTag === "chain-core-v0.2.0-source-candidate");
expect(sourceArtifact?.kind === "source-archive", "hosted Chain Core source artifact is missing");
expect(/^[0-9a-f]{40}$/.test(sourceArtifact.sourceCommit ?? ""), "source archive commit must be an exact Git SHA");
execFileSync("git", ["merge-base", "--is-ancestor", sourceCommit, sourceArtifact.sourceCommit], { stdio: "ignore" });
expect(sourceArtifact.sha256 === "6828d6c0b008964394716de87646e90ea64b59faaae85be16e030b24c63995b6", "source archive digest drift");
expect(sourceArtifact.bytes === 6474374, "source archive byte count drift");
expect(sourceArtifact.hostedStatus === "github-source-prerelease", "source artifact hosting class drift");
expect(sourceArtifact.downloadUrl === "https://github.com/JiahaoAlbus/YNX-Chain/releases/download/chain-core-v0.2.0-source-candidate/ynx-chain-core-source-7c724e5f330a.tar.gz", "source artifact URL drift");
expect(sourceArtifact.releaseUrl === "https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/chain-core-v0.2.0-source-candidate", "source release URL drift");
expect(sourceArtifact.signingClass === "unsigned-source" && sourceArtifact.productionSigned === false, "source artifact must not claim production signing");
expect(release.sourceRelease?.tag === sourceArtifact.releaseTag && release.sourceRelease?.targetCommit === sourceArtifact.sourceCommit, "release record and artifact registry differ");
expect(release.sourceRelease?.url === sourceArtifact.releaseUrl && release.sourceRelease?.productionSigned === false, "release record hosting or signing boundary drift");
const publicArtifact = (metadata.artifacts ?? []).find((artifact) => artifact.url === sourceArtifact.downloadUrl);
expect(publicArtifact?.sha256 === sourceArtifact.sha256 && publicArtifact?.bytes === sourceArtifact.bytes, "public artifact metadata differs from the registry");
expect(publicArtifact?.signingClass === "unsigned-source" && publicArtifact?.productionSigned === false, "public artifact signing boundary drift");

const requiredRoutes = metadata.website?.requiredRoutes ?? {};
for (const route of ["product", "userManual", "developerDocs", "api", "faq", "security", "status", "support"]) {
  expect(typeof requiredRoutes[route] === "string" && requiredRoutes[route].startsWith("/chain"), `missing Website route: ${route}`);
}
expect(metadata.website?.targetOrigin === "https://ynxweb4.com", "Website target origin must be ynxweb4.com");
expect(metadata.website?.publicationStatus === "external-blocked", "unpublished Website handoff must remain externally blocked");

for (const path of metadata.evidence ?? []) {
  expect(existsSync(path), `public metadata evidence path does not exist: ${path}`);
}
for (const path of release.evidence ?? []) {
  expect(existsSync(path), `product release evidence path does not exist: ${path}`);
}

console.log(`chain-core release check passed: source=${sourceCommit}, routes=${Object.keys(requiredRoutes).length}, StreamBFT=shadow`);
