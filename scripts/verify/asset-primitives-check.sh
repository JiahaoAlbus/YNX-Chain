#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

node -e 'for(const path of ["chain/accounts/user-operation.schema.json","chain/governance/strategy-mandate.schema.json"]) JSON.parse(require("fs").readFileSync(path,"utf8"))'
go test -count=1 ./internal/assetauth ./internal/consensus ./internal/bftgateway
go test -race -count=1 ./internal/assetauth ./internal/consensus ./internal/bftgateway
npm test --prefix sdk/js

printf '%s\n' 'Smart Account, StrategyMandate, Vault, ABCI/Gateway integration, fee-invariant, schema, and SDK local gate passed.'
