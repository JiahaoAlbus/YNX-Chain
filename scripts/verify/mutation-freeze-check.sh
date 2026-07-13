#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/mutationfreeze
for command in ynx-chaind ynx-bft-gatewayd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced ynx-bridged ynx-stablecoind; do
  grep -Fq 'mutationfreeze.FromEnv' "cmd/${command}/main.go" || { echo "$command is not protected by the runtime mutation freeze" >&2; exit 1; }
done
grep -Fq 'YNX_MUTATION_FREEZE_FILE=/var/lib/ynx-chain/mutation-freeze.json' scripts/deploy/deploy-testnet.sh
grep -Fq 'YNX_MUTATION_FREEZE_FILE=/var/lib/ynx-chain/mutation-freeze.json' .env.bft-gateway.example

echo "mutation-freeze-check passed: nine writable services share a runtime marker; normal reads and AI chat remain available, read-only EVM POST bodies are preserved, and chain mutations return retryable HTTP 503 while frozen"
