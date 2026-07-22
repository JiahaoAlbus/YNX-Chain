#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [binary, output, sourceCommit, release, buildTime] = process.argv.slice(2);
if (!binary || !output || !sourceCommit || !release || !buildTime) {
  console.error("usage: bridge-sbom.mjs <binary> <output> <source-commit> <release> <build-time>");
  process.exit(2);
}
const body = fs.readFileSync(binary);
const sha256 = crypto.createHash("sha256").update(body).digest("hex");
const moduleInfo = execFileSync("go", ["version", "-m", binary], { encoding: "utf8" });
const goVersion = execFileSync("go", ["version"], { encoding: "utf8" }).trim().split(" ")[2];
const thirdPartyModules = moduleInfo.split("\n").filter((line) => line.trimStart().startsWith("dep\t"));
if (thirdPartyModules.length !== 0) throw new Error(`unexpected linked module dependencies: ${thirdPartyModules.join(", ")}`);
const namespace = `https://ynxweb4.com/spdx/bridge/${sourceCommit}/${sha256}`;
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: release,
  documentNamespace: namespace,
  creationInfo: { created: buildTime, creators: ["Tool: YNX bridge-sbom.mjs/1"] },
  packages: [
    { name: "YNX Bridge", SPDXID: "SPDXRef-Package-YNX-Bridge", versionInfo: sourceCommit, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION", checksums: [{ algorithm: "SHA256", checksumValue: sha256 }], externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:golang/github.com/JiahaoAlbus/YNX-Chain@${sourceCommit}` }] },
    { name: "Go standard library", SPDXID: "SPDXRef-Package-Go-Stdlib", versionInfo: goVersion, downloadLocation: "https://go.dev/dl/", filesAnalyzed: false, licenseConcluded: "BSD-3-Clause", licenseDeclared: "BSD-3-Clause", externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:golang/stdlib@${goVersion.replace(/^go/, "")}` }] }
  ],
  relationships: [
    { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Package-YNX-Bridge" },
    { spdxElementId: "SPDXRef-Package-YNX-Bridge", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-Package-Go-Stdlib" }
  ],
  artifact: { path: "ynx-bridged", bytes: body.length, sha256, platform: "linux/amd64", signingClass: "unsigned-local-testnet", installedLocal: false, deployedPublic: false }
};
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
