import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const releasePath = "release/product-release.json";
const metadataPath = "release/public-product-metadata.json";
const contractPath = "release/integration/chain-core-contract.json";
for (const path of [releasePath, metadataPath, contractPath, "docs/integration/WEBSITE_HANDOFF.md"]) {
  expect(existsSync(path), `missing required Chain Core release artifact: ${path}`);
}

const release = readJSON(releasePath);
const metadata = readJSON(metadataPath);
const contract = readJSON(contractPath);

expect(release.schema === "ynx-product-release/v1", "unexpected product release schema");
expect(metadata.schema === "ynx-public-product-metadata/v1", "unexpected public metadata schema");
expect(contract.schema === "ynx-integration-contract/v1", "unexpected integration contract schema");
expect(release.product?.id === "chain-core" && metadata.product?.id === "chain-core", "product ID mismatch");

const sourceCommit = release.source?.implementationCommit;
expect(/^[0-9a-f]{12}$/.test(sourceCommit ?? ""), "implementationCommit must be a 12-character Git SHA");
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
for (const state of ["installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"]) {
  expect(releaseStatus[state] === false, `unsupported release state must remain false: ${state}`);
}
expect(metadata.release?.streamBftMode === "shadow", "StreamBFT public metadata must remain shadow");
for (const state of ["integratedCentral", "deployedStaging", "deployedPublic", "productionSigned", "independentPublicProof"]) {
  expect(metadata.release?.[state] === false, `unsupported public state must remain false: ${state}`);
}

const requiredRoutes = metadata.website?.requiredRoutes ?? {};
for (const route of ["product", "userManual", "developerDocs", "api", "faq", "security", "status", "support"]) {
  expect(typeof requiredRoutes[route] === "string" && requiredRoutes[route].startsWith("/chain"), `missing Website route: ${route}`);
}
expect(metadata.website?.targetOrigin === "https://huangjeo.com", "Website target origin must be huangjeo.com");
expect(metadata.website?.publicationStatus === "external-blocked", "unpublished Website handoff must remain externally blocked");

for (const path of metadata.evidence ?? []) {
  expect(existsSync(path), `public metadata evidence path does not exist: ${path}`);
}
for (const path of release.evidence ?? []) {
  expect(existsSync(path), `product release evidence path does not exist: ${path}`);
}

console.log(`chain-core release check passed: source=${sourceCommit}, routes=${Object.keys(requiredRoutes).length}, StreamBFT=shadow`);
