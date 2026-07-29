#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";

const [releaseDir, commit, release, buildTime] = process.argv.slice(2);
if (!releaseDir || !/^[0-9a-f]{12}$/.test(commit ?? "") || release !== `ynx-data-fabric-${commit}` || !buildTime) {
  throw new Error("usage: write-testnet-provenance.mjs <release-dir> <commit> <release> <build-time>");
}

const binaryNames = ["ynx-data-fabricctl", "ynx-data-fabricd", "ynx-data-fabric-worker", "ynx-pay-data-fabric-bridge"];
const sha256 = (body) => crypto.createHash("sha256").update(body).digest("hex");
const modules = new Map();
const binaries = [];

for (const name of binaryNames) {
  const binaryPath = path.join(releaseDir, "bin", name);
  const body = fs.readFileSync(binaryPath);
  const metadata = execFileSync("go", ["version", "-m", binaryPath], {encoding: "utf8"});
  const normalizedMetadata = metadata.replace(/^[^\n]*/, `bin/${name}`);
  for (const line of metadata.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "dep" || fields.length < 3) continue;
    const module = {name: fields[1], version: fields[2]};
    if (fields[3]?.startsWith("h1:")) module.sum = fields[3];
    modules.set(`${module.name}@${module.version}`, module);
  }
  binaries.push({
    path: `bin/${name}`,
    bytes: body.length,
    sha256: sha256(body),
    goVersionMetadataSha256: sha256(Buffer.from(normalizedMetadata)),
  });
}

const packageID = (name, version) => `SPDXRef-Package-${sha256(Buffer.from(`${name}@${version}`)).slice(0, 16)}`;
const rootID = "SPDXRef-Package-YNXDataFabric";
const dependencies = [...modules.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
const trackedTreeClean = (
  spawnSync("git", ["diff", "--quiet", "HEAD", "--"], {cwd: process.cwd()}).status === 0
  && spawnSync("git", ["diff", "--cached", "--quiet"], {cwd: process.cwd()}).status === 0
);
const packages = [
  {
    name: "github.com/JiahaoAlbus/YNX-Chain",
    SPDXID: rootID,
    versionInfo: commit,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    copyrightText: "NOASSERTION",
  },
  ...dependencies.map((module) => ({
    name: module.name,
    SPDXID: packageID(module.name, module.version),
    versionInfo: module.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    copyrightText: "NOASSERTION",
    externalRefs: [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:golang/${module.name}@${module.version}`,
    }],
  })),
];
const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${release}-go-runtime`,
  documentNamespace: `https://ynxchain.com/spdx/${release}`,
  creationInfo: {created: buildTime, creators: ["Tool: go version -m", "Organization: YNX"]},
  documentDescribes: [rootID],
  packages,
  relationships: dependencies.map((module) => ({
    spdxElementId: rootID,
    relationshipType: "DEPENDS_ON",
    relatedSpdxElement: packageID(module.name, module.version),
  })),
};

const provenance = {
  schema: "ynx-data-fabric-build-provenance/v1",
  product: "ynx-data-fabric",
  commit,
  release,
  buildTime,
  builder: {
    command: "scripts/data-fabric/build-testnet-release.sh",
    goVersion: execFileSync("go", ["version"], {encoding: "utf8"}).trim(),
    target: "linux/amd64",
    cgoEnabled: false,
    trimpath: true,
    buildVCS: true,
  },
  source: {
    repository: "https://github.com/JiahaoAlbus/YNX-Chain",
    trackedTreeClean,
  },
  binaries,
  signing: {class: "unsigned-testnet-build", productionSigned: false},
  hosting: {immutableURL: null, hosted: false},
};

fs.mkdirSync(path.join(releaseDir, "sbom"), {recursive: true, mode: 0o755});
fs.writeFileSync(path.join(releaseDir, "sbom", "go-runtime.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, {mode: 0o644});
fs.writeFileSync(path.join(releaseDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, {mode: 0o644});
