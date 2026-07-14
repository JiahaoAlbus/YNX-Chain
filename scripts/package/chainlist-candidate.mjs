import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  CHAINLIST_CANDIDATE_SCHEMA,
  buildCandidateStatus,
  buildSDKNetworkModule,
  buildWalletAddEthereumChain,
  digestRecord,
  loadCandidateSources,
} from "../lib/chainlist-candidate.mjs";
import {canonicalJSON} from "../lib/sdk-release.mjs";

export function buildChainlistCandidate({rootDir, outputDir}) {
  const sources = loadCandidateSources(rootDir);
  const output = path.resolve(outputDir);
  const allowedOutputs = [path.join(sources.root, "tmp"), path.resolve(os.tmpdir())];
  if (!allowedOutputs.some((allowed) => output === allowed || output.startsWith(`${allowed}${path.sep}`))) {
    throw new Error("Chainlist output must be under repository tmp/ or the system temporary directory");
  }
  const sdkModule = fs.readFileSync(path.join(sources.root, "sdk/js/ynx-testnet.js"), "utf8");
  if (sdkModule !== buildSDKNetworkModule(sources.metadata.value)) throw new Error("generated SDK network module differs from testnet metadata");

  const candidateFiles = new Map([
    ["candidate-status.json", Buffer.from(canonicalJSON(buildCandidateStatus()))],
    ["collision-evidence.json", sources.collision.body],
    ["eip155-6423.json", sources.metadata.body],
    ["wallet-add-ethereum-chain.json", Buffer.from(canonicalJSON(buildWalletAddEthereumChain(sources.metadata.value)))],
  ]);
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sources.root, encoding: "utf8"}).trim();
  const manifest = {
    files: [...candidateFiles.entries()].map(([file, body]) => digestRecord(file, body)).sort((left, right) => left.file.localeCompare(right.file)),
    gitCommit,
    schema: CHAINLIST_CANDIDATE_SCHEMA,
    status: buildCandidateStatus(),
  };

  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true, mode: 0o755});
  for (const [file, body] of candidateFiles) fs.writeFileSync(path.join(output, file), body, {mode: 0o644});
  fs.writeFileSync(path.join(output, "manifest.json"), canonicalJSON(manifest), {mode: 0o644});
  return {manifest, outputDir: output};
}

function parseArguments(argv) {
  let outputDir = "tmp/packages/chainlist";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output" || !argv[index + 1]) throw new Error("usage: chainlist-candidate.mjs [--output <directory>]");
    outputDir = argv[index + 1];
    index += 1;
  }
  return {outputDir};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {outputDir} = parseArguments(process.argv.slice(2));
  const result = buildChainlistCandidate({rootDir: process.cwd(), outputDir});
  process.stdout.write(`Chainlist candidate generated: ${result.outputDir}\n`);
  process.stdout.write(`${canonicalJSON(result.manifest.status)}`);
}
