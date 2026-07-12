#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway -run 'TestGatewayMapsCometBFTAndKeepsCutoverBlocked|TestCommittedCumulativeGasUsesBlockResultEvidence|TestCommittedEVMFilterValidationHelpers' -count=1
grep -Fq 'eth_getTransactionReceipt' internal/bftgateway/gateway.go
grep -Fq 'eth_getLogs' internal/bftgateway/gateway.go
grep -Fq '/block_results' internal/bftgateway/evm.go
grep -Fq '"evm-transaction-receipts-and-logs"' internal/bftgateway/gateway.go

echo "bft-evm-receipt-check passed: committed transaction lookup, receipt gas/index/block evidence, zero-log truth boundary, bounded filters, and fail-closed validation are verified; IDE state transitions remain the only missing capability"
