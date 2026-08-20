import fs from "node:fs";
import { spawnSync } from "node:child_process";

const service = "ynx-wallet-gateway.service";
const baseEnvironmentFile = "/etc/ynx/wallet-gateway.env";
const candidateEnvironmentFile = "/etc/ynx/wallet/wallet-gateway-candidate-6cf3ef84.env";
const dropIn = "/etc/systemd/system/ynx-wallet-gateway.service.d/90-candidate-runtime.conf";
const sharedLegacyState = "/var/lib/ynx-wallet-gateway/state.json";
const expected = {
  YNX_WALLET_GATEWAY_STATE_PATH: "/var/lib/ynx-wallet-gateway-candidate-6cf3ef84/v1-state.json",
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
const assertExpected = (entries) => {
  for (const [name, value] of Object.entries(expected)) if (entries.get(name) !== value) fail(`effective ${name} mismatch`);
  if (entries.get("YNX_WALLET_GATEWAY_STATE_PATH") === sharedLegacyState) fail("shared legacy v1 path remained effective");
};
if (process.argv.includes("--self-test")) {
  const sample = Object.entries(expected).map(([name, value]) => `${name}=${value}`).join("\n");
  assertExpected(parseEnvironment(sample));
  let rejected = false;
  try { assertExpected(parseEnvironment(sample.replace(expected.YNX_WALLET_GATEWAY_STATE_PATH, sharedLegacyState))); } catch { rejected = true; }
  if (!rejected) fail("shared legacy state self-test failed");
  console.log("PASS systemd environment schema self-test: six exact overrides and shared-v1 rejection");
  process.exit(0);
}

const envStat = fs.lstatSync(candidateEnvironmentFile);
if (!envStat.isFile() || envStat.isSymbolicLink() || envStat.nlink !== 1 || (envStat.mode & 0o777) !== 0o600) fail("candidate EnvironmentFile must be a mode-0600 regular non-symlink with nlink=1");
const candidateLines = fs.readFileSync(candidateEnvironmentFile, "utf8").trim().split("\n");
if (candidateLines.length !== 6) fail("candidate EnvironmentFile must contain exactly six overrides");
const candidateEntries = parseEnvironment(candidateLines.join("\n"));
if (candidateEntries.size !== 6) fail("candidate EnvironmentFile contains a duplicate key");
assertExpected(candidateEntries);

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
console.log(JSON.stringify({ service, baseEnvironmentFile, candidateEnvironmentFile, candidateLoadedAfterBase: true, effectiveSixOverridesVerified: true, effectiveStatePath: expected.YNX_WALLET_GATEWAY_STATE_PATH, sharedLegacyStatePathEffective: false, productionServiceStartedByVerifier: false }));
