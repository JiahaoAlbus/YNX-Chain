import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [output, runtimeNode, npmPackagePath, sourceCommit] = process.argv.slice(2);
if (!output || !runtimeNode || !npmPackagePath || !/^[0-9a-f]{40}$/.test(sourceCommit || "")) throw new Error("SBOM output, runtime, npm package and source commit are required.");
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const npmPackage = JSON.parse(readFileSync(npmPackagePath, "utf8"));
const nodeVersion = execFileSync(runtimeNode, ["--version"], { encoding: "utf8" }).trim().replace(/^v/, "");
const components = [];
for (const [location, record] of Object.entries(lock.packages || {})) {
  if (!location.startsWith("node_modules/") || !record?.version) continue;
  const name = location.slice("node_modules/".length);
  if (!name || name.includes("/node_modules/")) continue;
  const component = {
    type: "library",
    "bom-ref": `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    name,
    version: record.version,
    purl: `pkg:npm/${name.replace(/^@/, "%40")}@${record.version}`,
    scope: record.dev ? "optional" : "required",
    properties: [{ name: "ynx:lockfilePath", value: location }],
  };
  if (record.license) component.licenses = [{ license: { name: record.license } }];
  if (record.integrity) component.hashes = [{ alg: "SHA-512", content: Buffer.from(record.integrity.replace(/^sha512-/, ""), "base64").toString("hex") }];
  components.push(component);
}
components.push(
  { type: "framework", "bom-ref": `pkg:generic/node.js@${nodeVersion}`, name: "Node.js", version: nodeVersion, scope: "required" },
  { type: "application", "bom-ref": `pkg:npm/npm@${npmPackage.version}`, name: "npm", version: npmPackage.version, purl: `pkg:npm/npm@${npmPackage.version}`, scope: "required" },
);
components.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
const serialSeed = createHash("sha256").update(`${sourceCommit}\n${nodeVersion}\n${npmPackage.version}\n${components.map(value => value["bom-ref"]).join("\n")}`).digest("hex");
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serialSeed.slice(0,8)}-${serialSeed.slice(8,12)}-4${serialSeed.slice(13,16)}-a${serialSeed.slice(17,20)}-${serialSeed.slice(20,32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", "bom-ref": "pkg:npm/%40ynx/code-desktop@0.2.0", name: "YNX Code Desktop", version: "0.2.0" },
    properties: [
      { name: "ynx:sourceCommit", value: sourceCommit },
      { name: "ynx:dependencySource", value: "apps/developer/package-lock.json" },
      { name: "ynx:artifactClass", value: "unsigned-testnet-preview" },
    ],
  },
  components,
};
writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o644 });
console.log(`Generated CycloneDX SBOM with ${components.length} components for Node ${nodeVersion} and npm ${npmPackage.version}.`);
