#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [releaseDir, commit, release, buildTime] = process.argv.slice(2);
if (!releaseDir || !/^[0-9a-f]{12}$/.test(commit ?? "") || release !== `ynx-data-fabric-${commit}` || !buildTime) {
  throw new Error("usage: write-testnet-release-manifest.mjs <release-dir> <12-char-commit> <release> <build-time>");
}

const required = [
  ["bin/ynx-data-fabricctl", "binary"],
  ["bin/ynx-data-fabricd", "binary"],
  ["bin/ynx-data-fabric-worker", "binary"],
  ["bin/ynx-pay-data-fabric-bridge", "binary"],
  ["config/data-fabric.env", "operator-config-template"],
  ["config/event-keys.json", "operator-config-template"],
  ["scripts/install-testnet-release.sh", "installer"],
  ["systemd/ynx-data-fabricd.service", "systemd-unit"],
  ["systemd/ynx-data-fabric-worker.service", "systemd-unit"],
  ["systemd/ynx-pay-data-fabric-bridge.service", "systemd-unit"],
];

const artifacts = required.map(([relativePath, kind]) => {
  const body = fs.readFileSync(path.join(releaseDir, relativePath));
  return {
    path: relativePath,
    kind,
    bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
});

const manifest = {
  schema: "ynx-data-fabric-testnet-release/v1",
  product: "ynx-data-fabric",
  release,
  commit,
  buildTime,
  target: {os: "linux", architecture: "amd64", channel: "testnet"},
  sourceMode: "bft",
  services: [
    "ynx-data-fabricd.service",
    "ynx-data-fabric-worker.service",
    "ynx-pay-data-fabric-bridge.service",
  ],
  signing: {
    class: "unsigned-testnet-build",
    productionSigned: false,
  },
  artifacts,
};

fs.writeFileSync(path.join(releaseDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o644});
