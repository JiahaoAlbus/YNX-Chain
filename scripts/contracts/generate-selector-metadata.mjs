import fs from "node:fs";
import path from "node:path";
import { Interface } from "ethers";

const repoRoot = process.cwd();
const artifactsRoot = path.join(repoRoot, "artifacts", "contracts");
const outputPath = path.join(repoRoot, "artifacts", "ynx-selector-metadata.json");

function walkJsonFiles(dir) {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "artifacts.d.ts") {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const artifacts = {};
for (const artifactPath of walkJsonFiles(artifactsRoot)) {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi) || typeof artifact.deployedBytecode !== "string") {
    continue;
  }
  const iface = new Interface(artifact.abi);
  const bytecode = artifact.deployedBytecode.toLowerCase().replace(/^0x/, "");
  const functions = iface.fragments
    .filter((fragment) => fragment.type === "function")
    .map((fragment) => {
      const selector = fragment.selector.toLowerCase();
      return {
        name: fragment.name,
        signature: fragment.format("sighash"),
        selector,
        bytecodeSelectorMatched: bytecode.includes(selector.replace(/^0x/, "")),
      };
    })
    .sort((a, b) => a.signature.localeCompare(b.signature));
  const events = iface.fragments
    .filter((fragment) => fragment.type === "event")
    .map((fragment) => ({
      name: fragment.name,
      signature: fragment.format("sighash"),
      topic: fragment.topicHash.toLowerCase(),
    }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
  artifacts[path.relative(repoRoot, artifactPath).split(path.sep).join("/")] = {
    contractName: artifact.contractName,
    sourceName: artifact.sourceName,
    runtimeSelectorMode: "hardhat-ethers-keccak-selector-event-topic-and-deployed-bytecode-presence",
    functions,
    events,
  };
}

const metadata = {
  generatedBy: "scripts/contracts/generate-selector-metadata.mjs",
  generatedFrom: "artifacts/contracts",
  selectorLibrary: "ethers.Interface",
  artifacts,
};

fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, outputPath)} with ${Object.keys(artifacts).length} artifacts`);
