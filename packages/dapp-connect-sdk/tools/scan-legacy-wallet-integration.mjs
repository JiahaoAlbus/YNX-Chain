import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {resolve, join} from "node:path";

const target = resolve(process.argv[2] || ".");
const ignored = new Set(["node_modules", ".git", "dist", "build", ".ynx-debugpy", ".ynx-js-debug"]);
const rules = [
  ["LOOPBACK_ENDPOINT", /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2)(?::\d+)?(?:[/'"`]|$)/i, "Release endpoints must come from a verified manifest."],
  ["UNSAFE_RELATIVE_API", /(?:fetch|axios\.(?:get|post))\s*\(\s*["']\/api\//i, "Release clients must not rely on an unresolved relative /api endpoint."],
  ["GENERIC_DEVICE_PROOF_COPY", /Device Proof rejected/i, "Use typed Product Session error mapping and preserve correlation IDs."],
  ["LOCAL_SESSION_FALLBACK", /(?:local|canned)\s+(?:product )?session|create(?:d)?\s+local\s+session/i, "Never manufacture a local Product Session fallback."],
  ["LEGACY_ED25519_SESSION", /Ed25519.*(?:session|proof)|(?:session|proof).*Ed25519/i, "Migrate session proofs to the accepted P-256 protocol through Wallet Protocol owner guidance."],
  ["DIRECT_GATEWAY_CHALLENGE", /\b(?:createGatewayChallenge|signGatewayChallenge|createProductSessionProof)\b/, "Use the shared SDK Product Session adapter after standard connection."],
  ["DIRECT_PRODUCT_SESSION", /\b(?:introspect(?:ion)?|session\.complete|completeProductSession)\b/i, "Do not call Product Session completion or introspection directly."],
  ["HANDWRITTEN_CALLBACK", /(?:callback(?:Url|URI)?\s*[:=]|[a-z]+:\/\/wallet)/i, "Use PendingCallbackStore and accepted Wallet callback handling."],
  ["HANDWRITTEN_DEEP_LINK", /(?:["'`]walletconnect:|["'`]wc:\/\/|["'`]faucet:\/\/)/i, "Use the approved wallet/deep-link helper; do not compose links by hand."],
  ["HARDCODED_SERVICE_ENDPOINT", /https:\/\/(?:gateway|wallet-auth|rpc|evm|rest)\./i, "Load verified endpoints through the accepted Endpoint Manifest."],
  ["WINDOW_ETHEREUM_ONLY", /window\.ethereum(?!\s*\?)/, "Support EIP-6963 and WalletConnect in addition to injected wallets."],
  ["GENERIC_OFFLINE_CATCH", /catch\s*\([^)]*\)\s*\{[^}]*\bOffline\b/is, "Preserve typed EIP-1193 and Product Session failures; do not collapse to Offline."],
  ["SESSION_CLEARING_ON_DEGRADE", /(?:gateway|catch|error|fail)[\s\S]{0,240}(?:this\.)?connection\s*=\s*null/i, "Gateway failure must not clear a standard wallet connection."]
];
function files(path) { if (!existsSync(path)) return []; const entry = statSync(path); if (entry.isFile()) return [path]; return readdirSync(path, {withFileTypes: true}).flatMap(item => ignored.has(item.name) || (resolve(path) === target && ["tools", "test", "integration", "README.md"].includes(item.name) && target.endsWith("dapp-connect-sdk")) ? [] : files(join(path, item.name))); }
const findings = [];
for (const file of files(target)) {
  if (!/\.(?:[cm]?[jt]sx?|json|html|md)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const [code, pattern, remediation] of rules) if (pattern.test(content)) findings.push({code, file, remediation});
}
process.stdout.write(`${JSON.stringify({tool: "ynx-dapp-connect-migration-scan", target, findings}, null, 2)}\n`);
process.exitCode = findings.length ? 2 : 0;
