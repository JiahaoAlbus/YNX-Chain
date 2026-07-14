import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {
  EXCHANGE_CANDIDATE_SCHEMA,
  buildExchangeCandidateStatus,
  exchangeExpectedBodies,
  loadExchangeSources,
} from "../lib/exchange-candidate.mjs";
import {canonicalJSON, sha256} from "../lib/sdk-release.mjs";

export function buildExchangeCandidate({rootDir, outputDir}) {
  const sources = loadExchangeSources(rootDir);
  const output = path.resolve(outputDir);
  const allowed = [path.join(sources.root, "tmp"), path.resolve(os.tmpdir())];
  if (!allowed.some((root) => output === root || output.startsWith(`${root}${path.sep}`))) throw new Error("exchange candidate output must be under repository tmp/ or the system temporary directory");
  const bodies = exchangeExpectedBodies(sources);
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {cwd: sources.root, encoding: "utf8"}).trim();
  const manifest = {
    files: [...bodies.entries()].map(([file, body]) => ({bytes: body.length, file, sha256: sha256(body)})).sort((left, right) => left.file.localeCompare(right.file)),
    gitCommit,
    schema: EXCHANGE_CANDIDATE_SCHEMA,
    status: buildExchangeCandidateStatus(sources),
  };
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true, mode: 0o755});
  for (const [file, body] of bodies) fs.writeFileSync(path.join(output, file), body, {mode: 0o644});
  fs.writeFileSync(path.join(output, "manifest.json"), canonicalJSON(manifest), {mode: 0o644});
  return {manifest, outputDir: output};
}

function parseArguments(argv) {
  let outputDir = "tmp/packages/exchange";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output" || !argv[index + 1]) throw new Error("usage: exchange-candidate.mjs [--output <directory>]");
    outputDir = argv[index + 1];
    index += 1;
  }
  return {outputDir};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildExchangeCandidate({rootDir: process.cwd(), ...parseArguments(process.argv.slice(2))});
  process.stdout.write(`Exchange candidate generated: ${result.outputDir}\n${canonicalJSON(result.manifest.status)}`);
}
