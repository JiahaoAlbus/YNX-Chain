#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=lib-local-testnet.sh
source scripts/verify/lib-local-testnet.sh
ynx_start_local_testnet
trap ynx_stop_local_testnet EXIT

chain_id=$(ynx_jsonrpc eth_chainId | ynx_json_field '["result"]')
net_version=$(ynx_jsonrpc net_version | ynx_json_field '["result"]')
block_number=$(ynx_jsonrpc eth_blockNumber | ynx_json_field '["result"]')

[[ "$chain_id" == "0x1917" ]] || { echo "unexpected eth_chainId: $chain_id"; exit 1; }
[[ "$net_version" == "6423" ]] || { echo "unexpected net_version: $net_version"; exit 1; }
[[ "$block_number" =~ ^0x[0-9a-f]+$ ]] || { echo "invalid eth_blockNumber: $block_number"; exit 1; }

node --test sdk/js/wallet.test.mjs
node ./scripts/verify/chainlist-candidate-check.mjs

echo "wallet-integration-check passed: eth_chainId=$chain_id net_version=$net_version block=$block_number native=YNXT EIP-1193 add/switch is metadata-bound and requests no account secret"
