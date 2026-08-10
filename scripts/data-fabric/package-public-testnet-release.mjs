#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {canonicalJSON, createDeterministicTarGz, sha256} from "../lib/sdk-release.mjs";

const [releaseDir, outputDir, expectedCommit, expectedRelease] = process.argv.slice(2);
if (
  !releaseDir
  || !outputDir
  || !/^[0-9a-f]{12}$/.test(expectedCommit ?? "")
  || expectedRelease !== `ynx-data-fabric-${expectedCommit}`
) {
  throw new Error("usage: package-public-testnet-release.mjs <release-dir> <output-dir> <commit> <release>");
}

const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, "release-manifest.json"), "utf8"));
if (manifest.commit !== expectedCommit || manifest.release !== expectedRelease) {
  throw new Error("release directory is not bound to the expected commit");
}

const files = [];
function walk(directory, prefix = "") {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`release contains a symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      walk(absolute, relative);
    } else if (stat.isFile()) {
      files.push({
        path: `${expectedRelease}/${relative}`,
        data: fs.readFileSync(absolute),
        mode: stat.mode & 0o111 ? 0o755 : 0o644,
      });
    } else {
      throw new Error(`release contains a non-regular entry: ${relative}`);
    }
  }
}
walk(releaseDir);

const archive = createDeterministicTarGz(files);
const archiveName = `${expectedRelease}-linux-amd64.tar.gz`;
const indexName = `${expectedRelease}-release-index.json`;
const index = {
  schema: "ynx-data-fabric-public-testnet-release/v1",
  product: "ynx-data-fabric",
  release: expectedRelease,
  commit: expectedCommit,
  buildTime: manifest.buildTime,
  target: {os: "linux", architecture: "amd64", channel: "public-testnet-candidate"},
  artifact: {path: archiveName, bytes: archive.length, sha256: sha256(archive)},
  signing: {class: "unsigned-testnet-build", productionSigned: false},
  hosting: {hosted: false, immutableURL: null},
};

fs.mkdirSync(outputDir, {recursive: true, mode: 0o755});
fs.writeFileSync(path.join(outputDir, archiveName), archive, {mode: 0o644});
fs.writeFileSync(path.join(outputDir, indexName), canonicalJSON(index), {mode: 0o644});
process.stdout.write(`${JSON.stringify({archive: archiveName, index: indexName, sha256: index.artifact.sha256})}\n`);
