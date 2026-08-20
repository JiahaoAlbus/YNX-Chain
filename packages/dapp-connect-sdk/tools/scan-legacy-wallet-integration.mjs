import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {resolve, join} from "node:path";

const target = resolve(process.argv[2] || ".");
const ignored = new Set(["node_modules", ".git", "dist", "build"]);
const rules = [
  ["LOOPBACK_ENDPOINT", /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(?::\d+)?(?:[/'"`]|$)/i, "Release endpoints must come from a verified manifest."],
  ["UNSAFE_RELATIVE_API", /(?:fetch|axios\.(?:get|post))\s*\(\s*["']\/api\//i, "Release clients must not rely on an unresolved relative /api endpoint."],
  ["GENERIC_DEVICE_PROOF_COPY", /Device Proof rejected/i, "Use typed Product Session error mapping and preserve correlation IDs."],
  ["LOCAL_SESSION_FALLBACK", /(?:local|canned)\s+(?:product )?session|create(?:d)?\s+local\s+session/i, "Never manufacture a local Product Session fallback."],
  ["LEGACY_ED25519_SESSION", /Ed25519.*(?:session|proof)|(?:session|proof).*Ed25519/i, "Migrate session proofs to the accepted P-256 protocol through Wallet Protocol owner guidance."]
];
function files(path) { if (!existsSync(path)) return []; const entry = statSync(path); if (entry.isFile()) return [path]; return readdirSync(path, {withFileTypes: true}).flatMap(item => ignored.has(item.name) ? [] : files(join(path, item.name))); }
const findings = [];
for (const file of files(target)) {
  if (!/\.(?:[cm]?[jt]sx?|json|html|md)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const [code, pattern, remediation] of rules) if (pattern.test(content)) findings.push({code, file, remediation});
}
process.stdout.write(`${JSON.stringify({tool: "ynx-dapp-connect-migration-scan", target, findings}, null, 2)}\n`);
process.exitCode = findings.length ? 2 : 0;
