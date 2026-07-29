#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

go test ./internal/bftgateway -run 'TestEVMFeeSuggestionMatchesZeroBaseFeeCompatibilityProfile|TestGatewayMapsCometBFTAndKeepsCutoverBlocked' -count=1

grep -Fq 'EthereumMinimumGasPrice' internal/consensus/ethereum_transaction.go
grep -Fq 'func evmFeeSuggestionResult' internal/bftgateway/evm.go
grep -Fq 'case "eth_gasPrice", "eth_maxPriorityFeePerGas"' internal/bftgateway/gateway.go
grep -Fq 'return hexEVMQuantity(consensus.EthereumMinimumGasPrice), nil' internal/bftgateway/evm.go

echo "bft-evm-fee-suggestion-check passed: eth_gasPrice and eth_maxPriorityFeePerGas expose the minimum accepted 0x1 gas price for the frozen zero-base-fee compatibility profile, accept omitted or empty params, reject extra or malformed params, and do not claim reward-percentile estimates or a dynamic base-fee market"
