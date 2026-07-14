#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
out="tmp/packages/chainlist"
node ./scripts/package/chainlist-candidate.mjs --output "$out"
node ./scripts/verify/chainlist-candidate-verify.mjs --candidate "$out" --source-root .
find "$out" -maxdepth 1 -type f | sort
echo "chainlist-package generated a testnet-only candidate; submitted=false accepted=false walletDefault=false"
