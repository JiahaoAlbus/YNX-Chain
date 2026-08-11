import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(appRoot, "product-release.json"), "utf8"));

if (manifest.productId !== "pay-merchant") throw new Error("unexpected Merchant product id");
if (!/^[0-9a-f]{40}$/.test(manifest.commit)) throw new Error("release commit must be an exact Git commit");
if (!manifest.implementedLocal || !manifest.testedLocal || !manifest.integratedCentral) {
  throw new Error("central source integration evidence is incomplete");
}

const publicFlags = ["deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"];
for (const field of publicFlags) {
  if (manifest[field] !== false) throw new Error(`${field} must remain false until independent public evidence exists`);
}
for (const field of ["publicUrls", "artifactUrls", "installEvidence"]) {
  if (!Array.isArray(manifest[field]) || manifest[field].length !== 0) {
    throw new Error(`${field} must remain empty for the local-only candidate`);
  }
}
if (manifest.backendGateway?.deployedPublic !== true || manifest.backendGateway?.webClientDeployedPublic !== false || manifest.backendGateway?.sourceCommit !== manifest.commit) {
  throw new Error("Merchant backend Gateway truth boundary is invalid");
}
if (manifest.healthUrls?.join("\n") !== "https://rest.ynxweb4.com/app/pay-product/health") {
  throw new Error("Merchant backend health evidence URL is invalid");
}
const gatewayEvidence = JSON.parse(await readFile(resolve(appRoot, "evidence/public-gateway-2026-08-11.json"), "utf8"));
if (gatewayEvidence.sourceCommit !== manifest.commit || gatewayEvidence.releaseBoundary?.backendGatewayDeployedPublic !== true || gatewayEvidence.releaseBoundary?.merchantWebClientDeployedPublic !== false || gatewayEvidence.allowlist?.operatorRouteHttpStatus !== 404 || gatewayEvidence.secretMaterialRecorded !== false) {
  throw new Error("Merchant public Gateway evidence is incomplete or overclaims the Web client");
}

const hashes = manifest.sha256 ?? {};
const bytes = manifest.bytes ?? {};
const files = Object.keys(hashes).sort();
if (files.length === 0 || files.join("\n") !== Object.keys(bytes).sort().join("\n")) {
  throw new Error("release hashes and byte counts must describe the same non-empty file set");
}

for (const relativePath of files) {
  if (relativePath.startsWith("/") || relativePath.includes("..")) throw new Error(`unsafe release path: ${relativePath}`);
  const absolutePath = resolve(appRoot, relativePath);
  const raw = await readFile(absolutePath);
  const info = await stat(absolutePath);
  const actualHash = createHash("sha256").update(raw).digest("hex");
  if (actualHash !== hashes[relativePath]) throw new Error(`sha256 mismatch: ${relativePath}`);
  if (info.size !== bytes[relativePath]) throw new Error(`byte count mismatch: ${relativePath}`);
}

console.log(`verified ${files.length} Merchant release artifacts and the public backend Gateway boundary; Merchant Web release claims remain fail-closed`);
