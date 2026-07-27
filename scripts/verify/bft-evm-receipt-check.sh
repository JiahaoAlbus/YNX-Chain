#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/bftgateway -run 'TestGatewayMapsCometBFTAndKeepsCutoverBlocked|TestEVMBlockTransactionLookupsClassifyUpstreamFailures|TestCommittedCumulativeGasUsesBlockResultEvidence|TestCommittedEVMFilterValidationHelpers|TestGatewayCommitsBoundedIDEAndReturnsEVMLogs' -count=1
node ./scripts/verify/integration-contract-check.mjs
grep -Fq 'net_version' internal/bftgateway/gateway.go
grep -Fq 'eth_getBalance' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionCount' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockByNumber' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockByHash' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockTransactionCountByNumber' internal/bftgateway/gateway.go
grep -Fq 'eth_getBlockTransactionCountByHash' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionByBlockNumberAndIndex' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionByBlockHashAndIndex' internal/bftgateway/gateway.go
grep -Fq 'eth_sendRawTransaction' internal/bftgateway/gateway.go
grep -Fq 'eth_getCode' internal/bftgateway/gateway.go
grep -Fq 'eth_getStorageAt' internal/bftgateway/gateway.go
grep -Fq 'eth_call' internal/bftgateway/gateway.go
grep -Fq 'eth_estimateGas' internal/bftgateway/gateway.go
grep -Fq 'eth_getTransactionReceipt' internal/bftgateway/gateway.go
grep -Fq 'eth_getLogs' internal/bftgateway/gateway.go
grep -Fq '/accounts/' internal/bftgateway/evm.go
grep -Fq '/block_results' internal/bftgateway/evm.go
grep -Fq '"evm-account-balance-and-nonce"' internal/bftgateway/gateway.go
grep -Fq '"evm-signed-raw-transaction-broadcast"' internal/bftgateway/gateway.go
grep -Fq '"evm-bounded-contract-code-storage-call-and-gas"' internal/bftgateway/gateway.go
grep -Fq '"evm-transaction-receipts-and-logs"' internal/bftgateway/gateway.go
for vector in \
  evm-block-transaction-count-index-accept \
  evm-block-transaction-pending-or-missing-null-accept \
  evm-block-transaction-out-of-range-null-accept \
  evm-block-transaction-malformed-quantity-reject \
  evm-block-transaction-malformed-hash-reject \
  evm-block-transaction-wrong-parameter-count-reject \
  evm-block-transaction-upstream-evidence-failure-reject; do
  grep -Fq "\"id\": \"${vector}\"" docs/integration/CROSS_PRODUCT_TEST_VECTORS.json
done

echo "bft-evm-receipt-check passed: network identity, signed raw YNXT broadcast with rejection mapping, ABCI-backed latest balance/nonce, Comet block-by-number/hash plus transaction count/index lookup with AppHash/DataHash/gas evidence, frozen null/invalid-parameter/upstream-failure vectors, committed bounded code/storage/call/current-resource estimate, transaction lookup, receipt gas/index/block evidence, bounded contract logs and bloom, bounded filters, and fail-closed validation are verified"
