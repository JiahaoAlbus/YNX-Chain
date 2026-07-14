import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  CHAINLIST_CANDIDATE_SCHEMA,
  buildCandidateStatus,
  buildSDKNetworkModule,
  buildWalletAddEthereumChain,
  assertExactKeys,
  loadCandidateSources,
  validateCollisionEvidence,
} from "../lib/chainlist-candidate.mjs";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";

const PACKAGE_FILES = ["candidate-status.json", "collision-evidence.json", "eip155-6423.json", "manifest.json", "wallet-add-ethereum-chain.json"];

export function verifyChainlistCandidate({candidateDir, sourceRoot, submission = false, now = new Date()}) {
  const sources = loadCandidateSources(sourceRoot);
  validateCollisionEvidence(sources.collision.value, sources.metadata.value, {
    now,
    maximumAgeMs: submission ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
  });
  const sdkModule = fs.readFileSync(path.join(sources.root, "sdk/js/ynx-testnet.js"), "utf8");
  if (sdkModule !== buildSDKNetworkModule(sources.metadata.value)) throw new Error("SDK network module differs from canonical metadata");

  const files = fs.readdirSync(candidateDir).sort();
  if (files.length !== PACKAGE_FILES.length || files.some((file, index) => file !== PACKAGE_FILES[index])) {
    throw new Error("Chainlist candidate file set mismatch or mainnet leakage");
  }
  for (const file of files) {
    const stat = fs.lstatSync(path.join(candidateDir, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Chainlist candidate entry is not a regular file: ${file}`);
    if ((stat.mode & 0o777) !== 0o644) throw new Error(`Chainlist candidate file mode is not 0644: ${file}`);
    if (stat.size <= 0 || stat.size > 1024 * 1024) throw new Error(`Chainlist candidate file size is invalid: ${file}`);
  }
  const manifestFile = readCandidateJSON(candidateDir, "manifest.json");
  const manifest = manifestFile.value;
  assertExactKeys(manifest, ["files", "gitCommit", "schema", "status"], "Chainlist manifest");
  if (manifest.schema !== CHAINLIST_CANDIDATE_SCHEMA || !/^[0-9a-f]{40}$/.test(manifest.gitCommit)) throw new Error("Chainlist manifest schema or Git commit is invalid");
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sources.root, encoding: "utf8"}).trim();
  if (manifest.gitCommit !== currentCommit) throw new Error("Chainlist manifest Git commit differs from source checkout");
  if (canonicalJSON(manifest.status) !== canonicalJSON(buildCandidateStatus())) throw new Error("Chainlist candidate status makes an unsupported claim");

  const expectedBodies = new Map([
    ["candidate-status.json", Buffer.from(canonicalJSON(buildCandidateStatus()))],
    ["collision-evidence.json", sources.collision.body],
    ["eip155-6423.json", sources.metadata.body],
    ["wallet-add-ethereum-chain.json", Buffer.from(canonicalJSON(buildWalletAddEthereumChain(sources.metadata.value)))],
  ]);
  if (!Array.isArray(manifest.files) || manifest.files.length !== expectedBodies.size) throw new Error("Chainlist manifest file count mismatch");
  const records = new Map(manifest.files.map((record) => [record.file, record]));
  if (records.size !== manifest.files.length || [...expectedBodies.keys()].some((file) => !records.has(file))) throw new Error("Chainlist manifest files mismatch");
  for (const [file, expectedBody] of expectedBodies) {
    const record = records.get(file);
    assertExactKeys(record, ["bytes", "file", "sha256"], `Chainlist file ${file}`);
    if (record.file !== file || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || !/^[0-9a-f]{64}$/.test(record.sha256)) throw new Error(`Chainlist file record is invalid: ${file}`);
    const actualBody = fs.readFileSync(path.join(candidateDir, file));
    if (!actualBody.equals(expectedBody) || actualBody.length !== record.bytes || sha256(actualBody) !== record.sha256) throw new Error(`Chainlist candidate file digest or source mismatch: ${file}`);
  }
  readCandidateJSON(candidateDir, "candidate-status.json");
  readCandidateJSON(candidateDir, "collision-evidence.json");
  readCandidateJSON(candidateDir, "eip155-6423.json");
  readCandidateJSON(candidateDir, "wallet-add-ethereum-chain.json");
  return {chainId: sources.metadata.value.chainId, gitCommit: manifest.gitCommit, submissionReadyEvidenceAge: submission};
}

function readCandidateJSON(directory, file) {
  const body = fs.readFileSync(path.join(directory, file));
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  if (!body.equals(Buffer.from(canonicalJSON(value)))) throw new Error(`${file} is not canonical JSON`);
  return {body, value};
}

function parseArguments(argv) {
  const result = {submission: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--submission") result.submission = true;
    else if ((argument === "--candidate" || argument === "--source-root") && argv[index + 1]) {
      result[argument === "--candidate" ? "candidateDir" : "sourceRoot"] = argv[index + 1];
      index += 1;
    } else throw new Error(`unknown or incomplete Chainlist verifier argument: ${argument}`);
  }
  if (!result.candidateDir || !result.sourceRoot) throw new Error("usage: chainlist-candidate-verify.mjs --candidate <dir> --source-root <dir> [--submission]");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyChainlistCandidate(parseArguments(process.argv.slice(2)));
  process.stdout.write(`Chainlist candidate verified: chainId=${result.chainId} commit=${result.gitCommit.slice(0, 12)} submitted=false accepted=false walletDefault=false\n`);
}
