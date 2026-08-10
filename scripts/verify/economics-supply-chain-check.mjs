import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sbomPath = "release/economics/sbom.cdx.json";
const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
const release = JSON.parse(readFileSync("release/economics/product-release.json", "utf8"));
const commit = sbom.metadata?.component?.version;
if (!/^[0-9a-f]{40}$/.test(commit || "") || sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.5") {
  throw new Error("invalid economics SBOM identity");
}
const bindingCommit = release.artifacts.find((artifact) => artifact.kind === "cyclonedx_sbom")?.bindingCommit;
if (!/^[0-9a-f]{40}$/.test(bindingCommit || "")) throw new Error("economics SBOM binding commit is missing");
const frozenSource = execFileSync("git", ["show", `${bindingCommit}:release/sbom.cdx.json`], { encoding: "utf8" });
if (frozenSource !== readFileSync(sbomPath, "utf8")) throw new Error("product-scoped SBOM differs from its frozen source commit");
const purls = new Set(sbom.components.map((item) => item.purl));
if (purls.size !== sbom.components.length || sbom.components.length < 100) throw new Error("SBOM component set is incomplete or duplicated");
for (const required of ["docs/economics/product/THREAT_MODEL.md", "docs/economics/product/SECURITY_BOUNDARIES.md", "docs/economics/product/THIRD_PARTY_NOTICES.md", "docs/economics/product/SUPPLY_CHAIN_SECURITY.md", "release/economics/build-script-allowlist.json"]) {
  if (readFileSync(required, "utf8").length < 100) throw new Error(`${required} is missing or empty`);
}
const digest = createHash("sha256").update(readFileSync(sbomPath)).digest("hex");
console.log(`economics supply chain verified: commit=${commit} components=${sbom.components.length} sbomSha256=${digest}`);
