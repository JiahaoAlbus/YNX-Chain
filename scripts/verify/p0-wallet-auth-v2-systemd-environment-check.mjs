import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const service = "ynx-wallet-gateway.service";
const baseEnvironmentFile = "/etc/ynx/wallet-gateway.env";
const candidateEnvironmentFile = "/etc/ynx/wallet/wallet-gateway-candidate-6cf3ef84.env";
const dropIn = "/etc/systemd/system/ynx-wallet-gateway.service.d/90-candidate-runtime.conf";
const sharedLegacyState = "/var/lib/ynx-wallet-gateway/state.json";
const authoritativeV1Registry = "/etc/ynx/wallet/central-registry-ae156b31.json";
const authoritativeV1RegistryBytes = 20037;
const authoritativeV1RegistrySha256 = "ae156b317b9a97bfd42397cca634021deefe10ffb009102899e24276d8721e31";
const expected = {
  YNX_WALLET_GATEWAY_STATE_PATH: "/var/lib/ynx-wallet-gateway-candidate-6cf3ef84/v1-state.json",
  YNX_WALLET_GATEWAY_REGISTRY_PATH: authoritativeV1Registry,
  YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH: "/var/lib/ynx-wallet-gateway-candidate-6cf3ef84/v2-state.json",
  YNX_PRODUCT_SESSION_GATEWAY_REGISTRY_PATH: "/etc/ynx/wallet/product-session-registry-6cf3ef84.json",
  YNX_WALLET_GATEWAY_SOURCE_COMMIT: "6cf3ef845202bd879ed94515a71b323dd2fc9e14",
  YNX_WALLET_GATEWAY_RELEASE: "p0-v2-state-isolated-6cf3ef84",
  YNX_WALLET_GATEWAY_BUILD_TIME: "2026-08-20T12:24:41.000Z"
};
const fail = (message) => { throw new Error(message); };
const parseEnvironment = (text) => {
  const entries = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index < 1) fail(`invalid environment line: ${line}`);
    entries.set(line.slice(0, index), line.slice(index + 1));
  }
  return entries;
};
const assertExpected = (entries, exact = false) => {
  if (exact && entries.size !== 7) fail("candidate EnvironmentFile must contain exactly seven unique overrides");
  for (const [name, value] of Object.entries(expected)) if (entries.get(name) !== value) fail(`effective ${name} mismatch`);
  if (entries.get("YNX_WALLET_GATEWAY_STATE_PATH") === sharedLegacyState) fail("shared legacy v1 path remained effective");
  if (entries.get("YNX_WALLET_GATEWAY_REGISTRY_PATH") !== authoritativeV1Registry) fail("candidate v1 registry path is not authoritative");
};
const assertRegistryFacts = ({ isFile, isSymbolicLink, nlink, mode, uid, gid, bytes, sha256 }) => {
  if (!isFile || isSymbolicLink || nlink !== 1 || mode !== 0o644 || uid !== 0 || gid !== 0) fail("authoritative v1 registry must be root:root mode-0644 regular non-symlink with nlink=1");
  if (bytes !== authoritativeV1RegistryBytes || sha256 !== authoritativeV1RegistrySha256) fail("authoritative v1 registry bytes or SHA-256 mismatch");
};
if (process.argv.includes("--self-test")) {
  const sample = Object.entries(expected).map(([name, value]) => `${name}=${value}`).join("\n");
  assertExpected(parseEnvironment(sample), true);
  assertRegistryFacts({ isFile: true, isSymbolicLink: false, nlink: 1, mode: 0o644, uid: 0, gid: 0, bytes: authoritativeV1RegistryBytes, sha256: authoritativeV1RegistrySha256 });
  let rejected = false;
  try { assertExpected(parseEnvironment(sample.replace(expected.YNX_WALLET_GATEWAY_STATE_PATH, sharedLegacyState))); } catch { rejected = true; }
  if (!rejected) fail("shared legacy state self-test failed");
  rejected = false;
  try { assertExpected(parseEnvironment(sample.replace(authoritativeV1Registry, "/tmp/unreviewed-registry.json"))); } catch { rejected = true; }
  if (!rejected) fail("non-authoritative v1 registry self-test failed");
  console.log("PASS systemd environment schema self-test: seven exact overrides, immutable v1 registry facts, shared-v1 and registry-fallback rejection");
  process.exit(0);
}

const registryStat = fs.lstatSync(authoritativeV1Registry);
const registryBytes = fs.readFileSync(authoritativeV1Registry);
assertRegistryFacts({ isFile: registryStat.isFile(), isSymbolicLink: registryStat.isSymbolicLink(), nlink: registryStat.nlink, mode: registryStat.mode & 0o777, uid: registryStat.uid, gid: registryStat.gid, bytes: registryBytes.length, sha256: createHash("sha256").update(registryBytes).digest("hex") });
const envStat = fs.lstatSync(candidateEnvironmentFile);
if (!envStat.isFile() || envStat.isSymbolicLink() || envStat.nlink !== 1 || (envStat.mode & 0o777) !== 0o600) fail("candidate EnvironmentFile must be a mode-0600 regular non-symlink with nlink=1");
const candidateLines = fs.readFileSync(candidateEnvironmentFile, "utf8").trim().split("\n");
if (candidateLines.length !== 7) fail("candidate EnvironmentFile must contain exactly seven overrides");
const candidateEntries = parseEnvironment(candidateLines.join("\n"));
assertExpected(candidateEntries, true);

const dropInText = fs.readFileSync(dropIn, "utf8").trim();
if (dropInText !== `[Service]\nEnvironmentFile=${candidateEnvironmentFile}`) fail("candidate drop-in may only append the exact candidate EnvironmentFile");
const show = spawnSync("systemctl", ["show", service, "--property=EnvironmentFiles", "--value"], { encoding: "utf8" });
if (show.status !== 0) fail(`systemctl EnvironmentFiles read failed: ${show.stderr}`);
const baseIndex = show.stdout.indexOf(baseEnvironmentFile), candidateIndex = show.stdout.indexOf(candidateEnvironmentFile);
if (baseIndex < 0 || candidateIndex < 0 || candidateIndex <= baseIndex) fail("candidate EnvironmentFile is not loaded after the base EnvironmentFile");

const unit = `ynx-wallet-v2-env-probe-${process.pid}`;
const probe = spawnSync("systemd-run", ["--quiet", "--wait", "--pipe", "--collect", `--unit=${unit}`, `--property=EnvironmentFile=${baseEnvironmentFile}`, `--property=EnvironmentFile=${candidateEnvironmentFile}`, "/usr/bin/env"], { encoding: "utf8" });
if (probe.status !== 0) fail(`systemd effective-environment probe failed: ${probe.stderr}`);
assertExpected(parseEnvironment(probe.stdout.trim()));
console.log(JSON.stringify({ service, baseEnvironmentFile, candidateEnvironmentFile, candidateLoadedAfterBase: true, effectiveSevenOverridesVerified: true, effectiveStatePath: expected.YNX_WALLET_GATEWAY_STATE_PATH, effectiveV1RegistryPath: authoritativeV1Registry, registryBytes: registryBytes.length, registrySha256: authoritativeV1RegistrySha256, registryOwner: "root:root", registryMode: "0644", registryNlink: 1, registrySymlink: false, sharedLegacyStatePathEffective: false, productionServiceStartedByVerifier: false }));
