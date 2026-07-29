import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const outputRoot = resolve(repoRoot, "release/finance");
const lockPath = resolve(repoRoot, "apps/finance/mobile/package-lock.json");
const lockRaw = await readFile(lockPath);
const lock = JSON.parse(lockRaw);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("exact source commit is required");
}

const components = Object.entries(lock.packages ?? {})
  .filter(([path, value]) => path.startsWith("node_modules/") && value?.version)
  .map(([path, value]) => {
    const name = path.slice("node_modules/".length);
    return {
      type: "library",
      name,
      version: value.version,
      licenses: value.license ? [{ license: { id: value.license } }] : undefined,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(value.version)}`,
    };
  })
  .sort((a, b) => a.purl.localeCompare(b.purl));

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${sourceCommit.slice(0, 8)}-${sourceCommit.slice(8, 12)}-4${sourceCommit.slice(13, 16)}-8${sourceCommit.slice(17, 20)}-${sourceCommit.slice(20, 32)}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "YNX Finance",
      version: "1.2.0-testnet",
    },
    properties: [
      { name: "ynx:sourceCommit", value: sourceCommit },
      { name: "ynx:scope", value: "apps/finance/mobile package-lock dependencies" },
    ],
  },
  components,
};

const sbomRaw = `${JSON.stringify(sbom, null, 2)}\n`;
const lockSha256 = createHash("sha256").update(lockRaw).digest("hex");
const sbomSha256 = createHash("sha256").update(sbomRaw).digest("hex");
const provenance = {
  schemaVersion: 1,
  classification: "local-unsigned-build-input-provenance",
  product: "YNX Finance",
  sourceCommit,
  generatedAt: new Date().toISOString(),
  inputs: {
    "apps/finance/mobile/package-lock.json": {
      sha256: lockSha256,
      bytes: lockRaw.byteLength,
    },
  },
  outputs: {
    "release/finance/bom.cdx.json": {
      sha256: sbomSha256,
      bytes: Buffer.byteLength(sbomRaw),
      components: components.length,
    },
  },
  limitations: [
    "Local unsigned evidence; not an independent builder or production signature.",
    "The SBOM covers the Finance mobile npm lock. Go modules remain covered by go.sum and govulncheck evidence.",
  ],
};

const notices = [
  "# YNX Finance third-party notices",
  "",
  "Generated from the exact mobile package lock. Consult each dependency package for the authoritative license text.",
  "",
  ...components.map((component) => `- ${component.name} ${component.version}: ${component.licenses?.[0]?.license?.id ?? "license not declared in lock"}`),
  "",
].join("\n");

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, "bom.cdx.json"), sbomRaw);
await writeFile(resolve(outputRoot, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(resolve(outputRoot, "THIRD_PARTY_NOTICES.md"), notices);
console.log(`wrote Finance SBOM with ${components.length} components for ${sourceCommit}`);
