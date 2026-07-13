#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [workDir, release, commit, buildTime, deployTarget, chainId, chainName] = process.argv.slice(2);
if (!workDir || !release || !commit || !buildTime) {
  console.error("usage: node scripts/deploy/write-release-manifest.mjs <work-dir> <release> <commit> <build-time> <deploy-target> <chain-id> <chain-name>");
  process.exit(2);
}

function fileEntry(relativePath, kind) {
  const fullPath = path.join(workDir, relativePath);
  const body = fs.readFileSync(fullPath);
  return {
    path: relativePath,
    kind,
    bytes: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

const binaries = [
  "bin/ynx-chaind",
  "bin/ynx-indexerd",
  "bin/ynx-explorerd",
  "bin/ynx-faucetd",
  "bin/ynx-ai-gatewayd",
  "bin/ynx-payd",
  "bin/ynx-trustd",
  "bin/ynx-resourced",
  "bin/ynx-bridged",
  "bin/ynx-stablecoind",
].map((file) => fileEntry(file, "binary"));

const roleEnvs = [
  "config/ynx-chaind-primary.env",
  "config/ynx-chaind-singapore.env",
  "config/ynx-chaind-silicon-valley.env",
  "config/ynx-chaind-seoul.env",
].map((file) => fileEntry(file, "role-env"));

const serviceFiles = [
  "config/ynx-ai-gatewayd.env",
  "config/ynx-payd.env",
  "config/ynx-trustd.env",
  "config/ynx-resourced.env",
  "config/ynx-bridged.env",
  "config/ynx-stablecoind.env",
  "systemd/ynx-chaind.service",
  "systemd/ynx-indexerd.service",
  "systemd/ynx-explorerd.service",
  "systemd/ynx-faucetd.service",
  "systemd/ynx-ai-gatewayd.service",
  "systemd/ynx-payd.service",
  "systemd/ynx-trustd.service",
  "systemd/ynx-resourced.service",
  "systemd/ynx-bridged.service",
  "systemd/ynx-stablecoind.service",
  "nginx/ynx-chain.conf",
].map((file) => fileEntry(file, "service-config"));

const manifest = {
  schema: "ynx-chain-release-manifest/v1",
  release,
  commit,
  buildTime,
  deployTarget: deployTarget || "unknown",
  chainId: Number(chainId || 0),
  chainName: chainName || "",
  provenance: {
    source: "local-deploy-build",
    binaryIdentityEndpoint: ["/status.build", "/node/identity.build"],
    remotePublicProof: false,
  },
  artifacts: [...binaries, ...roleEnvs, ...serviceFiles],
};

fs.writeFileSync(path.join(workDir, "config/release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
