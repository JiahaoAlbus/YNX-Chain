#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

go test ./internal/consensus -run 'TestEthereumDynamicFeeTransferPriorityBelowCapRoundTrip|TestApplicationExecutesEthereumDynamicFeeTransferPriorityBelowCap|TestEthereumDynamicFeeTransferCanonicalEIP1559RoundTripAndBoundaries|TestApplicationExecutesEthereumDynamicFeeTransferAndRejectsReplay' -count=1
go test ./internal/bftgateway -run 'TestGatewayMapsBoundedEthereumDynamicFeeTransfer|TestGatewayRejectsMalformedWrongChainAndTypedEthereumBroadcasts' -count=1

grep -Fq 'EthereumDynamicFeeTransferType' internal/consensus/ethereum_transaction.go
grep -Fq 'DecodeEthereumDynamicFeeTransaction' internal/consensus/ethereum_transaction.go
grep -Fq 'EthereumCompatibilityBaseFeePerGas' internal/consensus/ethereum_transaction.go
grep -Fq 'MaximumGasFee' internal/consensus/ethereum_transaction.go
grep -Fq 'EthereumDynamicFeeGasFeeSource' internal/consensus/fee_state.go
grep -Fq 'result["maxPriorityFeePerGas"]' internal/bftgateway/evm.go
grep -Fq 'result["maxFeePerGas"]' internal/bftgateway/evm.go
grep -Fq '"baseFeePerGas"' internal/bftgateway/evm.go

echo "bft-evm-dynamic-fee-transfer-check passed: chain-bound EIP-1559 type-0x02 empty-access-list value transfers, sender recovery, zero-based nonce, zero compatibility base fee, maximum-fee affordability, exact 21000-gas accounting, audited receipts, type-0x2 JSON-RPC mapping, and fail-closed malformed/call/creation/unsupported-typed boundaries are verified"
