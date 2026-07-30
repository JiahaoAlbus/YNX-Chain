#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

go test -race ./internal/bridgegateway -run 'TestCircleCCTPV2'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
endpoint="https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6"
response="$tmp/circle-cctp-fees.json"
connected=false
for attempt in 1 2; do
  if curl -4 --fail-with-body --silent --show-error --max-time 15 \
    -H 'Accept: application/json' "$endpoint" >"$response"; then
    connected=true
    break
  fi
done
[[ "$connected" == true ]] || { echo "official Circle CCTP Sandbox fee API unavailable after two attempts"; exit 1; }

node - "$response" <<'NODE'
const fs = require("fs");
const tiers = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 4) throw new Error("invalid Circle CCTP fee tier count");
const seen = new Set();
for (const tier of tiers) {
  if (![1000, 2000].includes(tier.finalityThreshold) || !Number.isSafeInteger(tier.minimumFee) || tier.minimumFee < 0 || tier.minimumFee > 10000 || seen.has(tier.finalityThreshold)) {
    throw new Error(`invalid Circle CCTP fee tier: ${JSON.stringify(tier)}`);
  }
  seen.add(tier.finalityThreshold);
}
if (!seen.has(2000)) throw new Error("Circle CCTP Sandbox response omitted finalized tier");
NODE

echo "bridge provider check passed: official Circle CCTP V2 Sandbox fee API connected; YNX route execution remains disabled"
