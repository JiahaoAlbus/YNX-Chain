import {spawnSync} from "node:child_process";
const target = process.argv[2] || ".";
const scan = spawnSync(process.execPath, ["tools/scan-legacy-wallet-integration.mjs", target], {cwd: new URL("..", import.meta.url), encoding: "utf8"});
const report = {tool: "ynx-dapp-connect-release-gate", target, migrationScan: JSON.parse(scan.stdout || "{}"), endpointActivation: "BLOCKED_UNTIL_ACCEPTED_SIGNED_MANIFEST"};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = scan.status || 0;
