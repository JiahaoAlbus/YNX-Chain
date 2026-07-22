#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

node --test sdk/bridge/index.test.mjs
(
  cd sdk/bridge
  npm pack --dry-run --json >/dev/null
)
! rg -n 'X-YNX-Bridge-Key|Authorization|apiKey|privateKey|seedPhrase' sdk/bridge/index.js
node -e 'const p=require("./sdk/bridge/package.json");if(p.private!==true||p.name!=="@ynx-chain/bridge-sdk"||p.files.join(",")!=="README.md,index.js")process.exit(1)'

echo "bridge-sdk-check passed: read-only public client, truthful contracts, destination-confirmed availability gate, bounded errors, and unpublished package boundary"
