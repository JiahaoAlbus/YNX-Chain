#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

node --test sdk/bridge/index.test.mjs
(
  cd sdk/bridge
  npm pack --dry-run --json >/dev/null
)
node -e 'const fs=require("node:fs");const text=fs.readFileSync("sdk/bridge/index.js","utf8");for(const forbidden of ["X-YNX-Bridge-Key","Authorization","apiKey","privateKey","seedPhrase"])if(text.includes(forbidden)){console.error(`forbidden SDK credential token: ${forbidden}`);process.exit(1)}'
node -e 'const p=require("./sdk/bridge/package.json");if(p.private!==true||p.name!=="@ynx-chain/bridge-sdk"||p.version!=="0.3.1"||p.types!=="./index.d.ts"||p.files.join(",")!=="README.md,index.js,index.d.ts"||p.exports?.["."]?.types!=="./index.d.ts")process.exit(1)'
node -e 'const fs=require("node:fs");const d=fs.readFileSync("sdk/bridge/index.d.ts","utf8");for(const required of ["destination_mint_release_confirmed","destination_available","destinationAssetAvailable","getVersion","getStateMachine","getProviders","BridgeProviderRegistry"])if(!d.includes(required))process.exit(1)'

echo "bridge-sdk-check passed: typed read-only client, runtime version/state-machine validation, explicit destination availability gate, bounded errors, and unpublished package boundary"
