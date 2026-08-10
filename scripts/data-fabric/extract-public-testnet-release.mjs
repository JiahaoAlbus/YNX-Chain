#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {readDeterministicTarGz} from "../lib/sdk-release.mjs";

const [archivePath, destination] = process.argv.slice(2);
if (!archivePath || !destination) {
  throw new Error("usage: extract-public-testnet-release.mjs <archive> <empty-destination>");
}
if (fs.existsSync(destination)) {
  const stat = fs.lstatSync(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(destination).length !== 0) {
    throw new Error("extraction destination must be an empty real directory");
  }
} else {
  fs.mkdirSync(destination, {recursive: true, mode: 0o755});
}

const entries = readDeterministicTarGz(fs.readFileSync(archivePath), {maxOutputLength: 256 * 1024 * 1024});
const resolvedDestination = path.resolve(destination);
for (const entry of entries) {
  const output = path.resolve(destination, entry.path);
  if (!output.startsWith(`${resolvedDestination}${path.sep}`)) throw new Error(`unsafe extraction path: ${entry.path}`);
  fs.mkdirSync(path.dirname(output), {recursive: true, mode: 0o755});
  fs.writeFileSync(output, entry.data, {mode: entry.mode, flag: "wx"});
}
process.stdout.write(`${JSON.stringify({status: "extracted", files: entries.length, destination: resolvedDestination})}\n`);
