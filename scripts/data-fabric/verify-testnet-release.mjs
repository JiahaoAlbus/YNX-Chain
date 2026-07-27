#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [releaseDir, expectedCommit, expectedRelease] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
if (!releaseDir || !/^[0-9a-f]{12}$/.test(expectedCommit ?? "") || expectedRelease !== `ynx-data-fabric-${expectedCommit}`) {
  fail("usage: verify-testnet-release.mjs <release-dir> <12-char-commit> <release>");
}

const manifestPath = path.join(releaseDir, "release-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema !== "ynx-data-fabric-testnet-release/v1" || manifest.product !== "ynx-data-fabric") fail("release identity is invalid");
if (manifest.commit !== expectedCommit || manifest.release !== expectedRelease) fail("release is not bound to the expected commit");
if (manifest.target?.os !== "linux" || manifest.target?.architecture !== "amd64" || manifest.target?.channel !== "testnet") fail("release target is invalid");
if (manifest.sourceMode !== "bft" || manifest.signing?.class !== "unsigned-testnet-build" || manifest.signing?.productionSigned !== false) fail("release truth is invalid");
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 10) fail("release artifact inventory is incomplete");

for (const artifact of manifest.artifacts) {
  if (!artifact || typeof artifact.path !== "string" || artifact.path.includes("..") || path.isAbsolute(artifact.path)) fail("artifact path is invalid");
  const body = fs.readFileSync(path.join(releaseDir, artifact.path));
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (body.length !== artifact.bytes || digest !== artifact.sha256) fail(`artifact integrity mismatch: ${artifact.path}`);
}

const bridgeUnit = fs.readFileSync(path.join(releaseDir, "systemd/ynx-pay-data-fabric-bridge.service"), "utf8");
for (const required of [
  "Requires=ynx-data-fabricd.service ynx-bft-gateway-candidate.service",
  "ExecStart=/usr/local/bin/ynx-pay-data-fabric-bridge --pay-source-mode=bft",
  "EnvironmentFile=/etc/ynx-data-fabric/data-fabric.env",
  "ProtectSystem=strict",
]) {
  if (!bridgeUnit.includes(required)) fail(`BFT Pay bridge unit is missing ${required}`);
}
if (bridgeUnit.includes("UPSTREAM_KEY") || bridgeUnit.includes("upstream-key")) fail("BFT Pay bridge unit references the legacy upstream secret");

for (const unitName of ["ynx-data-fabricd.service", "ynx-data-fabric-worker.service", "ynx-pay-data-fabric-bridge.service"]) {
  const unit = fs.readFileSync(path.join(releaseDir, "systemd", unitName), "utf8");
  for (const hardening of ["NoNewPrivileges=true", "PrivateTmp=true", "ProtectSystem=strict", "ProtectHome=true"]) {
    if (!unit.includes(hardening)) fail(`${unitName} is missing ${hardening}`);
  }
}

const installer = fs.readFileSync(path.join(releaseDir, "scripts/install-testnet-release.sh"), "utf8");
for (const required of ["migrate-postgres", "sha256sum -c", "YNX_PAY_DATA_FABRIC_SOURCE_MODE", "YNX_PAY_DATA_FABRIC_UPSTREAM_KEY_FILE"]) {
  if (!installer.includes(required)) fail(`installer is missing ${required}`);
}

process.stdout.write(`${JSON.stringify({status: "verified", commit: expectedCommit, release: expectedRelease, artifacts: manifest.artifacts.length})}\n`);
