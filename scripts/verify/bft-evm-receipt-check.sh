#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway -run 'TestGatewayMapsCometBFTAndKeepsCutoverBlocked|TestCommittedCumulativeGasUsesBlockResultEvidence|TestCommittedEVMFilterValidationHelpers|TestGatewayCommitsBoundedIDEAndReturnsEVMLogs' -count=1
grep -Fq 'net_version' internal/bftgateway/gateway.go
grep -Fq 'eth_getBalance' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionCount' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockByNumber' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockByHash' internal/bftgateway/gateway.go
grep -Fq 'eth_sendRawTransaction' internal/bftgateway/gateway.go
grep -Fq 'eth_getCode' internal/bftgateway/gateway.go
grep -Fq 'eth_call' internal/bftgateway/gateway.go
grep -Fq 'eth_estimateGas' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionReceipt' internal/bftgateway/gateway.go
grep -Fq 'eth_getLogs' internal/bftgateway/gateway.go
grep -Fq '/accounts/' internal/bftgateway/evm.go
grep -Fq '/block_results' internal/bftgateway/evm.go
grep -Fq '"evm-account-balance-and-nonce"' internal/bftgateway/gateway.go
grep -Fq '"evm-signed-raw-transaction-broadcast"' internal/bftgateway/gateway.go
grep -Fq '"evm-bounded-contract-code-call-and-gas"' internal/bftgateway/gateway.go
grep -Fq '"evm-transaction-receipts-and-logs"' internal/bftgateway/gateway.go

echo "bft-evm-receipt-check passed: network identity, signed raw YNXT broadcast with rejection mapping, ABCI-backed latest balance/nonce, Comet block-by-number/hash with AppHash/DataHash/gas evidence, committed bounded code/call/current-resource estimate, transaction lookup, receipt gas/index/block evidence, bounded contract logs and bloom, bounded filters, and fail-closed validation are verified"
