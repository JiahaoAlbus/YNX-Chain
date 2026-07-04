#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh
ynx_load_env

export PUBLIC_RPC_URL="${PUBLIC_RPC_URL:-https://rpc.ynxweb4.com}"
export PUBLIC_EVM_RPC_URL="${PUBLIC_EVM_RPC_URL:-https://evm.ynxweb4.com}"
export PUBLIC_REST_URL="${PUBLIC_REST_URL:-https://rest.ynxweb4.com}"
export PUBLIC_FAUCET_URL="${PUBLIC_FAUCET_URL:-https://faucet.ynxweb4.com}"
export PUBLIC_INDEXER_URL="${PUBLIC_INDEXER_URL:-https://indexer.ynxweb4.com}"
export PUBLIC_EXPLORER_URL="${PUBLIC_EXPLORER_URL:-https://explorer.ynxweb4.com}"
export PUBLIC_AI_URL="${PUBLIC_AI_URL:-https://ai.ynxweb4.com}"
export PUBLIC_WEB4_URL="${PUBLIC_WEB4_URL:-https://web4.ynxweb4.com}"
export YNX_COSMOS_CHAIN_ID="${YNX_COSMOS_CHAIN_ID:-ynx_6423-1}"
export YNX_EVM_CHAIN_ID="${YNX_EVM_CHAIN_ID:-6423}"
export YNX_EVM_CHAIN_ID_HEX="${YNX_EVM_CHAIN_ID_HEX:-0x1917}"
export YNX_NATIVE_COIN_SYMBOL="${YNX_NATIVE_COIN_SYMBOL:-YNXT}"
export YNX_EXPECTED_VALIDATOR_COUNT="${YNX_EXPECTED_VALIDATOR_COUNT:-3}"
export YNX_REMOTE_EVIDENCE_PATH="${YNX_REMOTE_EVIDENCE_PATH:-tmp/remote-smoke-test/evidence.json}"

node scripts/verify/remote-smoke-test.mjs
