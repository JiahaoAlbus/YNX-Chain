#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const raw = execFileSync("go", ["list", "-deps", "-json", "./apps/music/cmd/ynx-musicd"], {
  cwd: root,
  encoding: "utf8",
});
const objects = [];
let depth = 0, start = -1, quoted = false, escaped = false;
for (let i = 0; i < raw.length; i += 1) {
  const ch = raw[i];
  if (quoted) {
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') quoted = false;
    continue;
  }
  if (ch === '"') quoted = true;
  else if (ch === "{") { if (depth === 0) start = i; depth += 1; }
  else if (ch === "}") { depth -= 1; if (depth === 0 && start >= 0) objects.push(JSON.parse(raw.slice(start, i + 1))); }
}

const modules = new Map();
for (const pkg of objects) {
  const mod = pkg.Module;
  if (!mod || mod.Main || !mod.Path || !mod.Version) continue;
  modules.set(`${mod.Path}@${mod.Version}`, mod);
}
const namespaceSeed = createHash("sha256").update([...modules.keys()].sort().join("\n")).digest("hex").slice(0, 24);
const packages = [{
  SPDXID: "SPDXRef-YNX-Music",
  name: "YNX Music daemon",
  versionInfo: "0.3.0-testnet",
  downloadLocation: "NOASSERTION",
  filesAnalyzed: false,
  licenseConcluded: "NOASSERTION",
  licenseDeclared: "NOASSERTION",
  copyrightText: "NOASSERTION",
  primaryPackagePurpose: "APPLICATION",
}, ...[...modules.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, mod], index) => ({
  SPDXID: `SPDXRef-GoModule-${index + 1}`,
  name: mod.Path,
  versionInfo: mod.Version,
  downloadLocation: `https://proxy.golang.org/${mod.Path}/@v/${mod.Version}.zip`,
  filesAnalyzed: false,
  licenseConcluded: "NOASSERTION",
  licenseDeclared: "NOASSERTION",
  copyrightText: "NOASSERTION",
  externalRefs: [{
    referenceCategory: "PACKAGE-MANAGER",
    referenceType: "purl",
    referenceLocator: `pkg:golang/${mod.Path}@${mod.Version}`,
  }],
}))];
const relationships = packages.slice(1).map((pkg) => ({
  spdxElementId: "SPDXRef-YNX-Music",
  relationshipType: "DEPENDS_ON",
  relatedSpdxElement: pkg.SPDXID,
}));
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "YNX-Music-0.3.0-testnet-SBOM",
  documentNamespace: `https://ynxweb4.com/spdx/music/${namespaceSeed}`,
  creationInfo: {
    created: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    creators: ["Tool: apps/music/scripts/generate-sbom.mjs"],
    licenseListVersion: "3.25",
  },
  documentDescribes: ["SPDXRef-YNX-Music"],
  packages,
  relationships,
};
writeFileSync(resolve(root, "apps/music/SBOM.spdx.json"), `${JSON.stringify(document, null, 2)}\n`);
console.log(`SBOM generated with ${packages.length - 1} Go runtime modules`);
