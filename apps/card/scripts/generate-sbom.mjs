import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "../..");
const lockPath = resolve(appDirectory, "package-lock.json");
const releasePath = resolve(appDirectory, "product-release.json");
const outputDirectory = resolve(repositoryRoot, "release/card");
const sbomPath = resolve(outputDirectory, "sbom-npm.cdx.json");
const provenancePath = resolve(outputDirectory, "sbom-npm.provenance.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(hexDigest) {
  const bytes = Buffer.from(hexDigest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function packageNameFromPath(packagePath) {
  return packagePath.replace(/^node_modules\//, "").split("/node_modules/").at(-1);
}

function npmPurl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== "string") {
    return null;
  }
  const separator = integrity.indexOf("-");
  if (separator <= 0) {
    return null;
  }
  const algorithm = integrity.slice(0, separator).toUpperCase().replace("SHA", "SHA-");
  const encoded = integrity.slice(separator + 1);
  try {
    return { alg: algorithm, content: Buffer.from(encoded, "base64").toString("hex") };
  } catch {
    return null;
  }
}

const lockBytes = readFileSync(lockPath);
const lock = JSON.parse(lockBytes.toString("utf8"));
const release = JSON.parse(readFileSync(releasePath, "utf8"));

if (lock.lockfileVersion !== 3 || typeof lock.packages !== "object" || lock.packages === null) {
  throw new Error("YNX Card SBOM generation requires npm package-lock v3");
}
if (typeof release.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(release.sourceCommit)) {
  throw new Error("YNX Card product-release sourceCommit must be a full Git SHA");
}

const components = Object.entries(lock.packages)
  .filter(([packagePath, pkg]) => packagePath !== "" && pkg && typeof pkg.version === "string")
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([packagePath, pkg]) => {
    const name = pkg.name || packageNameFromPath(packagePath);
    const bomRef = `npm:${sha256(`${packagePath}\u0000${name}\u0000${pkg.version}`).slice(0, 32)}`;
    const component = {
      "bom-ref": bomRef,
      type: "library",
      name,
      version: pkg.version,
      scope: pkg.dev ? "excluded" : pkg.optional ? "optional" : "required",
      purl: npmPurl(name, pkg.version),
      properties: [
        { name: "cdx:npm:package:path", value: packagePath },
        { name: "ynx:developmentDependency", value: String(Boolean(pkg.dev)) },
        { name: "ynx:optionalDependency", value: String(Boolean(pkg.optional)) }
      ]
    };
    if (typeof pkg.license === "string" && pkg.license.trim() !== "") {
      component.licenses = [{ expression: pkg.license.trim() }];
    }
    if (typeof pkg.resolved === "string" && /^https:\/\//.test(pkg.resolved)) {
      component.externalReferences = [{ type: "distribution", url: pkg.resolved }];
    }
    const hash = integrityHash(pkg.integrity);
    if (hash) {
      component.hashes = [hash];
    }
    return component;
  });

const lockDigest = sha256(lockBytes);
const rootName = lock.name || "@ynx-chain/card";
const rootVersion = lock.version || "0.0.0";
const sbom = {
  $schema: "https://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${deterministicUuid(lockDigest)}`,
  version: 1,
  metadata: {
    lifecycles: [{ phase: "build" }],
    tools: {
      components: [
        {
          type: "application",
          name: "YNX Card deterministic npm SBOM generator",
          version: "1.0.0"
        }
      ]
    },
    component: {
      "bom-ref": "ynx-card-mobile",
      type: "application",
      group: "ynx-chain",
      name: rootName,
      version: rootVersion,
      purl: npmPurl(rootName, rootVersion),
      properties: [
        { name: "ynx:productId", value: "ynx-card" },
        { name: "ynx:sourceCommit", value: release.sourceCommit },
        { name: "ynx:packageLockSha256", value: lockDigest }
      ]
    },
    properties: [
      { name: "ynx:sourceCommit", value: release.sourceCommit },
      { name: "ynx:inventoryScope", value: "apps/card npm package-lock v3" },
      { name: "ynx:deterministic", value: "true" }
    ]
  },
  components
};

mkdirSync(outputDirectory, { recursive: true });
const sbomBytes = Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`, "utf8");
writeFileSync(sbomPath, sbomBytes, { mode: 0o644 });

const scriptBytes = readFileSync(fileURLToPath(import.meta.url));
const provenance = {
  schemaVersion: "ynx.card.sbom-provenance.v1",
  productId: "ynx-card",
  sourceCommit: release.sourceCommit,
  generator: "apps/card/scripts/generate-sbom.mjs",
  inputs: {
    packageLock: {
      path: "apps/card/package-lock.json",
      sha256: lockDigest
    },
    generator: {
      path: "apps/card/scripts/generate-sbom.mjs",
      sha256: sha256(scriptBytes)
    }
  },
  output: {
    path: "release/card/sbom-npm.cdx.json",
    sha256: sha256(sbomBytes),
    bytes: sbomBytes.length,
    componentCount: components.length,
    format: "CycloneDX 1.5 JSON"
  },
  reproducibility: {
    deterministicOrdering: true,
    wallClockExcluded: true,
    randomValuesExcluded: true,
    command: "npm run generate-sbom"
  }
};
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });

console.log(`YNX Card SBOM generated: ${components.length} components, sha256=${provenance.output.sha256}`);
