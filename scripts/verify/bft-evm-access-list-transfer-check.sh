#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

go test ./internal/consensus -run 'TestEthereumAccessListTransferCanonicalEIP2930RoundTripAndBoundaries|TestApplicationExecutesEthereumAccessListTransferAndRejectsReplay' -count=1
go test ./internal/bftgateway -run 'TestGatewayBroadcastsAndLooksUpBoundedEthereumAccessListTransfer|TestGatewayRejectsMalformedWrongChainAndTypedEthereumBroadcasts' -count=1

grep -Fq 'EthereumAccessListTransferType' internal/consensus/ethereum_transaction.go
grep -Fq 'DecodeEthereumAccessListTransaction' internal/consensus/ethereum_transaction.go
grep -Fq 'non-empty Ethereum access lists are not supported' internal/consensus/ethereum_transaction.go
grep -Fq 'EthereumAccessListGasFeeSource' internal/consensus/fee_state.go
grep -Fq 'consensus.EthereumAccessListType' internal/bftgateway/evm.go
grep -Fq 'result["accessList"] = []any{}' internal/bftgateway/evm.go
grep -Fq 'result["yParity"]' internal/bftgateway/evm.go

echo "bft-evm-access-list-transfer-check passed: chain-bound EIP-2930 type-0x01 empty-access-list value transfers, sender recovery, zero-based nonce, exact 21000-gas accounting, dual Ethereum/Comet identity, audited receipt lookup, type-0x1 JSON-RPC mapping, and fail-closed non-empty access-list/calldata/contract-creation/EIP-1559 rejection are verified"
