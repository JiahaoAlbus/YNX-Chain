import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const outputRoot = resolve(repoRoot, "release/mail");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("exact source commit is required");

const moduleLines = execFileSync(
  "go",
  ["list", "-deps", "-f", "{{if and .Module (not .Standard)}}{{.Module.Path}} {{.Module.Version}}{{end}}", "./internal/mail"],
  { cwd: repoRoot, encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const modules = [...new Set(moduleLines)]
  .map((line) => {
    const [name, version = "(devel)"] = line.split(/\s+/, 2);
    return { type: "library", name, version, purl: `pkg:golang/${name}@${encodeURIComponent(version)}` };
  })
  .sort((a, b) => a.purl.localeCompare(b.purl));

const lockPath = resolve(appRoot, "package-lock.json");
const lockRaw = await readFile(lockPath);
const lock = JSON.parse(lockRaw);
const npmComponents = Object.entries(lock.packages ?? {})
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
const components = [...modules, ...npmComponents];
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: { type: "application", name: "YNX Mail", version: "0.3.0-testnet" },
    properties: [
      { name: "ynx:sourceCommit", value: sourceCommit },
      { name: "ynx:scope", value: "internal/mail Go dependency graph and apps/mail npm lock" },
    ],
  },
  components,
};
const sbomRaw = `${JSON.stringify(sbom, null, 2)}\n`;
const provenance = {
  schemaVersion: 1,
  classification: "local-unsigned-build-input-provenance",
  product: "YNX Mail",
  sourceCommit,
  generatedAt: new Date().toISOString(),
  inputs: {
    "apps/mail/package-lock.json": {
      sha256: createHash("sha256").update(lockRaw).digest("hex"),
      bytes: lockRaw.byteLength,
    },
  },
  outputs: {
    "release/mail/bom.cdx.json": {
      sha256: createHash("sha256").update(sbomRaw).digest("hex"),
      bytes: Buffer.byteLength(sbomRaw),
      components: components.length,
    },
  },
  limitations: [
    "Local unsigned evidence; not an independent builder or production signature.",
    "License identifiers are included only when declared by the npm lock; authoritative license texts remain in dependency distributions.",
  ],
};
const notices = [
  "# YNX Mail third-party notices",
  "",
  "Generated from the current Go dependency graph and exact npm lock. Consult each dependency distribution for authoritative license text.",
  "",
  ...components.map((item) => `- ${item.name} ${item.version}: ${item.licenses?.[0]?.license?.id ?? "license not declared in lock/graph"}`),
  "",
].join("\n");

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, "bom.cdx.json"), sbomRaw);
await writeFile(resolve(outputRoot, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(resolve(outputRoot, "THIRD_PARTY_NOTICES.md"), notices);
console.log(`wrote Mail SBOM with ${components.length} components for ${sourceCommit}`);
