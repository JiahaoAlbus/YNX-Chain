#!/usr/bin/env bash
set -euo pipefail

echo "Deployment requires real values from ENV_INTAKE_FORM.md and a real .env file."
echo "This script refuses to deploy until SERVER_HOST, SSH_KEY_PATH, RPC_DOMAIN, EVM_RPC_DOMAIN, and validator keys are configured."
required=(SERVER_HOST SSH_KEY_PATH RPC_DOMAIN EVM_RPC_DOMAIN VALIDATOR_KEY_PATH DEPLOYER_PRIVATE_KEY)
missing=0
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then echo "Missing required env: $key"; missing=1; fi
done
[[ "$missing" == "0" ]] || exit 1
echo "Ready to run remote deployment commands for YNX Testnet."

