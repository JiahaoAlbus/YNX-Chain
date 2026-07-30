import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sbomPath = "release/sbom.cdx.json";
const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
const commit = sbom.metadata?.component?.version;
if (!/^[0-9a-f]{40}$/.test(commit || "") || sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.5") {
  throw new Error("invalid economics SBOM identity");
}
const generated = execFileSync("node", ["scripts/release/generate-economics-sbom.mjs", commit], { encoding: "utf8" });
if (generated !== readFileSync(sbomPath, "utf8")) throw new Error("SBOM is stale relative to lockfiles/module graph");
const purls = new Set(sbom.components.map((item) => item.purl));
if (purls.size !== sbom.components.length || sbom.components.length < 100) throw new Error("SBOM component set is incomplete or duplicated");
for (const required of ["THREAT_MODEL.md", "SECURITY_BOUNDARIES.md", "THIRD_PARTY_NOTICES.md", "SUPPLY_CHAIN_SECURITY.md", "release/build-script-allowlist.json"]) {
  if (readFileSync(required, "utf8").length < 100) throw new Error(`${required} is missing or empty`);
}
const digest = createHash("sha256").update(readFileSync(sbomPath)).digest("hex");
console.log(`economics supply chain verified: commit=${commit} components=${sbom.components.length} sbomSha256=${digest}`);
