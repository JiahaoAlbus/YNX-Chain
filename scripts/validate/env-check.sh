#!/usr/bin/env bash
set -euo pipefail

templates=(.env.example .env.testnet.example .env.website.example .env.ai.example .env.pay.example .env.trust.example .env.indexer.example .env.explorer.example .env.faucet.example .env.ide.example .env.monitoring.example .env.deploy.example)
for f in "${templates[@]}"; do
  test -f "$f" || { echo "missing env template: $f"; exit 1; }
done
grep -q '^CHAIN_ID=' .env.testnet.example
grep -q '^NATIVE_SYMBOL=' .env.testnet.example
echo "env templates present; real deployment env values must be supplied via ENV_INTAKE_FORM.md"

