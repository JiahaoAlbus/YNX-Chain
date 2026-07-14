import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  EXCHANGE_CANDIDATE_SCHEMA,
  assertExactKeys,
  buildExchangeCandidateStatus,
  exchangeExpectedBodies,
  loadExchangeSources,
} from "../lib/exchange-candidate.mjs";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";

const PACKAGE_FILES = ["exchange-status.json", "manifest.json", "rpc-capabilities.json", "signed-transaction-vectors.json", "ynx-testnet-exchange-profile.json"];

export function verifyExchangeCandidate({candidateDir, sourceRoot}) {
  const sources = loadExchangeSources(sourceRoot);
  const files = fs.readdirSync(candidateDir).sort();
  if (files.length !== PACKAGE_FILES.length || files.some((file, index) => file !== PACKAGE_FILES[index])) throw new Error("exchange candidate file set mismatch or mainnet/unreviewed-file leakage");
  for (const file of files) {
    const stat = fs.lstatSync(path.join(candidateDir, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`exchange candidate entry is not a regular file: ${file}`);
    if ((stat.mode & 0o777) !== 0o644) throw new Error(`exchange candidate file mode is not 0644: ${file}`);
    if (stat.size <= 0 || stat.size > 1024 * 1024) throw new Error(`exchange candidate file size is invalid: ${file}`);
  }
  const manifest = readCanonicalCandidateJSON(candidateDir, "manifest.json").value;
  assertExactKeys(manifest, ["files", "gitCommit", "schema", "status"], "exchange manifest");
  if (manifest.schema !== EXCHANGE_CANDIDATE_SCHEMA || !/^[0-9a-f]{40}$/.test(manifest.gitCommit)) throw new Error("exchange manifest schema or Git commit is invalid");
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sources.root, encoding: "utf8"}).trim();
  if (manifest.gitCommit !== currentCommit) throw new Error("exchange manifest Git commit differs from source checkout");
  if (canonicalJSON(manifest.status) !== canonicalJSON(buildExchangeCandidateStatus(sources))) throw new Error("exchange manifest status makes an unsupported claim");

  const expectedBodies = exchangeExpectedBodies(sources);
  if (!Array.isArray(manifest.files) || manifest.files.length !== expectedBodies.size) throw new Error("exchange manifest file count mismatch");
  const records = new Map(manifest.files.map((record) => [record.file, record]));
  if (records.size !== manifest.files.length || [...expectedBodies.keys()].some((file) => !records.has(file))) throw new Error("exchange manifest files mismatch");
  for (const [file, expectedBody] of expectedBodies) {
    const record = records.get(file);
    assertExactKeys(record, ["bytes", "file", "sha256"], `exchange file ${file}`);
    if (record.file !== file || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || !/^[0-9a-f]{64}$/.test(record.sha256)) throw new Error(`exchange file record is invalid: ${file}`);
    const actualBody = fs.readFileSync(path.join(candidateDir, file));
    if (!actualBody.equals(expectedBody) || actualBody.length !== record.bytes || sha256(actualBody) !== record.sha256) throw new Error(`exchange candidate file digest or source mismatch: ${file}`);
    readCanonicalCandidateJSON(candidateDir, file);
  }
  return {gitCommit: manifest.gitCommit, publicRuntimeDeployed: manifest.status.candidatePublicRuntimeDeployed};
}

function readCanonicalCandidateJSON(directory, file) {
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
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if ((argument === "--candidate" || argument === "--source-root") && argv[index + 1]) {
      result[argument === "--candidate" ? "candidateDir" : "sourceRoot"] = argv[index + 1];
      index += 1;
    } else throw new Error(`unknown or incomplete exchange verifier argument: ${argument}`);
  }
  if (!result.candidateDir || !result.sourceRoot) throw new Error("usage: exchange-candidate-verify.mjs --candidate <dir> --source-root <dir>");
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyExchangeCandidate(parseArguments(process.argv.slice(2)));
  process.stdout.write(`Exchange candidate verified: commit=${result.gitCommit.slice(0, 12)} publicRuntimeDeployed=${result.publicRuntimeDeployed} submitted=false listed=false partnered=false\n`);
}
