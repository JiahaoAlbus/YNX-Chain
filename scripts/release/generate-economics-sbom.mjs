import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit || "")) {
  throw new Error("exact 40-character source commit is required");
}

const goModules = execFileSync("go", ["list", "-m", "-json", "all"], { encoding: "utf8" })
  .trim()
  .split(/\n}\n(?={)/)
  .map((value, index, values) => JSON.parse(value + (index < values.length - 1 ? "}" : "")))
  .filter((item) => item.Path !== "github.com/JiahaoAlbus/YNX-Chain")
  .map((item) => ({
    type: "library",
    group: "golang",
    name: item.Path,
    version: item.Version || item.Replace?.Version || "unversioned",
    purl: `pkg:golang/${encodeURIComponent(item.Path)}@${encodeURIComponent(item.Version || item.Replace?.Version || "unversioned")}`,
    properties: [{ name: "ynx:dependencySource", value: item.Replace ? "go-module-replacement" : "go-module-graph" }],
  }));

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const npmPackages = Object.entries(lock.packages)
  .filter(([path, item]) => path.startsWith("node_modules/") && item.version)
  .map(([path, item]) => {
    const name = path.slice(path.lastIndexOf("node_modules/") + 13);
    const component = {
      type: "library",
      group: "npm",
      name,
      version: item.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(item.version)}`,
      scope: item.dev ? "optional" : "required",
      properties: [{ name: "ynx:dependencySource", value: "package-lock-v3" }],
    };
    if (item.license) component.licenses = [{ license: { id: item.license } }];
    return component;
  });

const components = [...goModules, ...npmPackages].sort((a, b) => a.purl.localeCompare(b.purl));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "YNXT Economics local integration candidate",
      version: commit,
      properties: [
        { name: "ynx:sourceCommit", value: commit },
        { name: "ynx:releaseClass", value: "local_testnet_integration_candidate" },
        { name: "ynx:publicArtifact", value: "false" },
      ],
    },
    tools: { components: [{ type: "application", name: "generate-economics-sbom.mjs", version: "1" }] },
  },
  components,
};
process.stdout.write(`${JSON.stringify(sbom, null, 2)}\n`);
