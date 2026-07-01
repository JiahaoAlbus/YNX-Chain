#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../verify/lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

out="tmp/packages/public-proof"
rm -rf "$out"
mkdir -p "$out"

status=$(curl -fsS "$YNX_REST_URL/status")
latest_block=$(curl -fsS "$YNX_REST_URL/blocks/latest")
chain_id=$(ynx_jsonrpc eth_chainId)
faucet=$(curl -fsS -X POST "$YNX_REST_URL/faucet" -H 'content-type: application/json' -d '{"address":"ynx_public_proof","amount":1000}')
pay=$(curl -fsS -X POST "$YNX_REST_URL/pay/intents" -H 'content-type: application/json' -d '{"merchant":"public_proof","amount":1}')
trust=$(curl -fsS "$YNX_REST_URL/trust/trace/ynx_public_proof")
source='pragma solidity ^0.8.24; contract PublicProof { function ping() public pure returns (uint256) { return 1; } }'
deploy=$(node -e 'const source=process.argv[1]; process.stdout.write(JSON.stringify({deployer:"ynx_public_proof",name:"PublicProof",source}))' "$source" | curl -fsS -X POST "$YNX_REST_URL/ide/deploy" -H 'content-type: application/json' -d @-)

node - "$out/local-proof.json" "$status" "$latest_block" "$chain_id" "$faucet" "$pay" "$trust" "$deploy" <<'NODE'
const fs = require("fs");
const [target, statusRaw, blockRaw, chainRaw, faucetRaw, payRaw, trustRaw, deployRaw] = process.argv.slice(2);
const proof = {
  proofType: "local-testnet-proof",
  generatedAt: new Date().toISOString(),
  truthfulStatus: "local verification only; public endpoint proof requires real deployment values",
  endpoints: {
    rest: "http://127.0.0.1:6420",
    evmRpc: "http://127.0.0.1:6420/evm"
  },
  status: JSON.parse(statusRaw),
  latestBlock: JSON.parse(blockRaw),
  evmChainId: JSON.parse(chainRaw),
  faucetTransaction: JSON.parse(faucetRaw),
  payIntent: JSON.parse(payRaw),
  trustTrace: JSON.parse(trustRaw),
  ideDeployment: JSON.parse(deployRaw),
  missingPublicFields: [
    "PUBLIC_WEBSITE_URL",
    "PUBLIC_EXPLORER_URL",
    "PUBLIC_RPC_URL",
    "PUBLIC_FAUCET_URL",
    "PUBLIC_DEMO_TX_HASH",
    "PUBLIC_DEMO_CONTRACT_ADDRESS",
    "DEPLOYMENT_TIMESTAMP"
  ]
};
fs.writeFileSync(target, JSON.stringify(proof, null, 2) + "\n");
NODE

final="$out/final"
rm -rf "$final"
mkdir -p "$final"
cp "$out/local-proof.json" "$final/local-proof.json"
cp docs/public-proof/PUBLIC_TESTNET_PROOF.md "$final/PUBLIC_TESTNET_PROOF.md"
cp docs/acceptance/TESTNET_ACCEPTANCE_REPORT.md "$final/TESTNET_ACCEPTANCE_REPORT.md"
node - "$final" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [out, gitCommit, generatedAt] = process.argv.slice(2);
const files = fs.readdirSync(out).filter((file) => file !== "manifest.json").sort().map((file) => {
  const body = fs.readFileSync(path.join(out, file));
  return {file, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex")};
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  package: "ynx-public-proof-package",
  generatedAt,
  gitCommit,
  status: "local-proof-ready; public endpoint evidence required after real deployment",
  files
}, null, 2) + "\n");
NODE
find "$out" -type f | sort
echo "public-proof package generated $out"
