import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {loadBundledManifest} from "../src/endpoints.js";
const target = process.argv[2] || ".";
const manifestPath = process.argv[3];
const scan = spawnSync(process.execPath, ["tools/scan-legacy-wallet-integration.mjs", target], {cwd: new URL("..", import.meta.url), encoding: "utf8"});
let endpointActivation = {state: "BLOCKED_MANIFEST_NOT_SUPPLIED"};
if (manifestPath) {
  try { const manifest = JSON.parse(readFileSync(manifestPath, "utf8")), accepted = await loadBundledManifest(manifest); endpointActivation = {state: accepted.verification, releaseId: accepted.releaseId}; }
  catch (error) { endpointActivation = {state: "BLOCKED", code: error.code}; }
}
const report = {tool: "ynx-dapp-connect-release-gate", target, migrationScan: JSON.parse(scan.stdout || "{}"), endpointActivation};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = scan.status || 0;
