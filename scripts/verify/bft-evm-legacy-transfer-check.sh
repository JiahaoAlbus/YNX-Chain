#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/consensus -run 'TestEthereumLegacyTransferCanonicalEIP155RoundTrip|TestEthereumLegacyTransferRejectsUnsupportedOrNonCanonicalEnvelopes|TestValidateBFTEVMReceiptRejectsTamperedLegacyTransferEvidence|TestApplicationExecutesEthereumLegacyTransferAndRejectsReplay' -count=1
go test ./internal/bftgateway -run 'TestGatewayBroadcastsAndResolvesEthereumLegacyTransferByEthereumHash|TestGatewayBroadcastsAndLooksUpBoundedEthereumLegacyTransfer|TestGatewayRejectsTamperedEthereumReceiptAuditEvidence|TestCommittedEthereumLookupDoesNotMaskNonNotFoundCometError|TestGatewayRejectsMalformedWrongChainAndTypedEthereumBroadcasts' -count=1

grep -Fq 'EthereumLegacyTransferType' internal/consensus/ethereum_transaction.go
grep -Fq 'EthereumTransferGasLimit' internal/consensus/ethereum_transaction.go
grep -Fq 'unsupported typed Ethereum transaction envelope' internal/consensus/action_transaction.go
grep -Fq '{Key: "ethereum_hash", Value: tx.Hash, Index: true}' internal/consensus/application.go
grep -Fq 'ApplicationVersion   = 16' internal/consensus/application.go
grep -Fq 'DecodeEthereumValueTransfer' internal/bftgateway/evm.go
grep -Fq 'committedEthereumTransaction' internal/bftgateway/evm.go
grep -Fq 'consensus.ValidateBFTEVMReceipt(receipt)' internal/bftgateway/evm.go
grep -Fq 'consensus.ValidateBFTEVMReceipt(ideReceipt)' internal/bftgateway/evm.go
grep -Fq 'result["chainId"]' internal/bftgateway/evm.go
grep -Fq 'cometHash := consensus.SignedTransactionHash(payload)' internal/bftgateway/gateway.go

echo "bft-evm-legacy-transfer-check passed: canonical EIP-155 legacy value transfer decoding, secp256k1 sender recovery, chain replay protection, zero-based Ethereum nonce mapping, bounded 21000-gas fees, Comet SHA-256 plus Ethereum Keccak dual identity, independently validated receipt audit evidence, JSON-RPC signature fields, and fail-closed typed/malformed envelope rejection are verified"
